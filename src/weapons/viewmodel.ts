import * as THREE from "three";
import type { WeaponId } from "../content/weapons";
import { textures } from "../fx/textures";

/** One first-person weapon model and the parts that animate. */
interface GunModel {
  group: THREE.Group;
  /** Moves back when firing (pistol slide, shotgun pump, rivet-gun piston). */
  slide: THREE.Object3D;
  slideRest: number;
  slideTravel: number;
  /** Drops out during a magazine reload. Null for single-loading weapons. */
  mag: THREE.Object3D | null;
  magRest: number;
  /** Muzzle position, for the flash. */
  muzzle: THREE.Vector3;
  flashSize: number;
  /** How hard it kicks. */
  kick: number;
}

const SWITCH_TIME = 0.22; // each of lower and raise
const MELEE_TIME = 0.38;

/**
 * The first-person weapon and gloved hand. Lives in Engine.viewScene, which
 * is rendered on top of the world with a cleared depth buffer — so the gun
 * never clips into walls no matter how close you stand.
 */
export class Viewmodel {
  private readonly root = new THREE.Group(); // follows the camera
  private readonly rig = new THREE.Group(); // sway / bob / recoil offsets
  /** Shared by every hand model; tinted to the chosen look. */
  private readonly skin = new THREE.MeshStandardMaterial({ color: 0xd9b397, roughness: 0.75 });
  private readonly models: Record<WeaponId, GunModel>;
  private readonly injector: THREE.Group;
  private readonly flash: THREE.Sprite;
  private readonly flashLight: THREE.PointLight;
  private readonly keyLight: THREE.DirectionalLight;
  private current: WeaponId = "pistol";
  private pending: WeaponId | null = null;

  private sway = new THREE.Vector2();
  private kick = 0;
  private slideBack = 0;
  private flashTime = 0;
  private sprintBlend = 0;
  private bobPhase = 0;
  /** 0 = raised, 1 = fully lowered out of view (switching). */
  private lowered = 0;
  private meleeT = 1;
  private healT = 1;
  private healDuration = 1;

  constructor(
    private readonly viewScene: THREE.Scene,
    private readonly camera: THREE.Camera
  ) {
    const mats = {
      metal: new THREE.MeshStandardMaterial({ color: 0x4a4e55, metalness: 0.75, roughness: 0.35 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x26282c, metalness: 0.6, roughness: 0.5 }),
      polymer: new THREE.MeshStandardMaterial({ color: 0x2c2d30, metalness: 0.1, roughness: 0.7 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x4a3e30, roughness: 0.9 }),
      skin: this.skin,
      sleeve: new THREE.MeshStandardMaterial({ color: 0x23261f, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.75 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe8b420, roughness: 0.5, metalness: 0.1, emissive: 0x2a1c00 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }),
    };
    this.models = {
      pistol: buildPistol(mats),
      rivet: buildRivetGun(mats),
      shotgun: buildShotgun(mats),
    };
    for (const m of Object.values(this.models)) {
      m.group.visible = false;
      this.rig.add(m.group);
    }
    this.models.pistol.group.visible = true;

    // Muzzle flash, re-parented to whichever gun is out.
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures().flash,
        color: 0xffd9a0,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })
    );
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.5, 2);
    this.attachFlash();

    this.injector = buildInjector(mats);
    this.injector.visible = false;
    this.root.add(this.injector);

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
  /** Skin tone of the hands (the player's chosen look). */
  setSkin(color: number): void {
    this.skin.color.setHex(color);
  }

  private attachFlash(): void {
    const m = this.models[this.current];
    m.group.add(this.flash, this.flashLight);
    this.flash.position.copy(m.muzzle);
    this.flashLight.position.copy(m.muzzle).z -= 0.04;
  }

  /** Swap to another weapon: the current one drops out of view and the new one comes up. */
  equip(id: WeaponId, instant = false): void {
    if (instant) {
      this.models[this.current].group.visible = false;
      this.current = id;
      this.pending = null;
      this.lowered = 0;
      this.models[id].group.visible = true;
      this.attachFlash();
      return;
    }
    if (id === this.current && this.pending === null) return;
    this.pending = id;
  }

  fire(): void {
    const m = this.models[this.current];
    this.kick = m.kick;
    this.slideBack = 1;
    this.flashTime = 0.05;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(m.flashSize * (0.8 + Math.random() * 0.45));
  }

  /** A quick sideways bash with the weapon. */
  melee(): void {
    this.meleeT = 0;
  }

  /** Lower the weapon and use an injector for `duration` seconds. */
  heal(duration: number): void {
    this.healT = 0;
    this.healDuration = duration;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  update(dt: number, turn: number, tilt: number, moveFactor: number, sprinting: boolean, reloadProgress: number, torchLevel: number): void {
    this.root.position.copy(this.camera.getWorldPosition(new THREE.Vector3()));
    this.root.quaternion.copy(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    const m = this.models[this.current];

    // Weapon switch: lower, swap, raise.
    if (this.pending !== null) {
      this.lowered = Math.min(1, this.lowered + dt / SWITCH_TIME);
      if (this.lowered >= 1) {
        this.models[this.current].group.visible = false;
        this.current = this.pending;
        this.pending = null;
        this.models[this.current].group.visible = true;
        this.attachFlash();
      }
    } else {
      this.lowered = Math.max(0, this.lowered - dt / SWITCH_TIME);
    }

    // Sway lags behind look motion (turn/tilt in radians).
    this.sway.x += turn * 0.055;
    this.sway.y += tilt * 0.055;
    this.sway.multiplyScalar(Math.exp(-dt * 9));
    this.sway.clampLength(0, 0.05);

    this.bobPhase += dt * (4 + moveFactor * 8);
    const bobAmt = moveFactor;
    const bobX = Math.cos(this.bobPhase) * 0.012 * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.01 * bobAmt;
    const idleY = Math.sin(performance.now() * 0.0015) * 0.003;

    this.kick = Math.max(0, this.kick - dt * 9);
    this.slideBack = Math.max(0, this.slideBack - dt * (this.current === "shotgun" ? 4 : 14));
    this.sprintBlend = THREE.MathUtils.lerp(this.sprintBlend, sprinting ? 1 : 0, 1 - Math.exp(-dt * 8));

    // Reload choreography: dip & tilt, mag out, mag in, rack. Single loading just rocks per round.
    const p = reloadProgress;
    const dip = p > 0 ? (m.mag ? Math.sin(Math.min(1, p) * Math.PI) : 0.6 + Math.sin(p * Math.PI) * 0.25) : 0;
    let magDrop = 0;
    if (m.mag) {
      if (p > 0.15 && p < 0.35) magDrop = (p - 0.15) / 0.2;
      else if (p >= 0.35 && p < 0.55) magDrop = 1;
      else if (p >= 0.55 && p < 0.72) magDrop = 1 - (p - 0.55) / 0.17;
    }
    const rack = m.mag && p > 0.78 && p < 0.95 ? Math.sin(((p - 0.78) / 0.17) * Math.PI) : 0;

    // Melee: wind back right, then sweep left and forward.
    this.meleeT = Math.min(1, this.meleeT + dt / MELEE_TIME);
    const mk = this.meleeT;
    const swing = mk < 1 ? (mk < 0.3 ? -mk / 0.3 : Math.sin(((mk - 0.3) / 0.7) * Math.PI) * 1.6 - (1 - (mk - 0.3) / 0.7)) : 0;

    // Healing: the weapon drops away and the injector comes up.
    this.healT = Math.min(1, this.healT + dt / this.healDuration);
    const healing = this.healT < 1;
    const healLower = healing ? Math.min(1, this.healT * 5, (1 - this.healT) * 5) : 0;
    this.injector.visible = healing;
    if (healing) {
      const k = this.healT;
      const jab = k > 0.45 && k < 0.65 ? Math.sin(((k - 0.45) / 0.2) * Math.PI) : 0;
      this.injector.position.set(-0.13 + jab * 0.02, -0.17 + healLower * 0.05 - jab * 0.04, -0.44);
      this.injector.rotation.set(0.3 + jab * 0.4, 0.3, 0.5);
    }

    const down = Math.max(this.lowered, healLower);
    this.rig.position.set(
      -this.sway.x + bobX + this.sprintBlend * 0.04 - swing * 0.09,
      this.sway.y - bobY + idleY - dip * 0.08 - this.sprintBlend * 0.06 - down * 0.28,
      this.kick * 0.05 - Math.max(0, swing) * 0.06
    );
    this.rig.rotation.set(
      this.kick * 0.22 + dip * 0.35 - this.sprintBlend * 0.3 - down * 0.6,
      this.sprintBlend * 0.5 + this.sway.x * 2 + swing * 0.55,
      dip * 0.6 + this.sprintBlend * 0.25 + swing * 0.5
    );

    m.slide.position.z = m.slideRest + Math.max(this.slideBack, rack) * m.slideTravel;
    if (m.mag) {
      m.mag.position.y = m.magRest - magDrop * 0.16;
      m.mag.visible = magDrop < 0.99;
    }

    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    this.flashLight.intensity = this.flashTime > 0 ? 4 : 0;
    this.keyLight.intensity = 0.6 + torchLevel * 2.4;
  }
}

type Mats = Record<
  "metal" | "darkMetal" | "polymer" | "glove" | "skin" | "sleeve" | "wood" | "yellow" | "rubber",
  THREE.MeshStandardMaterial
>;

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(r: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, segs = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segs), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** Gloved hand on a grip + sleeve, shared by every weapon. */
function hand(g: THREE.Group, mats: Mats, gripY: number, gripZ: number, gripTilt: number): void {
  const h = box(0.06, 0.07, 0.07, mats.glove, 0.004, gripY - 0.01, gripZ + 0.01);
  h.rotation.x = gripTilt;
  g.add(h);
  // Bare wrist between glove and cuff.
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.05, 12), mats.skin);
  wrist.position.set(0.018, gripY - 0.045, gripZ + 0.05);
  wrist.rotation.set(-0.55, 0, 0.45);
  g.add(wrist);
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.046, 0.26, 14), mats.sleeve);
  forearm.position.set(0.04, gripY - 0.11, gripZ + 0.1);
  forearm.rotation.set(-0.55, 0, 0.45);
  g.add(forearm);
}

function buildPistol(mats: Mats): GunModel {
  const g = new THREE.Group();
  // Slide (top) — moves back when firing
  const slide = box(0.036, 0.034, 0.2, mats.metal, 0, 0.022, -0.02);
  g.add(slide);
  slide.add(box(0.006, 0.014, 0.04, mats.darkMetal, 0.018, 0.006, 0)); // ejection port
  slide.add(box(0.03, 0.01, 0.01, mats.darkMetal, 0, 0.021, 0.09)); // rear sight
  slide.add(box(0.006, 0.012, 0.01, mats.darkMetal, 0, 0.022, -0.09)); // front sight
  slide.add(box(0.004, 0.004, 0.002, new THREE.MeshBasicMaterial({ color: 0x9dff9d }), 0, 0.026, -0.085));

  g.add(box(0.032, 0.026, 0.18, mats.polymer, 0, -0.006, -0.01)); // frame
  g.add(cyl(0.008, 0.02, mats.darkMetal, 0, 0.024, -0.125, 10)); // barrel
  const grip = box(0.03, 0.11, 0.045, mats.polymer, 0, -0.06, 0.05);
  grip.rotation.x = 0.28;
  g.add(grip);
  // Magazine (slides out of the grip during reload)
  const mag = box(0.024, 0.1, 0.036, mats.darkMetal, 0, -0.06, 0.05);
  mag.rotation.x = 0.28;
  g.add(mag);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 12, Math.PI), mats.polymer);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.02, 0.0);
  g.add(guard);
  hand(g, mats, -0.06, 0.05, 0.28);

  g.position.set(0.14, -0.13, -0.38);
  g.rotation.set(0.03, 0.07, -0.03);
  return {
    group: g,
    slide,
    slideRest: -0.02,
    slideTravel: 0.04,
    mag,
    magRest: -0.06,
    muzzle: new THREE.Vector3(0, 0.024, -0.16),
    flashSize: 0.18,
    kick: 1,
  };
}

/**
 * A consortium pneumatic rivet gun: a chunky yellow tool with a rivet strip
 * on the side and a hose to a gas canister clipped under it.
 */
function buildRivetGun(mats: Mats): GunModel {
  const g = new THREE.Group();
  g.add(box(0.06, 0.07, 0.2, mats.yellow, 0, 0.02, -0.02)); // body
  g.add(box(0.062, 0.02, 0.12, mats.rubber, 0, 0.06, 0.0)); // top grip pad
  g.add(box(0.064, 0.01, 0.2, mats.darkMetal, 0, -0.012, -0.02)); // seam
  const nozzle = new THREE.Group();
  nozzle.position.z = -0.14;
  nozzle.add(cyl(0.017, 0.07, mats.metal, 0, 0.025, -0.03));
  nozzle.add(cyl(0.024, 0.02, mats.darkMetal, 0, 0.025, -0.07));
  g.add(nozzle);
  // Rivet strip in a side magazine
  const mag = box(0.02, 0.05, 0.1, mats.darkMetal, -0.045, -0.01, -0.04);
  for (let i = 0; i < 5; i++) mag.add(cyl(0.004, 0.02, mats.metal, -0.012, 0.02, -0.04 + i * 0.02, 6));
  g.add(mag);
  const grip = box(0.034, 0.11, 0.05, mats.rubber, 0, -0.06, 0.06);
  grip.rotation.x = 0.2;
  g.add(grip);
  // Gas canister under the grip, hose looping back
  const can = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.09, 12),
    new THREE.MeshStandardMaterial({ color: 0x8a1a14, roughness: 0.5 })
  );
  can.position.set(0.04, -0.07, -0.02);
  g.add(can);
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 6, 16, Math.PI * 1.2), mats.rubber);
  hose.position.set(0.04, -0.03, 0.02);
  hose.rotation.set(0, Math.PI / 2, 0.4);
  g.add(hose);
  // Warning stripes
  for (let i = 0; i < 3; i++) g.add(box(0.061, 0.071, 0.01, mats.rubber, 0, 0.02, 0.05 + i * 0.025));
  hand(g, mats, -0.06, 0.06, 0.2);

  g.position.set(0.15, -0.135, -0.42);
  g.rotation.set(0.03, 0.06, -0.03);
  return {
    group: g,
    slide: nozzle,
    slideRest: -0.14,
    slideTravel: 0.025,
    mag,
    magRest: -0.01,
    muzzle: new THREE.Vector3(0, 0.025, -0.24),
    flashSize: 0.06,
    kick: 0.45,
  };
}

/** A pump shotgun: long barrel, tube magazine, sliding forend, wooden stock. */
function buildShotgun(mats: Mats): GunModel {
  const g = new THREE.Group();
  g.add(box(0.045, 0.06, 0.2, mats.darkMetal, 0, 0.0, 0.02)); // receiver
  g.add(cyl(0.013, 0.5, mats.metal, 0, 0.018, -0.33)); // barrel
  g.add(cyl(0.011, 0.42, mats.darkMetal, 0, -0.012, -0.29)); // tube magazine
  g.add(box(0.004, 0.008, 0.01, new THREE.MeshBasicMaterial({ color: 0xffd060 }), 0, 0.036, -0.56)); // bead sight
  // Pump forend
  const pump = new THREE.Group();
  pump.position.z = -0.2;
  pump.add(cyl(0.022, 0.13, mats.wood, 0, -0.008, 0, 10));
  for (let i = 0; i < 4; i++) pump.add(cyl(0.0225, 0.006, mats.darkMetal, 0, -0.008, -0.05 + i * 0.033, 10));
  // Supporting hand on the pump
  const lh = box(0.06, 0.05, 0.08, mats.glove, -0.005, -0.04, 0);
  pump.add(lh);
  g.add(pump);
  // Stock and grip
  const grip = box(0.034, 0.1, 0.045, mats.wood, 0, -0.06, 0.13);
  grip.rotation.x = 0.35;
  g.add(grip);
  const stock = box(0.04, 0.07, 0.12, mats.wood, 0, -0.035, 0.22);
  stock.rotation.x = 0.12;
  g.add(stock);
  hand(g, mats, -0.06, 0.13, 0.35);

  g.position.set(0.15, -0.15, -0.46);
  g.rotation.set(0.04, 0.05, -0.02);
  return {
    group: g,
    slide: pump,
    slideRest: -0.2,
    slideTravel: 0.07,
    mag: null,
    magRest: 0,
    muzzle: new THREE.Vector3(0, 0.018, -0.6),
    flashSize: 0.34,
    kick: 1.8,
  };
}

/** The auto-injector from a medkit, held in the left hand. */
function buildInjector(mats: Mats): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.14, 12),
    new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.4 })
  );
  g.add(body);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 0.03, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8432f, roughness: 0.5 })
  );
  cap.position.y = 0.08;
  g.add(cap);
  const gauge = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.05, 0.012), new THREE.MeshBasicMaterial({ color: 0x9adfff }));
  gauge.position.set(0.013, 0, 0);
  g.add(gauge);
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.045), mats.glove);
  fist.position.y = -0.03;
  g.add(fist);
  return g;
}
