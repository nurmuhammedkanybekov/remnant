import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import * as THREE from "three";
import type { LookDef } from "../content/characters";

/** A box with softened edges: cloth, leather and moulded plastic, not blocks. */
function rbox(w: number, h: number, d: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.3);
}

/**
 * The co-op partner's body: a miner in a coverall and hi-vis vest with a
 * hard hat, built from simple shapes so it costs almost nothing to draw.
 * Face, hair, build and skin come from their chosen look.
 *
 * Returns the jointed groups `RemotePlayer` animates: legs swing from the
 * hips, the head and arms follow the look pitch. Feet at y = 0, facing -Z.
 */
export interface CharacterParts {
  hips: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  arms: THREE.Group;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();
/** Materials are shared between rebuilds (and both looks of the same colour). */
function mat(color: number, roughness = 0.85, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = `${color}:${roughness}:${JSON.stringify(extra)}`;
  let m = materials.get(key);
  if (!m) materials.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness, ...extra })));
  return m;
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  return o;
}

/** A rounded limb segment hanging down from its top (y = 0) by `len`. */
function limb(radius: number, len: number, m: THREE.Material, taper = 0.85): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius * 2), 4, 10);
  const pos = geo.attributes.position;
  // Narrower towards the bottom.
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + len / 2) / len;
    const s = taper + (1 - taper) * t;
    pos.setX(i, pos.getX(i) * s);
    pos.setZ(i, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return mesh(geo, m, 0, -len / 2, 0);
}

/** A rounded limb from `a` to `b`. */
function segment(a: THREE.Vector3, b: THREE.Vector3, radius: number, m: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const o = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius), 4, 10), m);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return o;
}

export function buildCharacter(look: LookDef): CharacterParts {
  const coverall = mat(look.coverall, 0.9);
  const vest = mat(0xc7861c, 0.65, { emissive: 0x1c1000 });
  // Reflective tape: faintly lit even in the dark and bright in any light, like the real thing,
  // so partners can find each other down a black corridor.
  const reflective = mat(0xe8e8dc, 0.25, { emissive: 0x4a4a42, metalness: 0.35 });
  const glove = mat(0x221b16, 0.75);
  const dark = mat(0x1b1c1e, 0.6, { metalness: 0.3 });
  const leather = mat(0x2a2018, 0.8);
  const skin = mat(look.skin, 0.7);
  const hair = mat(look.hair, 0.95);
  const helmet = mat(look.helmet, 0.38);
  const eyeWhite = mat(0xe8e2d8, 0.5);
  const iris = mat(0x1a1410, 0.3);
  const s = look.shoulders;

  // --- legs: thigh and shin, boots.
  const hips = new THREE.Group();
  const leg = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0.92, 0);
    g.add(limb(0.09, 0.47, coverall));
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    knee.add(limb(0.075, 0.42, coverall));
    const boot = mesh(rbox(0.15, 0.12, 0.28), leather, 0, -0.41, -0.05);
    knee.add(boot);
    knee.add(mesh(rbox(0.13, 0.13, 0.05), dark, 0, -0.02, -0.075)); // knee pad
    const tape = new THREE.CylinderGeometry(0.078, 0.074, 0.035, 12, 1, true);
    knee.add(mesh(tape, reflective, 0, -0.26, 0)); // tape round the shin
    knee.add(mesh(rbox(0.16, 0.03, 0.3), dark, 0, -0.465, -0.05)); // sole
    g.add(knee);
    hips.add(g);
    return g;
  };
  const legL = leg(-0.1 * s);
  const legR = leg(0.1 * s);
  hips.add(mesh(rbox(0.34 * s, 0.16, 0.22), coverall, 0, 0.96, 0)); // pelvis

  // --- torso: tapered chest, vest with reflective bands, belt, pack.
  const torso = new THREE.Group();
  torso.position.y = 0.92;
  const chestGeo = new THREE.CylinderGeometry(0.2 * s, 0.16 * (0.9 + s * 0.1), 0.6, 12);
  chestGeo.scale(1, 1, 0.62);
  torso.add(mesh(chestGeo, coverall, 0, 0.3, 0));
  const vestGeo = new THREE.CylinderGeometry(0.21 * s, 0.175, 0.42, 12, 1, true);
  vestGeo.scale(1, 1, 0.66);
  torso.add(mesh(vestGeo, vest, 0, 0.34, 0));
  for (const y of [0.22, 0.4]) {
    const band = new THREE.CylinderGeometry(0.206 * s - (0.4 - y) * 0.05, 0.206 * s - (0.4 - y) * 0.05, 0.035, 12, 1, true);
    band.scale(1, 1, 0.67);
    torso.add(mesh(band, reflective, 0, y, 0));
  }
  const belt = new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12);
  belt.scale(1, 1, 0.65);
  torso.add(mesh(belt, leather, 0, 0.04, 0));
  torso.add(mesh(rbox(0.06, 0.05, 0.02), mat(0x8a8a80, 0.4, { metalness: 0.7 }), 0, 0.04, -0.115)); // buckle
  torso.add(mesh(rbox(0.3 * s, 0.36, 0.13), dark, 0, 0.36, 0.17)); // pack
  for (const x of [-1, 1]) {
    // Pack straps over the shoulders, and a chest pocket each side.
    const strap = mesh(rbox(0.035, 0.42, 0.012), leather, x * 0.1 * s, 0.37, -0.128);
    strap.rotation.z = x * 0.08;
    torso.add(strap);
    torso.add(mesh(rbox(0.075, 0.07, 0.015), vest, x * 0.1 * s, 0.33, -0.137));
    // Tape crossed on the back of the pack, so you know them from behind too.
    const cross = mesh(rbox(0.34 * s, 0.03, 0.01), reflective, 0, 0.36, 0.237);
    cross.rotation.z = x * 0.8;
    torso.add(cross);
  }
  const collar = new THREE.TorusGeometry(0.075, 0.022, 6, 14);
  collar.rotateX(Math.PI / 2);
  torso.add(mesh(collar, coverall, 0, 0.64, 0));
  torso.add(mesh(rbox(0.05, 0.05, 0.03), mat(0x2a5a2a, 0.5, { emissive: 0x0a3a0a }), 0.1, 0.5, -0.12)); // radio
  for (const x of [-1, 1]) torso.add(mesh(new THREE.SphereGeometry(0.075, 10, 8), coverall, x * 0.2 * s, 0.56, 0)); // shoulders

  // --- head: neck, face, eyes, nose, ears, hair, hard hat.
  const head = new THREE.Group();
  head.position.y = 0.66;
  head.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skin, 0, 0.0, 0));
  const skull = new THREE.SphereGeometry(0.105, 18, 14);
  skull.scale(0.9, 1.12, 1);
  head.add(mesh(skull, skin, 0, 0.13, 0));
  const jaw = new THREE.SphereGeometry(0.075, 12, 8);
  jaw.scale(1.05, 0.7, 1);
  head.add(mesh(jaw, skin, 0, 0.07, -0.02));
  for (const x of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), eyeWhite, x * 0.036, 0.145, -0.088));
    head.add(mesh(new THREE.SphereGeometry(0.009, 8, 6), iris, x * 0.036, 0.145, -0.1));
    head.add(mesh(rbox(0.04, 0.008, 0.01), hair, x * 0.037, 0.172, -0.095)); // brow
    const ear = mesh(new THREE.SphereGeometry(0.022, 8, 6), skin, x * 0.095, 0.13, 0.005);
    ear.scale.set(0.5, 1, 0.8);
    head.add(ear);
  }
  const nose = mesh(new THREE.ConeGeometry(0.018, 0.045, 6), skin, 0, 0.12, -0.105);
  nose.rotation.x = -Math.PI / 2 + 0.3;
  head.add(nose);
  head.add(mesh(rbox(0.04, 0.006, 0.01), mat(0x5a2a24, 0.6), 0, 0.078, -0.085)); // mouth

  // Hair: a cap over the crown, tilted so it sits high on the forehead and low at the back.
  const crown = (theta: number) => {
    const g = new THREE.SphereGeometry(0.112, 16, 10, 0, Math.PI * 2, 0, theta);
    g.scale(0.93, 1.12, 1.04);
    const m = mesh(g, hair, 0, 0.135, 0.006);
    m.rotation.x = 0.45;
    return m;
  };
  head.add(crown(look.hairStyle === "cropped" ? Math.PI * 0.4 : Math.PI * 0.46));
  if (look.hairStyle === "ponytail") {
    const tailRoot = new THREE.Group();
    tailRoot.position.set(0, 0.15, 0.1);
    tailRoot.rotation.x = -0.3;
    tailRoot.add(limb(0.035, 0.26, hair, 0.5));
    head.add(tailRoot);
    head.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), hair, 0, 0.155, 0.105)); // tie
    for (const x of [-1, 1]) {
      const side = mesh(rbox(0.02, 0.09, 0.07), hair, x * 0.088, 0.12, 0.02); // hair over the ears
      head.add(side);
    }
  }
  if (look.beard) {
    // A short beard along the jaw and chin.
    // The face is towards -Z, which is phi = 1.5π on a sphere.
    const beard = new THREE.SphereGeometry(0.079, 14, 8, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.5, Math.PI * 0.32);
    beard.scale(1.08, 1.05, 1.08);
    head.add(mesh(beard, hair, 0, 0.085, -0.018));
  }
  const hat = new THREE.SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  hat.scale(1, 0.82, 1.12);
  head.add(mesh(hat, helmet, 0, 0.2, 0));
  const brim = new THREE.CylinderGeometry(0.16, 0.16, 0.015, 18);
  brim.scale(1, 1, 1.15);
  head.add(mesh(brim, helmet, 0, 0.2, -0.015));
  head.add(mesh(rbox(0.02, 0.03, 0.26), helmet, 0, 0.31, 0)); // ridge
  head.add(mesh(rbox(0.07, 0.05, 0.04), dark, 0, 0.25, -0.15)); // lamp housing
  torso.add(head);

  // --- arms: shoulder to elbow to hands on the gun, pointing where they look.
  const arms = new THREE.Group();
  arms.position.y = 0.52;
  for (const x of [-1, 1]) {
    const shoulder = new THREE.Vector3(x * 0.2 * s, 0.03, 0);
    const elbow = new THREE.Vector3(x * 0.2 * s, -0.22, -0.16);
    const wrist = new THREE.Vector3(x * 0.045, -0.06, -0.42);
    arms.add(segment(shoulder, elbow, 0.062, coverall));
    arms.add(segment(elbow, wrist, 0.052, coverall));
    arms.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), coverall, elbow.x, elbow.y, elbow.z));
    // A band of tape round each upper arm.
    arms.add(segment(shoulder.clone().lerp(elbow, 0.45), shoulder.clone().lerp(elbow, 0.62), 0.066, reflective));
    const hand = mesh(rbox(0.065, 0.085, 0.08), glove, x * 0.035, -0.07, -0.47);
    hand.rotation.x = 0.3;
    arms.add(hand);
  }
  const gun = new THREE.Group();
  gun.position.set(0, 0.0, -0.5);
  gun.add(mesh(rbox(0.05, 0.07, 0.32), dark));
  gun.add(mesh(rbox(0.045, 0.1, 0.05), dark, 0, -0.07, 0.08));
  arms.add(gun);
  torso.add(arms);

  return { hips, legL, legR, torso, head, arms };
}
