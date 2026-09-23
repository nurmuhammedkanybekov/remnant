import * as THREE from "three";
import { Engine } from "./core/engine";
import { Input } from "./core/input";
import { Clock } from "./core/clock";
import { buildLevel, type LevelData } from "./world/level";
import { LEVEL_1_MAP, LEVEL_1_NOTES, LEVEL_1_NAME } from "./world/levels/level1";
import { PlayerController } from "./player/playerController";
import { EnemyManager } from "./enemies/enemyManager";
import { Pickup } from "./items/pickup";
import { createPistol } from "./weapons/pistol";
import type { Weapon } from "./weapons/weapon";
import { SoundManager } from "./audio/soundManager";
import { Hud } from "./ui/hud";
import { Overlay } from "./ui/menu";

type GameState = "menu" | "playing" | "paused" | "gameover" | "win";

const EXIT_RADIUS = 1.4;

export class Game {
  private readonly engine: Engine;
  private readonly input: Input;
  private readonly clock = new Clock();
  private readonly sound = new SoundManager();
  private readonly hud: Hud;
  private readonly overlay: Overlay;

  private state: GameState = "menu";
  private level!: LevelData;
  private player!: PlayerController;
  private enemyManager!: EnemyManager;
  private pickups: Pickup[] = [];
  private weapon!: Weapon;
  private exitPos = new THREE.Vector2();
  private transientLights: { light: THREE.Light; life: number }[] = [];

  constructor(private readonly container: HTMLElement) {
    this.engine = new Engine(container);
    this.input = new Input(this.engine.domElement);
    this.hud = new Hud(container);
    this.overlay = new Overlay(container);
    this.hud.setVisible(false);

    document.addEventListener("pointerlockchange", () => {
      if (!this.input.locked && this.state === "playing") this.pause();
    });

    this.showMenu();
    requestAnimationFrame(this.loop);
  }

  private showMenu(): void {
    this.state = "menu";
    this.hud.setVisible(false);
    this.overlay.show(
      "REMNANT",
      `${LEVEL_1_NAME}\n\nWASD move · Mouse look · Left click fire · R reload\nF flashlight · Shift sprint\n\nAmmo is scarce. Your flashlight isn't free. Some things hunt by sound.\nFind the exit.`,
      "Enter the dark",
      () => this.startLevel()
    );
  }

  private startLevel(): void {
    // Clear everything except the camera, which carries the flashlight rig.
    for (const child of [...this.engine.scene.children]) {
      if (child !== this.engine.camera) this.engine.scene.remove(child);
    }

    this.level = buildLevel(this.engine.scene, LEVEL_1_MAP, LEVEL_1_NOTES);
    const spawns = this.level.spawns;

    this.player = new PlayerController(this.engine.camera, this.level, spawns.playerStart.x, spawns.playerStart.y);
    this.player.health.onDeath = () => this.gameOver();
    this.player.health.onDamage = () => {
      this.hud.flashDamage();
      this.sound.playPlayerDamage();
    };
    this.player.onFootstep = (sprinting) => this.sound.playFootstep(sprinting);

    this.enemyManager = new EnemyManager(this.engine.scene, this.level, spawns.enemySpawns);
    for (const enemy of this.enemyManager.enemies) {
      enemy.onNoiseAlert = () => this.sound.playEnemyAlert(enemy.position2D.distanceTo(
        new THREE.Vector2(this.player.position.x, this.player.position.z)
      ));
    }

    this.pickups = [
      ...spawns.ammoSpawns.map((p) => new Pickup(this.engine.scene, "ammo", p)),
      ...spawns.medkitSpawns.map((p) => new Pickup(this.engine.scene, "medkit", p)),
      ...spawns.noteSpawns.map((n) => new Pickup(this.engine.scene, "note", n.pos, n.text)),
    ];

    this.exitPos = spawns.exit;
    this.weapon = createPistol();
    this.weapon.onFire = () => {
      this.sound.playGunshot();
      this.addMuzzleFlash();
    };
    this.weapon.onEmptyFire = () => this.sound.playEmptyClick();

    this.hud.setObjective("Find the exit.");
    this.hud.setVisible(true);
    this.overlay.hide();

    this.sound.init();
    this.input.requestLock();
    this.state = "playing";
  }

  private addMuzzleFlash(): void {
    const light = new THREE.PointLight(0xffcf80, 4, 4);
    light.position.set(0.15, -0.1, -0.3);
    this.engine.camera.add(light);
    this.transientLights.push({ light, life: 0.06 });
  }

  private pause(): void {
    this.state = "paused";
    this.overlay.show("PAUSED", "Click resume to continue.", "Resume", () => {
      this.overlay.hide();
      this.input.requestLock();
      this.state = "playing";
    });
  }

  private gameOver(): void {
    this.state = "gameover";
    this.input.exitLock();
    this.overlay.show("YOU DIDN'T MAKE IT", "The dark got there first.", "Try again", () => this.startLevel());
  }

  private win(): void {
    this.state = "win";
    this.input.exitLock();
    this.overlay.show("YOU MADE IT OUT", "Not everyone does.", "Play again", () => this.startLevel());
  }

  private handleShooting(): void {
    if (this.input.wasJustPressed("KeyR")) this.weapon.tryReload();
    if (this.input.wasMouseJustPressed()) {
      const raycaster = this.weapon.tryFire(this.engine.camera);
      if (raycaster) {
        const hit = this.enemyManager.raycastEnemies(raycaster);
        if (hit) hit.enemy.takeDamage(this.weapon.config.damage);
      }
    }
  }

  private handlePickups(dt: number): void {
    const px = this.player.position.x;
    const pz = this.player.position.z;
    for (const pickup of this.pickups) {
      if (pickup.collected) continue;
      pickup.update(dt);
      if (pickup.distanceTo(px, pz) < 0.9) {
        pickup.collect(this.engine.scene);
        this.sound.playPickup();
        switch (pickup.type) {
          case "ammo":
            this.weapon.addReserveAmmo(8);
            break;
          case "medkit":
            this.player.health.heal(45);
            break;
          case "note":
            if (pickup.noteText) this.hud.showNote(pickup.noteText);
            break;
        }
      }
    }
  }

  private updateTransientLights(dt: number): void {
    for (let i = this.transientLights.length - 1; i >= 0; i--) {
      const t = this.transientLights[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.engine.camera.remove(t.light);
        this.transientLights.splice(i, 1);
      }
    }
  }

  private readonly loop = (): void => {
    const dt = this.clock.tick();

    if (this.state === "playing") {
      this.player.update(dt, this.input);
      this.enemyManager.update(dt, this.player.position, this.player.isSprinting, (amount) =>
        this.player.health.takeDamage(amount)
      );
      this.weapon.update(dt);
      this.handleShooting();
      this.handlePickups(dt);
      this.updateTransientLights(dt);

      this.hud.setHealth(this.player.health.current / this.player.health.max);
      this.hud.setStamina(this.player.stamina / 100);
      this.hud.setBattery(this.player.flashlight.battery / 100);
      this.hud.setAmmo(this.weapon.ammoInMag, this.weapon.reserveAmmo, this.weapon.isReloading);

      const distToExit = Math.hypot(
        this.player.position.x - this.exitPos.x,
        this.player.position.z - this.exitPos.y
      );
      if (distToExit < EXIT_RADIUS) this.win();
    }

    this.input.endFrame();
    this.engine.render();
    requestAnimationFrame(this.loop);
  };
}
