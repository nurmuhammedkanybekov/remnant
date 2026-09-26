import * as THREE from "three";
import { textures } from "../fx/textures";

/**
 * The first-person pistol + gloved hand. Lives in Engine.viewScene, which
 * is rendered on top of the world with a cleared depth buffer — so the gun
 * never clips into walls no matter how close you stand.
 */
export class Viewmodel {
  private readonly root = new THREE.Group(); // follows the camera
  private readonly rig = new THREE.Group(); // sway / bob / recoil offsets
  private readonly gun = new THREE.Group();
  private readonly slide: THREE.Mesh;
  private readonly mag: THREE.Mesh;
  private readonly flash: THREE.Sprite;
  private readonly flashLight: THREE.PointLight;
  private readonly keyLight: THREE.DirectionalLight;

  private sway = new THREE.Vector2();
  private kick = 0;
  private slideBack = 0;
  private flashTime = 0;
  private sprintBlend = 0;
  private bobPhase = 0;

  constructor(
    private readonly viewScene: THREE.Scene,
    private readonly camera: THREE.Camera
  ) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a4e55, metalness: 0.75, roughness: 0.35 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x26282c, metalness: 0.6, roughness: 0.5 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x2c2d30, metalness: 0.1, roughness: 0.7 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x4a3e30, roughness: 0.9 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x23261f, roughness: 1 });

    // Slide (top) — moves back when firing
    this.slide = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.034, 0.2), metal);
    this.slide.position.set(0, 0.022, -0.02);
    this.gun.add(this.slide);
    const ejection = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.014, 0.04), darkMetal);
    ejection.position.set(0.018, 0.028, -0.02);
    this.slide.add(ejection);
    const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.01), darkMetal);
    rearSight.position.set(0, 0.021, 0.09);
    this.slide.add(rearSight);
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.012, 0.01), darkMetal);
    frontSight.position.set(0, 0.022, -0.09);
    this.slide.add(frontSight);
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.002), new THREE.MeshBasicMaterial({ color: 0x9dff9d }));
    dot.position.set(0, 0.026, -0.085);
    this.slide.add(dot);

    // Frame + barrel
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.026, 0.18), polymer);
    frame.position.set(0, -0.006, -0.01);
    this.gun.add(frame);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 10), darkMetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.024, -0.125);
    this.gun.add(barrel);

    // Grip (angled)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.045), polymer);
    grip.position.set(0, -0.06, 0.05);
    grip.rotation.x = 0.28;
    this.gun.add(grip);

    // Magazine (slides out of the grip during reload)
    this.mag = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.1, 0.036), darkMetal);
    this.mag.position.set(0, -0.06, 0.05);
    this.mag.rotation.x = 0.28;
    this.gun.add(this.mag);

    // Trigger guard
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 12, Math.PI), polymer);
    guard.rotation.set(0, Math.PI / 2, Math.PI);
    guard.position.set(0, -0.02, 0.0);
    this.gun.add(guard);

    // Gloved hand wrapped round the grip + forearm
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.07), glove);
    hand.position.set(0.004, -0.07, 0.06);
    hand.rotation.x = 0.28;
    this.gun.add(hand);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.046, 0.26, 14), sleeve);
    forearm.position.set(0.04, -0.17, 0.15);
    forearm.rotation.set(-0.55, 0, 0.45);
    this.gun.add(forearm);

    this.gun.position.set(0.14, -0.13, -0.38);
    this.gun.rotation.set(0.03, 0.07, -0.03);
    this.gun.scale.setScalar(1.0);

    // Muzzle flash
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures().flash,
        color: 0xffd9a0,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })
    );
    this.flash.position.set(0, 0.024, -0.16);
    this.flash.scale.setScalar(0.18);
    this.flash.visible = false;
    this.gun.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.5, 2);
    this.flashLight.position.set(0, 0.03, -0.2);
    this.gun.add(this.flashLight);

    this.rig.add(this.gun);
    this.root.add(this.rig);
    viewScene.add(this.root);

    // Viewmodel lighting (the world lights don't reach this scene).
    viewScene.add(new THREE.HemisphereLight(0x9aa6b4, 0x302418, 1.4));
    this.keyLight = new THREE.DirectionalLight(0xe8eeff, 1.2);
    this.keyLight.position.set(0.5, 1.2, 0.1);
    this.root.add(this.keyLight);
    this.keyLight.target.position.set(0, 0, -1);
    this.root.add(this.keyLight.target);
  }

  fire(): void {
    this.kick = 1;
    this.slideBack = 1;
    this.flashTime = 0.05;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.14 + Math.random() * 0.08);
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  update(
    dt: number,
    lookDX: number,
    lookDY: number,
    moveFactor: number,
    sprinting: boolean,
    reloadProgress: number,
    torchLevel: number
  ): void {
    this.root.position.copy(this.camera.getWorldPosition(new THREE.Vector3()));
    this.root.quaternion.copy(this.camera.getWorldQuaternion(new THREE.Quaternion()));

    // Sway lags behind mouse motion
    this.sway.x += lookDX * 0.00012;
    this.sway.y += lookDY * 0.00012;
    this.sway.multiplyScalar(Math.exp(-dt * 9));
    this.sway.clampLength(0, 0.05);

    this.bobPhase += dt * (4 + moveFactor * 8);
    const bobAmt = moveFactor;
    const bobX = Math.cos(this.bobPhase) * 0.012 * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.01 * bobAmt;
    const idleY = Math.sin(performance.now() * 0.0015) * 0.003;

    this.kick = Math.max(0, this.kick - dt * 9);
    this.slideBack = Math.max(0, this.slideBack - dt * 14);
    this.sprintBlend = THREE.MathUtils.lerp(this.sprintBlend, sprinting ? 1 : 0, 1 - Math.exp(-dt * 8));

    // Reload choreography: dip & tilt, mag out, mag in, rack.
    const p = reloadProgress;
    const dip = p > 0 ? Math.sin(Math.min(1, p) * Math.PI) : 0;
    let magDrop = 0;
    if (p > 0.15 && p < 0.35) magDrop = (p - 0.15) / 0.2;
    else if (p >= 0.35 && p < 0.55) magDrop = 1;
    else if (p >= 0.55 && p < 0.72) magDrop = 1 - (p - 0.55) / 0.17;
    const rack = p > 0.78 && p < 0.95 ? Math.sin(((p - 0.78) / 0.17) * Math.PI) : 0;

    this.rig.position.set(
      -this.sway.x + bobX + this.sprintBlend * 0.04,
      this.sway.y - bobY + idleY - dip * 0.08 - this.sprintBlend * 0.06,
      this.kick * 0.05
    );
    this.rig.rotation.set(
      this.kick * 0.22 + dip * 0.35 - this.sprintBlend * 0.3,
      this.sprintBlend * 0.5 + this.sway.x * 2,
      dip * 0.6 + this.sprintBlend * 0.25
    );

    this.slide.position.z = -0.02 + Math.max(this.slideBack, rack) * 0.04;
    this.mag.position.y = -0.06 - magDrop * 0.16;
    this.mag.visible = magDrop < 0.99;

    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.flashLight.intensity = this.flashTime > 0 ? 4 : 0;
    this.keyLight.intensity = 0.6 + torchLevel * 2.4;
  }
}
