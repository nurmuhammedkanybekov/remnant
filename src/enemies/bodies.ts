import * as THREE from "three";
import type { CreatureLook, EnemyDef } from "../content/enemies";
import { textures } from "../fx/textures";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** What a body needs to know to animate one frame. Produced by `Enemy` from its AI state. */
export interface Pose {
  time: number;
  /** Ground speed right now. */
  speed: number;
  /** Walk-cycle phase, advanced by distance travelled. */
  walkPhase: number;
  hunting: boolean;
  /** The attack in progress: which kind, which phase and how far through it (0..1). */
  attack: { kind: "melee" | "ranged"; phase: "windup" | "recover"; k: number } | null;
  /** 0..1 — flinch from being hit. */
  stagger: number;
  /** Locked in place (a Watcher in the light): hold the pose and tremble. */
  frozen: boolean;
}

/**
 * A creature's visible body. `Enemy` owns the root (position and facing);
 * the body lives under it and handles its own joints, hit volumes and
 * death animation, so every creature type can have its own rig.
 */
export interface CreatureBody {
  /** Child of the enemy's root. Enemies move it for ceiling-clinging and drops. */
  readonly group: THREE.Group;
  /** World-space hit volumes: the head (bonus damage) and the rest. */
  hitVolumes(): { head: THREE.Sphere; body: THREE.Sphere[] };
  /** World position projectiles are launched from. */
  mouth(): THREE.Vector3;
  pose(p: Pose): void;
  /** `k` is the eased 0..1 progress of the death animation. */
  die(k: number): void;
  /** Hit flash (0..1) and how agitated the veins are (0..1). */
  glow(flash: number, agitation: number, time: number): void;
}

export function buildBody(def: EnemyDef): CreatureBody {
  switch (def.look.rig) {
    case "rat":
      return new RatBody(def);
    case "mass":
      return new MassBody(def);
    default:
      return new HumanoidBody(def);
  }
}

// ---------------------------------------------------------------- shared

/** Tinted flesh with the Remnant's veins glowing through it. One per creature, so hit flashes are individual. */
function fleshMaterial(tint: number, veins: number): THREE.MeshStandardMaterial {
  const tex = textures();
  // Waxy, bloodless, slick: the tint (lifted, so the skin texture shows),
  // a soft fleshy sheen at the edges, a thin film of wet over it, and the
  // skin's creases pushed hard so they catch the light.
  // Each kind's tint only leans the colour: underneath, every one is the same dead grey-green.
  const color = new THREE.Color(0x4c4842).lerp(new THREE.Color(tint).multiplyScalar(2.2), 0.3);
  return new THREE.MeshPhysicalMaterial({
    color,
    map: tex.flesh,
    normalMap: tex.skin,
    normalScale: new THREE.Vector2(1.8, 1.8),
    roughness: 0.68,
    metalness: 0.0,
    specularIntensity: 0.45,
    sheen: 0.35,
    sheenColor: new THREE.Color(0x3a3230),
    sheenRoughness: 0.6,
    clearcoat: 0.12,
    clearcoatRoughness: 0.55,
    emissive: veins,
    emissiveMap: tex.veins,
    emissiveIntensity: 0.1,
  });
}

function glowSprite(color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textures().glow,
      color,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  s.scale.setScalar(size);
  return s;
}

const FLASH = new THREE.Color(1, 0.25, 0.1);

/**
 * Glowing eyes are only frightening up close: seen from across a room they
 * give the creature away, and in the dark two red dots aren't scary, they're
 * a marker. So eyes fade with distance from the camera — fully lit within
 * EYE_NEAR, gone by EYE_FAR — reaching a little further when it's hunting.
 */
const EYE_NEAR = 3.5;
const EYE_FAR = 9;
const eyeTmp = new THREE.Vector3();
const camTmp = new THREE.Vector3();

export function eyeFade(distance: number, agitation: number): number {
  const near = EYE_NEAR + agitation * 1.5;
  const far = EYE_FAR + agitation * 3;
  return THREE.MathUtils.clamp((far - distance) / (far - near), 0, 1);
}

/** Makes an eye sprite fade with distance. Its brightness is set through `userData.base` / `userData.agitation`. */
function fadingEye(glow: THREE.Sprite): THREE.Sprite {
  glow.userData.base = 0.4;
  glow.userData.agitation = 0;
  glow.onBeforeRender = (_r, _s, camera) => {
    const d = camera.getWorldPosition(camTmp).distanceTo(glow.getWorldPosition(eyeTmp));
    glow.material.opacity = glow.userData.base * eyeFade(d, glow.userData.agitation);
  };
  return glow;
}

/**
 * The same fade for a body's own glow (veins, growths, the Spitter's sac):
 * in the dark it would show the creature from across the room, so it only
 * shows up close. Measured as the body is drawn, so it lags one frame.
 */
class ViewFade {
  value = 0;
  agitation = 0;

  constructor(mesh: THREE.Mesh) {
    mesh.onBeforeRender = (_r, _s, camera) => {
      this.value = eyeFade(camera.getWorldPosition(camTmp).distanceTo(mesh.getWorldPosition(eyeTmp)), this.agitation);
    };
  }
}

/** A small repeatable random stream, so every creature of a kind grows the same way. */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Shared vein pulse + hit flash for any flesh material. `fade` dims the veins (not the hit flash) with distance. */
function applyGlow(skin: THREE.MeshStandardMaterial, veins: THREE.Color, flash: number, agitation: number, time: number, fade = 1): void {
  const pulse = 0.5 + 0.5 * Math.sin(time * (2 + agitation * 7));
  skin.emissive.copy(veins).lerp(FLASH, flash);
  skin.emissiveIntensity = (0.05 + agitation * 0.18 + pulse * (0.04 + agitation * 0.2)) * fade + flash * 3;
}

// ---------------------------------------------------------------- organic shapes

/** Smooth 3D value noise in -1..1: what makes flesh lumpy instead of perfectly round. */
function noise3(x: number, y: number, z: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const h = (i: number, j: number, k: number) => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const s = (t: number) => t * t * (3 - 2 * t);
  const tx = s(x - fx);
  const ty = s(y - fy);
  const tz = s(z - fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dz: number) =>
    lerp(lerp(h(fx, fy, fz + dz), h(fx + 1, fy, fz + dz), tx), lerp(h(fx, fy + 1, fz + dz), h(fx + 1, fy + 1, fz + dz), tx), ty);
  return lerp(c(0), c(1), tz) * 2 - 1;
}

/** Two octaves of it. */
function lumps(x: number, y: number, z: number): number {
  return noise3(x, y, z) * 0.7 + noise3(x * 2.3 + 11, y * 2.3, z * 2.3) * 0.3;
}

interface FleshOpts {
  /** Around-the-axis segments and how many rings along it. */
  seg?: number;
  rings?: number;
  /** How lumpy, as a share of the radius, and how fine the lumps are. */
  lump?: number;
  freq?: number;
  seed?: number;
  /** Squash the cross-section (x, z). */
  flat?: [number, number];
  /** A last word on each vertex (ribs, sockets, a spine): gets the position and the (unit) outward direction. */
  shape?: (p: THREE.Vector3, out: THREE.Vector3) => void;
}

/**
 * A length of flesh hanging down -Y from its pivot: a lathe of `profile`
 * (pairs of [0..1 along the length, radius]), with its surface pushed in
 * and out by noise so no two are the same and nothing is a clean cylinder.
 * Closed at both ends.
 */
function fleshTube(len: number, profile: [number, number][], o: FleshOpts = {}): THREE.BufferGeometry {
  const rings = o.rings ?? 20;
  const seg = o.seg ?? 14;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    let r = 0;
    for (let k = 1; k < profile.length; k++) {
      const [t0, r0] = profile[k - 1];
      const [t1, r1] = profile[k];
      if (t <= t1 || k === profile.length - 1) {
        const u = THREE.MathUtils.clamp((t - t0) / Math.max(1e-6, t1 - t0), 0, 1);
        r = r0 + (r1 - r0) * (u * u * (3 - 2 * u));
        break;
      }
    }
    pts.push(new THREE.Vector2(Math.max(0.0005, r), -t * len));
  }
  // Lathe goes bottom-up for outward-facing normals.
  pts.reverse();
  const g = new THREE.LatheGeometry(pts, seg);
  displace(g, o);
  return g;
}

/** Pushes every vertex out or in along its radial direction (from the Y axis) by noise, then any `shape`, then re-smooths. */
function displace(g: THREE.BufferGeometry, o: FleshOpts, radialFromAxis = true): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const out = new THREE.Vector3();
  const f = o.freq ?? 9;
  const lump = o.lump ?? 0.18;
  const seed = o.seed ?? 0;
  const [fx, fz] = o.flat ?? [1, 1];
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (radialFromAxis) out.set(p.x, 0, p.z);
    else out.copy(p);
    const r = out.length();
    if (r > 1e-5) out.divideScalar(r);
    const n = lumps(p.x * f + seed, p.y * f, p.z * f - seed);
    p.addScaledVector(out, r * lump * n);
    p.x *= fx;
    p.z *= fz;
    o.shape?.(p, out);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
}

/** Reverses each triangle (for a geometry that was mirrored, so its faces point outward again). */
function flipWinding(g: THREE.BufferGeometry): void {
  const idx = g.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  }
  g.computeVertexNormals();
}

/** A lumpy blob (a growth, a fused shoulder, a pustule). */
function fleshBlob(r: number, seed: number, lump = 0.25, detail = 3): THREE.BufferGeometry {
  // Welded first (the icosphere comes with every corner duplicated, which shades flat and faceted),
  // then wrapped with a spherical UV so the skin texture still lies on it.
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    uv[i * 2] = 0.5 + Math.atan2(z, x) / (Math.PI * 2);
    uv[i * 2 + 1] = 0.5 + Math.asin(THREE.MathUtils.clamp(y / r, -1, 1)) / Math.PI;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  displace(g, { lump, freq: 7 / Math.max(0.05, r * 4), seed }, false);
  return g;
}

/** A limb segment on a pivot: knotted at the top joint, wasted in the middle, knuckled at the far end. */
function limb(parent: THREE.Object3D, mat: THREE.Material, len: number, radius: number, y: number, x = 0, seed = 0): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const profile: [number, number][] = [
    [0, radius * 0.35],
    [0.05, radius * 1.05],
    [0.14, radius * 1.18],
    [0.32, radius * 0.98],
    [0.62, radius * 0.7],
    [0.86, radius * 0.66],
    [0.94, radius * 0.86],
    [1, radius * 0.3],
  ];
  // Long enough to run into the next joint, so no gap opens when it bends.
  const mesh = new THREE.Mesh(fleshTube(len + radius * 3, profile, { seed, lump: 0.3, freq: 11, flat: [1, 0.84] }), mat);
  mesh.position.y = radius * 0.8;
  pivot.add(mesh);
  parent.add(pivot);
  return pivot;
}

// ---------------------------------------------------------------- humanoid

/**
 * A gaunt, hunched humanoid. Every part is a lathe of flesh pushed out of
 * shape by noise (no clean spheres or tubes, nothing symmetrical): knotted
 * joints, wasted limbs, ribs and spine showing through a starved torso, a
 * long misshapen skull with sunken sockets. Proportions are pushed (long
 * arms, forward-jutting head) so the silhouette reads as "wrong" even in
 * near-darkness, and each creature type pushes them differently: the
 * Brute's fused bulk, the Watcher's height, the Crawler's reach, the
 * Listener's opened skull, the Spitter's throat sac.
 */
class HumanoidBody implements CreatureBody {
  readonly group = new THREE.Group();
  private readonly skin: THREE.MeshStandardMaterial;
  private readonly veinColor: THREE.Color;
  private readonly body = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly jaw: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly foreL: THREE.Group;
  private readonly foreR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private readonly shinL: THREE.Group;
  private readonly shinR: THREE.Group;
  private readonly eyes: THREE.Mesh[] = [];
  private readonly eyeGlow: THREE.Sprite[] = [];
  private eyeAgitation = 0;
  private readonly petals: THREE.Mesh[] = [];
  private readonly sac: THREE.Mesh | null = null;
  private readonly sacMat: THREE.MeshStandardMaterial | null = null;
  private readonly viewFade: ViewFade;
  private readonly chest: THREE.Mesh;
  private readonly growths: THREE.MeshStandardMaterial;
  /** Each creature spasms on its own rhythm. */
  private readonly seed = Math.random() * 100;
  private readonly look: Required<CreatureLook>;
  private readonly pelvisY: number;
  private readonly scale: number;
  /** 0 = upright, 1 = on all fours. Crawlers rear up to strike. */
  private crawl = 0;
  /** 0..1: how far into its recoil from the light (a Watcher's freeze). */
  private freeze = 0;
  private lastTime = 0;
  private deathPose: { lean: number; head: number } | null = null;

  constructor(def: EnemyDef) {
    const look: Required<CreatureLook> = {
      build: 1,
      arms: 1,
      legs: 1,
      hunch: 0.55,
      eyes: 2,
      skull: "normal",
      sac: false,
      extraHead: false,
      gait: "upright",
      ...def.look,
    };
    this.look = look;
    this.scale = def.scale;
    this.crawl = look.gait === "crawl" ? 1 : 0;
    this.veinColor = new THREE.Color(look.veins);
    const skin = fleshMaterial(def.tint, look.veins);
    this.skin = skin;
    const rand = seeded(def.id);
    const B = look.build;
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c0807, roughness: 0.6 });
    // Old bone and nail: yellowed, not clean white.
    const bone = new THREE.MeshStandardMaterial({ color: 0x5e5240, roughness: 0.45, map: textures().flesh });
    const teethMat = new THREE.MeshStandardMaterial({ color: 0x7a6a4c, roughness: 0.3 });
    // Inside the split skull: wet, dark flesh. Not lit from within: you only see it in your light.
    const inner = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.veins).multiplyScalar(0.12), roughness: 0.25 });

    const L = look.legs;
    this.pelvisY = 0.95 * L;
    this.body.position.y = this.pelvisY;
    this.group.add(this.body);

    // Legs hang from the pelvis: thighs wasted to the bone, knees knotted.
    this.legL = limb(this.body, skin, 0.38 * L, 0.07 * B, 0, -0.12 * B, rand() * 50);
    this.legR = limb(this.body, skin, 0.38 * L, 0.07 * B, 0, 0.12 * B, rand() * 50);
    this.shinL = limb(this.legL, skin, 0.36 * L, 0.052 * B, -0.46 * L, 0, rand() * 50);
    this.shinR = limb(this.legR, skin, 0.36 * L, 0.052 * B, -0.46 * L, 0, rand() * 50);
    for (const shin of [this.shinL, this.shinR]) {
      // Long feet, toes splayed and clawed: no boots, nothing human left about them.
      const foot = new THREE.Mesh(
        fleshTube(
          0.24,
          [
            [0, 0.02],
            [0.2, 0.045],
            [0.7, 0.035],
            [1, 0.012],
          ],
          { seed: rand() * 50, lump: 0.2, flat: [1.3, 0.6] }
        ),
        skin
      );
      foot.rotation.x = -Math.PI / 2;
      foot.position.set(0, -0.43 * L, -0.04);
      shin.add(foot);
    }

    // The torso: starved, ribs and spine pushing out through the skin.
    this.torso.rotation.x = look.hunch;
    this.body.add(this.torso);
    const ribTop = 0.6;
    const ribBottom = 0.26;
    const torsoGeo = fleshTube(
      0.95,
      [
        [0, 0.03],
        [0.06, 0.12],
        [0.14, 0.17],
        [0.3, 0.12],
        [0.45, 0.19],
        [0.62, 0.21],
        [0.78, 0.18],
        [0.9, 0.09],
        [1, 0.04],
      ].map(([t, r]) => [t, r * B] as [number, number]),
      {
        seed: rand() * 50,
        lump: 0.13,
        freq: 9,
        rings: 34,
        seg: 22,
        flat: [1.05, 0.72 * Math.sqrt(B)],
        shape: (p, out) => {
          // The lathe hangs down from y = 0: flip it so it rises from the pelvis.
          const y = -p.y - 0.12;
          p.y = y;
          const front = out.z;
          // Ribs: ridges round the front and flanks, a gap between each.
          if (y > ribBottom && y < ribTop && front > -0.4) {
            const rib = Math.pow(Math.abs(Math.sin((y - ribBottom) * 46)), 6);
            p.addScaledVector(out, 0.016 * rib * B);
          }
          // Under the ribs the belly is sunken.
          if (y > 0.08 && y < ribBottom && front > 0) p.addScaledVector(out, -0.035 * front * B);
          // The spine: a row of knuckles down the back.
          if (front < -0.85 && y > 0 && y < 0.78) p.addScaledVector(out, 0.022 * Math.pow(Math.abs(Math.sin(y * 30)), 3));
          // Shoulder blades.
          if (front < -0.4 && y > 0.48 && y < 0.66) p.addScaledVector(out, 0.02 * Math.sin(((y - 0.48) / 0.18) * Math.PI));
        },
      }
    );
    // The faces were wound the other way by the flip: put them back.
    flipWinding(torsoGeo);
    const chest = new THREE.Mesh(torsoGeo, skin);
    this.torso.add(chest);
    this.chest = chest;
    this.viewFade = new ViewFade(chest);

    // Growths: swollen pustules where the Remnant has taken hold.
    this.growths = new THREE.MeshStandardMaterial({
      color: 0x24120e,
      roughness: 0.25,
      emissive: look.veins,
      emissiveIntensity: 0.35,
      map: textures().flesh,
    });
    for (let i = 0; i < 3 + Math.floor(rand() * 3); i++) {
      const g = new THREE.Mesh(fleshBlob(0.04 + rand() * 0.05, rand() * 50, 0.35), this.growths);
      const a = (rand() - 0.5) * 2.4;
      g.position.set(Math.sin(a) * 0.17 * B, 0.15 + rand() * 0.45, -Math.cos(a) * 0.12 * Math.sqrt(B));
      this.torso.add(g);
    }
    if (B > 1.2) {
      // Fused shoulder masses: several bodies grown into one frame, and the spine grown spikes.
      for (const x of [-0.27, 0.29]) {
        const lump = new THREE.Mesh(fleshBlob(0.17, rand() * 50, 0.3), skin);
        lump.position.set(x * B, 0.58, -0.02);
        lump.scale.set(1, 0.85, 1.1);
        this.torso.add(lump);
      }
      for (let i = 0; i < 4; i++) {
        const ridge = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.16, 5), bone);
        ridge.position.set(0, 0.22 + i * 0.1, -0.15 * Math.sqrt(B));
        ridge.rotation.x = -1.2;
        this.torso.add(ridge);
      }
    }
    if (look.extraHead) {
      // A second, half-absorbed face on the shoulder, mouth open.
      const other = new THREE.Mesh(fleshBlob(0.1, rand() * 50, 0.3), skin);
      other.position.set(-0.32 * B, 0.66, 0.1);
      other.scale.set(0.9, 1.15, 0.8);
      this.torso.add(other);
      const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), dark);
      mouth.position.set(-0.32 * B, 0.6, 0.18);
      mouth.scale.set(1.4, 0.6, 0.6);
      this.torso.add(mouth);
    }
    if (look.sac) {
      const sacMat = new THREE.MeshStandardMaterial({
        color: 0x3a3818,
        roughness: 0.18,
        emissive: look.veins,
        emissiveIntensity: 0.12,
        transparent: true,
        opacity: 0.92,
      });
      const sac = new THREE.Mesh(fleshBlob(0.15, rand() * 50, 0.18), sacMat);
      sac.position.set(0, 0.6, 0.15);
      this.torso.add(sac);
      this.sac = sac;
      this.sacMat = sacMat;
    }

    // Head juts forward on a long, corded neck.
    const neck = new THREE.Mesh(
      fleshTube(
        0.24,
        [
          [0, 0.03],
          [0.1, 0.06],
          [0.5, 0.045],
          [0.9, 0.055],
          [1, 0.03],
        ],
        { seed: rand() * 50, lump: 0.25, freq: 20 }
      ),
      skin
    );
    // From the top of the spine forward and up to the back of the skull.
    neck.position.set(0, 0.7, -0.05);
    neck.rotation.x = -Math.PI / 2 - 0.3;
    this.torso.add(neck);
    this.head.position.set(0, 0.78, 0.16);
    this.head.rotation.x = -look.hunch - 0.2; // counter the torso lean so the face looks ahead
    this.torso.add(this.head);

    if (look.skull === "open") {
      // The skull has opened into a resonating chamber: a wet core ringed by plates of bone.
      const core = new THREE.Mesh(fleshBlob(0.08, rand() * 50, 0.3), inner);
      core.position.y = 0.04;
      this.head.add(core);
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin);
      cup.scale.set(0.9, 1.05, 1.2);
      this.head.add(cup);
      for (let i = 0; i < 5; i++) {
        const pivot = new THREE.Group();
        pivot.rotation.y = (i / 5) * Math.PI * 2;
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI), bone);
        petal.scale.set(0.45, 1.5, 0.3);
        petal.position.set(0, 0.1, 0.09);
        petal.rotation.x = -0.5;
        pivot.add(petal);
        this.head.add(pivot);
        this.petals.push(petal);
      }
    } else {
      // A long, narrow skull, too long at the back, skin pulled tight over it:
      // a heavy brow, sockets sunk deep, cheekbones pushing through.
      const sockets = Array.from({ length: Math.max(2, look.eyes) }, (_, i) => {
        const row = Math.floor(i / 2);
        return new THREE.Vector3((i % 2 === 0 ? -1 : 1) * (0.045 + row * 0.02), row * 0.045, 0.12 - row * 0.012);
      });
      const skullGeo = fleshTube(
        0.36,
        [
          [0, 0.02],
          [0.12, 0.1],
          [0.3, 0.135],
          [0.52, 0.125],
          [0.72, 0.1],
          [0.9, 0.075],
          [1, 0.02],
        ],
        {
          seed: rand() * 50,
          lump: 0.1,
          freq: 11,
          rings: 26,
          seg: 20,
          flat: [0.66, 0.9],
          shape: (p) => {
            // Lay it along +Z (back of the skull behind, face in front), a little higher at the back.
            const z = -p.y - 0.2;
            const y = p.z;
            p.set(p.x, y + Math.max(0, -z) * 0.25, z);
            for (const s of sockets) {
              const d = p.distanceTo(s);
              if (d < 0.05) p.z -= 0.035 * (1 - d / 0.05) ** 2;
            }
            // Brow ridge over the sockets, cheekbones under them.
            if (p.z > 0.05 && Math.abs(p.y - 0.035) < 0.018) p.z += 0.012;
            if (p.z > 0.04 && Math.abs(p.y + 0.035) < 0.015 && Math.abs(p.x) > 0.05) p.x += Math.sign(p.x) * 0.012;
          },
        }
      );
      const skull = new THREE.Mesh(skullGeo, skin);
      this.head.add(skull);
    }

    // Jaw on a hinge, so it can open (wide, for the split skulls): long, lipless.
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.06, 0.0);
    this.head.add(this.jaw);
    const jawLen = look.skull === "split" ? 0.22 : 0.17;
    const jawMesh = new THREE.Mesh(
      fleshTube(
        jawLen,
        [
          [0, 0.02],
          [0.2, 0.05],
          [0.7, 0.04],
          [1, 0.012],
        ],
        { seed: rand() * 50, lump: 0.18, flat: [1.1, 0.55] }
      ),
      skin
    );
    jawMesh.rotation.x = -Math.PI / 2;
    jawMesh.position.set(0, -0.02, -0.02);
    this.jaw.add(jawMesh);
    // The mouth: a dark, wet gullet behind rows of too many teeth, torn back into one cheek.
    const gullet = new THREE.MeshStandardMaterial({ color: 0x120403, roughness: 0.2 });
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), look.skull === "split" ? inner : gullet);
    mouth.scale.set(1.1, 0.4, 0.5);
    mouth.position.set(0, -0.07, 0.12);
    this.head.add(mouth);
    const teeth = look.skull === "split" ? 9 : 8;
    for (let i = 0; i < teeth; i++) {
      const x = (i / (teeth - 1) - 0.5) * 0.12;
      const len = 0.025 + ((i * 7) % 3) * 0.014;
      const upper = new THREE.Mesh(new THREE.ConeGeometry(0.006, len, 4), teethMat);
      upper.position.set(x, -0.055 - len / 2, 0.14 - Math.abs(x) * 0.3);
      upper.rotation.set(Math.PI + (rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4);
      this.head.add(upper);
      const lower = new THREE.Mesh(new THREE.ConeGeometry(0.005, len * 0.8, 4), teethMat);
      lower.position.set(x, -0.005 + len * 0.4, jawLen * 0.75 - Math.abs(x) * 0.3);
      lower.rotation.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4);
      this.jaw.add(lower);
    }

    // Eyes: tiny wet glints deep in the sockets. Blind creatures have none.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4a2a });
    for (let i = 0; i < look.eyes; i++) {
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (0.045 + row * 0.02);
      const y = 0.0 + row * 0.045;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009 - row * 0.0015, 8, 6), eyeMat);
      // The pinprick itself dims with distance too (only the first eye needs to set the shared material).
      if (i === 0) {
        const lit = new THREE.Color(0xff4a2a);
        eye.onBeforeRender = (_r, _s, camera) => {
          const d = camera.getWorldPosition(camTmp).distanceTo(eye.getWorldPosition(eyeTmp));
          eyeMat.color.copy(lit).multiplyScalar(eyeFade(d, this.eyeAgitation));
        };
      }
      eye.position.set(x, y, 0.1 - row * 0.012);
      this.head.add(eye);
      this.eyes.push(eye);
      const glow = fadingEye(glowSprite(def.light === "freezes" ? 0xd8f0ff : 0xff3a1a, 0.06 - row * 0.012));
      glow.userData.size = 0.06 - row * 0.012;
      glow.position.copy(eye.position).z += 0.008;
      this.head.add(glow);
      this.eyeGlow.push(glow);
    }

    // Long arms from the shoulders, ending in long fingers and hooked claws.
    const A = look.arms;
    const sx = B > 1.2 ? 0.24 * B * 0.9 : 0.19 * B;
    this.armL = limb(this.torso, skin, 0.36 * A, 0.05 * B, 0.56, -sx, rand() * 50);
    this.armR = limb(this.torso, skin, 0.36 * A, 0.05 * B, 0.56, sx, rand() * 50);
    this.foreL = limb(this.armL, skin, 0.4 * A, 0.04 * B, -0.44 * A, 0, rand() * 50);
    this.foreR = limb(this.armR, skin, 0.4 * A, 0.04 * B, -0.44 * A, 0, rand() * 50);
    for (const fore of [this.foreL, this.foreR]) {
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.02;
        const len = (0.13 + (i === 1 || i === 2 ? 0.03 : 0)) * A;
        const finger = new THREE.Mesh(
          fleshTube(
            len,
            [
              [0, 0.008],
              [0.1, 0.012],
              [0.35, 0.013],
              [0.5, 0.009],
              [0.65, 0.011],
              [0.9, 0.007],
              [1, 0.003],
            ],
            { seed: rand() * 50, lump: 0.15, seg: 7, rings: 10 }
          ),
          skin
        );
        finger.position.set(x, -0.46 * A, 0.01);
        finger.rotation.set(0.3 + rand() * 0.25, 0, (i - 1.5) * 0.08);
        fore.add(finger);
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.09 * A, 5), bone);
        claw.position.set(x + (i - 1.5) * 0.012, -0.46 * A - len * 0.95, 0.01 + len * 0.35);
        claw.rotation.x = Math.PI + 0.7;
        fore.add(claw);
      }
    }

    this.group.scale.setScalar(def.scale);
  }

  hitVolumes(): { head: THREE.Sphere; body: THREE.Sphere[] } {
    const s = this.scale;
    const head = new THREE.Sphere(this.head.getWorldPosition(new THREE.Vector3()), 0.17 * s);
    const chest = new THREE.Sphere(this.torso.localToWorld(new THREE.Vector3(0, 0.38, 0)), 0.3 * s * Math.max(1, this.look.build * 0.85));
    const hips = new THREE.Sphere(this.body.getWorldPosition(new THREE.Vector3()), 0.26 * s);
    const legs = new THREE.Sphere(this.group.localToWorld(new THREE.Vector3(0, 0.45 * this.look.legs, 0)), 0.25 * s);
    return { head, body: [chest, hips, legs] };
  }

  mouth(): THREE.Vector3 {
    return this.head.localToWorld(new THREE.Vector3(0, -0.06, 0.2));
  }

  glow(flash: number, agitation: number, time: number): void {
    const fade = this.viewFade.value;
    this.viewFade.agitation = agitation;
    applyGlow(this.skin, this.veinColor, flash, agitation, time, fade);
    if (this.sacMat) this.sacMat.emissiveIntensity = 0.12 * fade;
    const pulse = 0.6 + 0.4 * Math.sin(time * (agitation > 0.5 ? 12 : 3));
    this.eyeAgitation = agitation;
    for (const g of this.eyeGlow) {
      // Dim while it's unaware; the fade with distance is applied as it's drawn.
      g.userData.base = (0.35 + agitation * 0.65) * pulse;
      g.userData.agitation = agitation;
      // Eyes flare when it has you.
      g.scale.setScalar(g.userData.size * (1 + agitation * 0.6));
    }
    this.growths.emissiveIntensity = (0.25 + agitation * 0.5 + Math.sin(time * 2.1 + this.seed) * 0.12) * fade + flash;
  }

  pose(p: Pose): void {
    const t = p.time;
    const dt = Math.min(0.1, Math.max(0, t - this.lastTime));
    this.lastTime = t;
    // Caught in the light it recoils quickly, and unfolds again more slowly.
    this.freeze += ((p.frozen ? 1 : 0) - this.freeze) * (1 - Math.exp(-dt * (p.frozen ? 12 : 4)));
    this.torso.rotation.y = 0;
    const crawlTarget = this.look.gait === "crawl" ? (p.attack?.kind === "melee" ? 0.35 : 1) : 0;
    this.crawl += (crawlTarget - this.crawl) * 0.25;
    const stride = Math.min(1, p.speed / 2);
    const s = Math.sin(p.walkPhase);
    const c = Math.cos(p.walkPhase);

    this.legL.rotation.x = s * 0.7 * stride;
    this.legR.rotation.x = -s * 0.7 * stride;
    this.shinL.rotation.x = Math.max(0, -c) * 0.9 * stride + 0.1;
    this.shinR.rotation.x = Math.max(0, c) * 0.9 * stride + 0.1;
    this.body.position.y = this.pelvisY - Math.abs(c) * 0.06 * stride + Math.sin(t * 1.3) * 0.01;

    // Neck spasms: every few seconds the head snaps sideways and back, and it
    // shivers constantly while hunting. Breathing heaves the chest.
    const st = t + this.seed;
    const spasm = Math.max(0, Math.sin(st * 0.9) * Math.sin(st * 2.3)) > 0.82 ? Math.sin(st * 31) * 0.5 : 0;
    const tremor = p.hunting ? Math.sin(t * 43) * 0.03 : 0;
    this.head.rotation.z = Math.sin(t * 0.9 + this.seed) * 0.18 + spasm + tremor;
    this.head.rotation.y = spasm * 0.4;
    const breath = 1 + Math.sin(t * (p.hunting ? 5 : 1.6)) * 0.035;
    this.chest.scale.y = breath;
    // Hunting: the jaw hangs open and chatters.
    let jawOpen = p.hunting ? 0.35 + Math.abs(Math.sin(t * 17)) * 0.2 : 0.08 + Math.max(0, Math.sin(st * 0.7)) * 0.1;

    const hunch = this.look.hunch;
    let armBase = p.hunting ? -1.1 : -0.15;
    let armSwing = s * 0.5 * stride;
    let foreBend = p.hunting ? -0.6 : -0.3;
    let lean = p.hunting ? hunch + 0.2 : hunch;
    let sacSwell = 1;

    const a = p.attack;
    if (a?.kind === "melee") {
      if (a.phase === "windup") {
        armBase = -1.2 - a.k * 1.6; // arms rise up and back
        foreBend = -1.2;
        lean = hunch - 0.2;
      } else {
        const k = Math.min(1, a.k * 6);
        armBase = -2.8 + k * 2.3; // slash down
        foreBend = -0.2;
        lean = hunch + 0.4;
      }
      armSwing = 0;
    } else if (a?.kind === "ranged") {
      if (a.phase === "windup") {
        lean = hunch - 0.5 * a.k; // rear back
        sacSwell = 1 + a.k * 0.8;
        jawOpen = 0.2 + a.k * 0.9;
      } else {
        lean = hunch + 0.35 * (1 - a.k); // lunge forward as it spits
        sacSwell = 0.7 + a.k * 0.3;
        jawOpen = 1.1 * (1 - a.k);
      }
      armBase = -0.5;
      armSwing = 0;
    }
    if (this.look.skull === "split") jawOpen *= 1.6;
    // On all fours: torso level, arms down as front legs (swinging opposite the back legs), head up.
    const cr = this.crawl;
    lean += (Math.PI / 2 - 0.1 - lean) * cr;
    armBase += (-Math.PI / 2 + 0.15 - armBase) * cr;
    armSwing += (-s * 0.6 * stride - armSwing) * cr;
    foreBend *= 1 - cr * 0.7;
    this.head.rotation.x = -this.look.hunch - 0.2 + (this.look.hunch + 0.2 - Math.PI / 2 + 0.25) * cr;
    this.jaw.rotation.x = jawOpen;
    this.armL.rotation.x = armBase + armSwing;
    this.armR.rotation.x = armBase - armSwing;
    this.armL.rotation.z = -0.2;
    this.armR.rotation.z = 0.2;
    this.foreL.rotation.x = foreBend;
    this.foreR.rotation.x = foreBend;
    this.torso.rotation.x = lean - p.stagger * 0.5;
    if (this.sac) this.sac.scale.setScalar(sacSwell + Math.sin(t * 2.2) * 0.05);
    // The Listener's skull plates flex open when it's listening hard.
    const flare = p.hunting ? 0.9 : 0.5 + Math.sin(t * 1.7) * 0.15;
    for (const petal of this.petals) petal.rotation.x = -flare;
    if (this.freeze > 0.001) this.recoil(t);
  }

  /**
   * A Watcher held by the light: it throws its arms up over its face, turns
   * its head away and leans back, shuddering. Blended in by `freeze`, so it
   * flinches into it and eases out of it instead of stopping mid-stride.
   */
  private recoil(t: number): void {
    const f = this.freeze;
    const mix = (from: number, to: number) => from + (to - from) * f;
    // A slow, visible shudder (a fast one looks like the game stuttering).
    const shake = (Math.sin(t * 7.3) * 0.6 + Math.sin(t * 11.9 + 1.3) * 0.4) * 0.05;
    this.armL.rotation.x = mix(this.armL.rotation.x, -1.3 + shake);
    this.armR.rotation.x = mix(this.armR.rotation.x, -1.15 - shake);
    this.armL.rotation.z = mix(this.armL.rotation.z, 0.75);
    this.armR.rotation.z = mix(this.armR.rotation.z, -0.65);
    this.foreL.rotation.x = mix(this.foreL.rotation.x, -1.25);
    this.foreR.rotation.x = mix(this.foreR.rotation.x, -1.05);
    this.head.rotation.y = mix(this.head.rotation.y, 0.75 + shake);
    this.head.rotation.z = mix(this.head.rotation.z, 0.25 + shake * 0.5);
    this.torso.rotation.x = mix(this.torso.rotation.x, this.look.hunch - 0.3 + shake * 0.4);
    this.torso.rotation.y = mix(0, -0.2);
    this.jaw.rotation.x = mix(this.jaw.rotation.x, 0.5 + Math.abs(shake) * 4);
  }

  die(k: number): void {
    // Remember the pose it died in, and go limp from there: without this the
    // hunched torso stays bent forward and the corpse ends up sitting upright.
    if (!this.deathPose) this.deathPose = { lean: this.torso.rotation.x, head: this.head.rotation.x };
    const lerp = (a: number, b: number) => a + (b - a) * k;
    if (this.look.gait === "crawl") {
      // On all fours it just rolls over onto its side.
      this.group.rotation.z = k * (Math.PI / 2 - 0.15);
      this.group.position.y = k * 0.1 * this.scale;
    } else {
      // Falls back flat: legs straight, torso in line with them, arms flung out.
      this.group.rotation.x = -k * (Math.PI / 2 - 0.08);
      this.group.position.y = k * 0.12 * this.scale;
      this.torso.rotation.x = lerp(this.deathPose.lean, -0.08);
    }
    this.body.position.y = lerp(this.body.position.y, this.pelvisY);
    this.head.rotation.x = lerp(this.deathPose.head, -this.look.hunch - 0.2 + 0.5);
    this.head.rotation.z = lerp(this.head.rotation.z, 0.5);
    this.jaw.rotation.x = lerp(this.jaw.rotation.x, 0.45);
    this.legL.rotation.x = lerp(this.legL.rotation.x, -0.08);
    this.legR.rotation.x = lerp(this.legR.rotation.x, 0.12);
    this.shinL.rotation.x = lerp(this.shinL.rotation.x, 0.05);
    this.shinR.rotation.x = lerp(this.shinR.rotation.x, 0.3);
    // Arms splayed out along the floor, not reaching up.
    this.armL.rotation.x = lerp(this.armL.rotation.x, -0.3);
    this.armR.rotation.x = lerp(this.armR.rotation.x, -0.1);
    this.armL.rotation.z = lerp(this.armL.rotation.z, -1.3);
    this.armR.rotation.z = lerp(this.armR.rotation.z, 1.0);
    this.foreL.rotation.x = lerp(this.foreL.rotation.x, -0.4);
    this.foreR.rotation.x = lerp(this.foreR.rotation.x, -0.15);
    for (const e of this.eyes) (e.material as THREE.MeshBasicMaterial).color.setRGB(1 - k * 0.9, 0.2 * (1 - k), 0.1 * (1 - k));
    for (const g of this.eyeGlow) g.visible = false;
    this.skin.emissiveIntensity = 0.1 * (1 - k);
    this.growths.emissiveIntensity = 0.3 * (1 - k);
    this.head.rotation.y = 0;
  }
}

// ---------------------------------------------------------------- rat

/** A rewritten rat: small, low, quick. The Swarm is many of these. */
class RatBody implements CreatureBody {
  readonly group = new THREE.Group();
  private readonly skin: THREE.MeshStandardMaterial;
  private readonly veinColor: THREE.Color;
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly tail: THREE.Group[] = [];
  private readonly eyeGlow: THREE.Sprite[] = [];
  private readonly viewFade: ViewFade;

  constructor(def: EnemyDef) {
    this.veinColor = new THREE.Color(def.look.veins);
    this.skin = fleshMaterial(def.tint, def.look.veins);
    const dark = new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 0.9 });

    this.torso.position.y = 0.13;
    this.group.add(this.torso);
    // A rat gone wrong: lumpy, hunched at the shoulders, mangy.
    const body = new THREE.Mesh(
      fleshTube(
        0.42,
        [
          [0, 0.02],
          [0.12, 0.07],
          [0.45, 0.1],
          [0.7, 0.09],
          [0.88, 0.065],
          [1, 0.03],
        ],
        { seed: 3, lump: 0.25, flat: [0.95, 0.85] }
      ),
      this.skin
    );
    body.rotation.x = -Math.PI / 2;
    body.position.z = -0.22;
    this.torso.add(body);
    this.viewFade = new ViewFade(body);
    // Spines where the Remnant has pushed through.
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07, 4), dark);
      spike.position.set(0, 0.08, -0.08 + i * 0.05);
      spike.rotation.x = -0.4;
      this.torso.add(spike);
    }

    this.head.position.set(0, 0.02, 0.18);
    this.torso.add(this.head);
    const snout = new THREE.Mesh(
      fleshTube(
        0.17,
        [
          [0, 0.045],
          [0.35, 0.05],
          [0.8, 0.025],
          [1, 0.006],
        ],
        { seed: 5, lump: 0.2 }
      ),
      this.skin
    );
    snout.rotation.x = -Math.PI / 2;
    snout.position.z = -0.03;
    this.head.add(snout);
    for (const x of [-0.03, 0.03]) {
      const glow = fadingEye(glowSprite(0xff3a1a, 0.07));
      glow.position.set(x, 0.03, 0.03);
      this.head.add(glow);
      this.eyeGlow.push(glow);
    }

    for (const [x, z] of [
      [-0.07, 0.1],
      [0.07, 0.1],
      [-0.07, -0.1],
      [0.07, -0.1],
    ]) {
      const leg = limb(this.torso, this.skin, 0.06, 0.018, -0.02, x);
      leg.position.z = z;
      this.legs.push(leg);
    }

    let parent: THREE.Object3D = this.torso;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, 0, i === 0 ? -0.18 : -0.06);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012 - i * 0.002, 0.014 - i * 0.002, 0.065, 5), this.skin);
      m.rotation.x = Math.PI / 2;
      m.position.z = -0.03;
      seg.add(m);
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
    }
    this.group.scale.setScalar(def.scale);
  }

  hitVolumes(): { head: THREE.Sphere; body: THREE.Sphere[] } {
    return {
      head: new THREE.Sphere(this.head.getWorldPosition(new THREE.Vector3()), 0.08),
      body: [new THREE.Sphere(this.torso.getWorldPosition(new THREE.Vector3()), 0.17)],
    };
  }

  mouth(): THREE.Vector3 {
    return this.head.getWorldPosition(new THREE.Vector3());
  }

  glow(flash: number, agitation: number, time: number): void {
    this.viewFade.agitation = agitation;
    applyGlow(this.skin, this.veinColor, flash, agitation, time, this.viewFade.value);
    for (const g of this.eyeGlow) {
      g.userData.base = 0.35 + agitation * 0.55;
      g.userData.agitation = agitation;
    }
  }

  pose(p: Pose): void {
    const t = p.time;
    const stride = Math.min(1, p.speed / 2);
    const s = Math.sin(p.walkPhase);
    this.legs.forEach((leg, i) => (leg.rotation.x = (i === 0 || i === 3 ? s : -s) * 0.9 * stride));
    this.torso.position.y = 0.13 + Math.abs(s) * 0.02 * stride;
    this.torso.position.z = 0;
    this.head.rotation.x = Math.sin(t * 11) * 0.1; // sniffing
    this.head.rotation.y = Math.sin(t * 3.1) * 0.2;
    this.tail.forEach((seg, i) => (seg.rotation.y = Math.sin(t * 6 - i * 0.7) * 0.35));
    const a = p.attack;
    if (a) {
      // Lunge and bite.
      const lunge = a.phase === "windup" ? -a.k * 0.06 : (1 - a.k) * 0.14;
      this.torso.position.z = lunge;
      this.head.rotation.x = a.phase === "windup" ? -0.4 * a.k : 0.3;
    }
    this.torso.rotation.x = -p.stagger * 0.4;
  }

  die(k: number): void {
    this.group.rotation.z = k * Math.PI * 0.95;
    this.group.position.y = k * 0.2;
    for (const g of this.eyeGlow) g.visible = false;
    this.skin.emissiveIntensity = 0.5 * (1 - k);
  }
}

// ---------------------------------------------------------------- the Remnant

/**
 * The Remnant itself: a mound of warm, crystalline flesh with a single
 * core that opens to look at you, and tendrils that slam the floor.
 * The core is the weak point; the hide shrugs off most damage.
 */
export class MassBody implements CreatureBody {
  readonly group = new THREE.Group();
  private readonly skin: THREE.MeshStandardMaterial;
  private readonly veinColor: THREE.Color;
  private readonly lumps: THREE.Mesh[] = [];
  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.MeshStandardMaterial;
  private readonly coreGlow: THREE.Sprite;
  private readonly lids: THREE.Mesh[] = [];
  private readonly tendrils: { root: THREE.Group; segs: THREE.Group[]; angle: number; front: boolean }[] = [];
  private readonly crystals: THREE.Mesh[] = [];
  /** 0..1 — how far the core is open. Set by the boss. */
  open = 0;
  /** Heaves harder as the fight goes on. */
  rage = 0;

  constructor(def: EnemyDef) {
    this.veinColor = new THREE.Color(def.look.veins);
    this.skin = fleshMaterial(def.tint, def.look.veins);
    this.skin.roughness = 0.35;
    const crystal = new THREE.MeshStandardMaterial({
      color: 0x8a4a44,
      roughness: 0.15,
      metalness: 0.3,
      emissive: def.look.veins,
      emissiveIntensity: 0.6,
    });

    // The mound
    const lumps: [number, number, number, number][] = [
      [0, 0.9, 0, 1.5],
      [-0.9, 0.7, 0.3, 1.0],
      [0.9, 0.7, 0.2, 1.05],
      [0.2, 1.8, -0.3, 1.0],
      [-0.5, 0.5, -0.9, 0.9],
      [0.6, 0.5, -0.9, 0.85],
      [0, 2.4, -0.1, 0.6],
    ];
    for (const [x, y, z, r] of lumps) {
      const m = new THREE.Mesh(fleshBlob(r, x * 7 + z * 3, 0.16, 4), this.skin);
      m.position.set(x, y, z);
      m.scale.set(1, 0.85, 1);
      m.userData.base = m.position.clone();
      m.userData.radius = r;
      this.group.add(m);
      this.lumps.push(m);
    }
    // Crystalline growths — what the drill broke into.
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.12 + ((i * 37) % 10) * 0.025, 0), crystal);
      const a = (i / 14) * Math.PI * 2;
      const h = 0.4 + ((i * 53) % 17) / 10;
      c.position.set(Math.cos(a) * (1.2 - h * 0.25), h, Math.sin(a) * (1.1 - h * 0.25));
      c.scale.set(0.6, 2, 0.6);
      c.rotation.set(a, 0, 0.4);
      this.group.add(c);
      this.crystals.push(c);
    }

    // The core: an eye the size of a person's torso.
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0xffd0a0, emissive: 0xff6a2a, emissiveIntensity: 0.5, roughness: 0.2 });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), this.coreMat);
    this.core.position.set(0, 1.5, 1.2);
    this.group.add(this.core);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: 0x1a0402 }));
    pupil.position.z = 0.3;
    pupil.scale.set(0.5, 1.3, 0.4);
    this.core.add(pupil);
    this.coreGlow = glowSprite(0xff6a2a, 2.2);
    this.coreGlow.position.copy(this.core.position).z += 0.3;
    this.group.add(this.coreGlow);
    for (const side of [1, -1]) {
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.skin);
      lid.position.copy(this.core.position);
      lid.rotation.x = side > 0 ? 0.2 : Math.PI - 0.2;
      lid.userData.side = side;
      this.group.add(lid);
      this.lids.push(lid);
    }

    // Tendrils around the base; the front ones do the slamming.
    for (let i = 0; i < 7; i++) {
      const angle = -Math.PI * 0.8 + (i / 6) * Math.PI * 1.6;
      const root = new THREE.Group();
      root.position.set(Math.sin(angle) * 1.3, 0.4, Math.cos(angle) * 1.3);
      root.rotation.y = angle;
      this.group.add(root);
      const segs: THREE.Group[] = [];
      let parent: THREE.Object3D = root;
      for (let j = 0; j < 7; j++) {
        const seg = new THREE.Group();
        seg.position.z = j === 0 ? 0 : 0.42;
        const r = 0.16 - j * 0.018;
        // Each length knotted where it joins the next, and long enough to overlap it.
        const m = new THREE.Mesh(
          fleshTube(
            0.52,
            [
              [0, r * 0.6],
              [0.1, r * 1.1],
              [0.5, r * 0.88],
              [0.9, r * 0.92],
              [1, r * 0.5],
            ],
            { seed: i * 11 + j, lump: 0.22, seg: 10, rings: 12 }
          ),
          this.skin
        );
        m.rotation.x = -Math.PI / 2;
        m.position.z = -0.03;
        seg.add(m);
        parent.add(seg);
        segs.push(seg);
        parent = seg;
      }
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 5), crystal);
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.5;
      parent.add(tip);
      this.tendrils.push({ root, segs, angle, front: Math.abs(angle) < 0.7 });
    }
  }

  hitVolumes(): { head: THREE.Sphere; body: THREE.Sphere[] } {
    return {
      head: new THREE.Sphere(this.core.getWorldPosition(new THREE.Vector3()), 0.5),
      body: this.lumps.slice(0, 4).map((l) => new THREE.Sphere(l.getWorldPosition(new THREE.Vector3()), l.userData.radius as number)),
    };
  }

  mouth(): THREE.Vector3 {
    return this.core.localToWorld(new THREE.Vector3(0, 0, 0.6));
  }

  glow(flash: number, agitation: number, time: number): void {
    applyGlow(this.skin, this.veinColor, flash, Math.max(agitation, this.rage), time);
    // The mass glows from within far more than anything it has made.
    this.skin.emissiveIntensity += 0.45 + this.rage * 0.4 + Math.sin(time * 1.3) * 0.1;
    const o = this.open;
    this.coreMat.emissiveIntensity = 0.3 + o * 2.5 + Math.sin(time * 5) * 0.2 * o;
    this.coreGlow.material.opacity = 0.15 + o * 0.75;
  }

  pose(p: Pose): void {
    const t = p.time;
    const heave = 1 + this.rage * 1.5;
    this.lumps.forEach((l, i) => {
      const k = 1 + Math.sin(t * (1.1 + i * 0.13) * heave + i) * 0.035 * heave;
      l.scale.set(k, 0.85 * (2 - k), k);
    });
    for (const c of this.crystals) c.rotation.y += 0.002;
    // Lids part as the core opens.
    for (const lid of this.lids) {
      const side = lid.userData.side as number;
      lid.rotation.x = side > 0 ? 0.2 - this.open * 1.1 : Math.PI - 0.2 + this.open * 1.1;
    }
    this.core.rotation.x = Math.sin(t * 0.7) * 0.1;
    this.core.rotation.y = Math.sin(t * 0.5) * 0.15;

    const a = p.attack?.kind === "melee" ? p.attack : null;
    for (const td of this.tendrils) {
      let lift = 0;
      if (a && td.front) lift = a.phase === "windup" ? a.k : 1 - Math.min(1, a.k * 5) * 2;
      td.root.rotation.x = -0.25 - lift * 1.1;
      td.segs.forEach((seg, j) => {
        const wave = Math.sin(t * (1.6 + this.rage) - j * 0.6 + td.angle * 3) * (0.18 + this.rage * 0.1);
        seg.rotation.x = (lift < 0 ? 0.2 : 0.08 + lift * -0.12) + (a && td.front ? 0 : wave);
        seg.rotation.y = Math.cos(t * 1.2 - j * 0.5 + td.angle) * 0.12;
      });
    }
  }

  die(k: number): void {
    this.group.position.y = -k * 1.6;
    this.group.scale.set(1 + k * 0.2, 1 - k * 0.5, 1 + k * 0.2);
    this.open = 1 - k;
    this.skin.emissiveIntensity = 0.8 * (1 - k);
    this.coreMat.emissiveIntensity = 3 * (1 - k);
    this.coreGlow.material.opacity = 0.9 * (1 - k);
  }
}
