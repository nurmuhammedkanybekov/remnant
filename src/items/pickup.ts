import * as THREE from "three";
import { textures } from "../fx/textures";
import { ITEMS, type PickupType } from "../content/items";
import { bottleMesh } from "./throwables";

export type { PickupType };

export class Pickup {
  readonly group = new THREE.Group();
  private readonly item: THREE.Object3D;
  private readonly glow: THREE.Sprite;
  collected = false;
  private phase = Math.random() * 10;

  constructor(
    private readonly scene: THREE.Scene,
    readonly type: PickupType,
    pos: THREE.Vector2,
    readonly noteText?: string,
    readonly noteKey?: string
  ) {
    this.item = buildItem(type);
    this.group.add(this.item);
    // Soft halo so items can be spotted in the dark without a flashlight.
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures().glow,
        color: ITEMS[type].glow,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.glow.scale.setScalar(0.9);
    this.group.add(this.glow);
    // Small offset from cell centre so pickups don't all sit dead-centre.
    this.group.position.set(pos.x + 0.6, 0, pos.y - 0.4);
    scene.add(this.group);
  }

  update(dt: number): void {
    this.phase += dt;
    this.item.rotation.y += dt * 1.2;
    this.item.position.y = 0.55 + Math.sin(this.phase * 2.2) * 0.06;
    this.glow.position.y = this.item.position.y;
    this.glow.material.opacity = 0.25 + Math.sin(this.phase * 3) * 0.1;
  }

  collect(): void {
    this.collected = true;
    this.scene.remove(this.group);
  }

  /** Puts a collected pickup back (the boss arena's supplies restock). */
  restore(): void {
    if (!this.collected) return;
    this.collected = false;
    this.scene.add(this.group);
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(this.group.position.x - x, this.group.position.z - z);
  }
}

function buildItem(type: PickupType): THREE.Object3D {
  const tex = textures();
  const g = new THREE.Group();
  switch (type) {
    case "ammo": {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.18, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x4d5a36, roughness: 0.7, metalness: 0.3 })
      );
      g.add(box);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.345, 0.05, 0.225),
        new THREE.MeshStandardMaterial({ color: 0xd8b23a, emissive: 0x6a5010, roughness: 0.5 })
      );
      g.add(band);
      for (let i = 0; i < 4; i++) {
        const round = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.015, 0.07, 8),
          new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.9, roughness: 0.3 })
        );
        round.position.set(-0.08 + i * 0.05, 0.13, 0);
        g.add(round);
      }
      break;
    }
    case "shells": {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.14, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x6a1a14, roughness: 0.7 })
      );
      g.add(box);
      for (let i = 0; i < 4; i++) {
        const shell = new THREE.Mesh(
          new THREE.CylinderGeometry(0.024, 0.024, 0.09, 10),
          new THREE.MeshStandardMaterial({ color: 0xc8361e, roughness: 0.5, emissive: 0x3a0a04 })
        );
        shell.position.set(-0.09 + i * 0.06, 0.11, 0);
        const brass = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.025, 10),
          new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.9, roughness: 0.3 })
        );
        brass.position.y = -0.04;
        shell.add(brass);
        g.add(shell);
      }
      break;
    }
    case "rivets": {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.1, 0.18),
        new THREE.MeshStandardMaterial({ color: 0xc89a1a, roughness: 0.55, metalness: 0.2 })
      );
      g.add(box);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.02, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.9, roughness: 0.3 })
      );
      strip.position.y = 0.06;
      g.add(strip);
      break;
    }
    case "shotgun":
    case "rivetGun":
      g.add(buildWeaponProp(type));
      break;
    case "medkit": {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.24, 0.16),
        new THREE.MeshStandardMaterial({ map: tex.medkit, roughness: 0.6, emissive: 0x221010 })
      );
      g.add(box);
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x333333 })
      );
      handle.position.y = 0.12;
      g.add(handle);
      break;
    }
    case "battery": {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.26, 14),
        new THREE.MeshStandardMaterial({ color: 0x1d2b3a, metalness: 0.5, roughness: 0.4 })
      );
      g.add(body);
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.07, 14),
        new THREE.MeshStandardMaterial({ color: 0x7fd8ff, emissive: 0x2a7090, roughness: 0.4 })
      );
      g.add(stripe);
      const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.03, 10),
        new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 1, roughness: 0.3 })
      );
      tip.position.y = 0.145;
      g.add(tip);
      g.rotation.z = 0.3;
      break;
    }
    case "keycard": {
      const card = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.16, 0.01),
        new THREE.MeshStandardMaterial({ color: 0x2a6a44, emissive: 0x1a6a3a, roughness: 0.4 })
      );
      g.add(card);
      const chip = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.04, 0.012),
        new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: 1, roughness: 0.3 })
      );
      chip.position.set(-0.07, 0.02, 0);
      g.add(chip);
      break;
    }
    case "bottle":
      g.add(bottleMesh());
      break;
    case "note": {
      const paper = new THREE.Mesh(
        new THREE.PlaneGeometry(0.24, 0.32),
        new THREE.MeshStandardMaterial({ map: tex.paper, side: THREE.DoubleSide, emissive: 0x302a1a, roughness: 1 })
      );
      paper.rotation.x = -0.4;
      g.add(paper);
      break;
    }
  }
  return g;
}

/** A weapon lying on the floor, big enough to notice. */
function buildWeaponProp(type: "shotgun" | "rivetGun"): THREE.Object3D {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x26282c, metalness: 0.6, roughness: 0.5 });
  if (type === "shotgun") {
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.75, emissive: 0x100804 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.6, 10), dark);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(-0.15, 0.02, 0);
    g.add(barrel);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.05), dark);
    receiver.position.x = 0.15;
    g.add(receiver);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.045), wood);
    stock.position.set(0.38, -0.02, 0);
    stock.rotation.z = -0.1;
    g.add(stock);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.14, 10), wood);
    pump.rotation.z = Math.PI / 2;
    pump.position.set(-0.12, -0.012, 0);
    g.add(pump);
  } else {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xc89a1a, roughness: 0.55, emissive: 0x201804 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.07), yellow);
    g.add(body);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10), dark);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.x = -0.16;
    g.add(nozzle);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.04), dark);
    grip.position.set(0.06, -0.09, 0);
    grip.rotation.z = 0.25;
    g.add(grip);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0x8a1a14 }));
    can.position.set(0.1, -0.08, 0.05);
    g.add(can);
  }
  return g;
}
