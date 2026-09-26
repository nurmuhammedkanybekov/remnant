import * as THREE from "three";
import { textures } from "../fx/textures";

/** Handles to the animated joints of a creature rig. */
export interface CreatureRig {
  root: THREE.Group;
  body: THREE.Group; // pelvis pivot — everything above the legs
  torso: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Mesh;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  skin: THREE.MeshStandardMaterial;
  eyes: THREE.Mesh[];
  eyeGlow: THREE.Sprite[];
}

function limb(parent: THREE.Object3D, mat: THREE.Material, len: number, radius: number, y: number, x = 0): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 4, 8), mat);
  mesh.position.y = -len / 2;
  pivot.add(mesh);
  parent.add(pivot);
  return pivot;
}

/**
 * A gaunt, hunched humanoid built from primitives. Proportions are pushed
 * (long arms, forward-jutting head) so the silhouette reads as "wrong"
 * even in near-darkness.
 */
export function buildCreature(tint: number, scale: number): CreatureRig {
  const skin = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.75, metalness: 0.05, emissive: 0x000000 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 0.9 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xb8ab90, roughness: 0.6 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.95;
  root.add(body);

  // Legs hang from the pelvis
  const legL = limb(body, skin, 0.38, 0.075, 0, -0.13);
  const legR = limb(body, skin, 0.38, 0.075, 0, 0.13);
  const shinL = limb(legL, skin, 0.36, 0.06, -0.46);
  const shinR = limb(legR, skin, 0.36, 0.06, -0.46);
  for (const shin of [shinL, shinR]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.22), dark);
    foot.position.set(0, -0.44, 0.06);
    shin.add(foot);
  }

  // Torso leans forward
  const torso = new THREE.Group();
  torso.rotation.x = 0.55;
  body.add(torso);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), skin);
  pelvis.scale.set(1.1, 0.7, 0.8);
  torso.add(pelvis);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), skin);
  chest.position.y = 0.36;
  chest.scale.set(1.15, 1, 0.75);
  torso.add(chest);
  // Exposed ribs / spine ridges
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 4, 12, Math.PI), bone);
    rib.position.set(0, 0.24 + i * 0.08, 0.02);
    rib.rotation.set(Math.PI / 2, 0, 0);
    rib.scale.set(1.15, 0.8, 1);
    torso.add(rib);
    const ridge = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 5), bone);
    ridge.position.set(0, 0.22 + i * 0.1, -0.15);
    ridge.rotation.x = -1.2;
    torso.add(ridge);
  }

  // Head juts forward on a long neck
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.18, 4, 8), skin);
  neck.position.set(0, 0.68, 0.06);
  neck.rotation.x = 0.6;
  torso.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.78, 0.16);
  head.rotation.x = -0.75; // counter the torso lean so the face looks ahead
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
  skull.scale.set(0.9, 1.05, 1.2);
  head.add(skull);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.08), dark);
  brow.position.set(0, 0.03, 0.12);
  head.add(brow);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.14), skin);
  jaw.position.set(0, -0.1, 0.07);
  head.add(jaw);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.02), dark);
  mouth.position.set(0, -0.07, 0.15);
  head.add(mouth);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4a2a });
  const eyes: THREE.Mesh[] = [];
  const eyeGlow: THREE.Sprite[] = [];
  for (const x of [-0.045, 0.045]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat);
    eye.position.set(x, 0.0, 0.145);
    head.add(eye);
    eyes.push(eye);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures().glow,
        color: 0xff3a1a,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.scale.setScalar(0.16);
    glow.position.copy(eye.position).z += 0.01;
    head.add(glow);
    eyeGlow.push(glow);
  }

  // Long arms from the shoulders
  const armL = limb(torso, skin, 0.36, 0.055, 0.56, -0.27);
  const armR = limb(torso, skin, 0.36, 0.055, 0.56, 0.27);
  const foreL = limb(armL, skin, 0.4, 0.045, -0.44);
  const foreR = limb(armR, skin, 0.4, 0.045, -0.44);
  for (const fore of [foreL, foreR]) {
    for (let i = -1; i <= 1; i++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.14, 5), bone);
      claw.position.set(i * 0.025, -0.53, 0.02);
      claw.rotation.x = Math.PI + 0.3;
      fore.add(claw);
    }
  }

  root.scale.setScalar(scale);
  return { root, body, torso, head, jaw, armL, armR, foreL, foreR, legL, legR, shinL, shinR, skin, eyes, eyeGlow };
}
