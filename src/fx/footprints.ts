import * as THREE from "three";
import { textures } from "./textures";

/** What a print is made of: how it looks and how long it lasts. */
export type PrintKind = "wet" | "blood" | "snow";

/** Prints kept at once (per foot type); the oldest is reused. */
const MAX_PRINTS = 160;
/** Seconds a print takes to go (wet ones dry; snow fills them in slowly). */
const LIFE: Record<PrintKind, number> = { wet: 45, blood: 240, snow: 400 };
/**
 * The print's own surface: its colour (lit like the floor, so it shows
 * under the brightest torch) and how much of the sole's shape is there at
 * full strength. Wet prints are dark; in the snow, a pressed hollow is a
 * grey-blue shade of the white.
 */
const LOOK: Record<PrintKind, { color: number; cover: number }> = {
  wet: { color: 0x1a1c1e, cover: 0.75 },
  blood: { color: 0x3a0705, cover: 0.95 },
  snow: { color: 0x6f7c8e, cover: 0.9 },
};
/** Print size in metres (width, length) of the quad holding it. */
const SIZE = { boot: [0.24, 0.34], bare: [0.22, 0.38] } as const;

/** One set of prints: boots, or bare feet. */
class PrintSet {
  readonly mesh: THREE.InstancedMesh;
  private readonly timing: THREE.InstancedBufferAttribute;
  private cursor = 0;
  private readonly uTime = { value: 0 };

  constructor(scene: THREE.Scene, half: 0 | 1) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // x: birth time, y: life, z: how much of the print is there (0..1).
    this.timing = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRINTS * 3), 3);
    geo.setAttribute("aTiming", this.timing);
    const mask = textures().footprint.clone();
    mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;
    mask.repeat.set(0.5, 1);
    mask.offset.set(half * 0.5, 0);
    mask.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      alphaMap: mask,
      // Stochastic transparency: no sorting against the snow and the water, and it fades print by print.
      alphaHash: true,
      roughness: 0.85,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      // A right foot is a mirrored left one: both faces.
      side: THREE.DoubleSide,
    });
    const uTime = this.uTime;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 aTiming;\nuniform float uTime;\nvarying float vFade;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          {
            float age = (uTime - aTiming.x) / max(aTiming.y, 0.001);
            // Strong at first, then going over the last two thirds of its life.
            vFade = aTiming.y > 0.0 ? clamp(1.0 - (age - 0.33) / 0.67, 0.0, 1.0) * step(age, 1.0) * aTiming.z : 0.0;
          }`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vFade;")
        .replace("#include <alphamap_fragment>", "#include <alphamap_fragment>\ndiffuseColor.a *= vFade;");
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PRINTS);
    this.mesh.frustumCulled = false;
    // Lies flat on the floor: catches the torch's shadows, never casts one.
    this.mesh.userData.noShadowCast = true;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < MAX_PRINTS; i++) {
      this.mesh.setMatrixAt(i, hidden);
      this.mesh.setColorAt(i, white);
    }
    scene.add(this.mesh);
  }

  place(matrix: THREE.Matrix4, color: THREE.Color, birth: number, life: number, cover: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PRINTS;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, color);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.timing.setXYZ(i, birth, life, cover);
    this.timing.needsUpdate = true;
  }

  update(time: number): void {
    this.uTime.value = time;
  }
}

/**
 * Footprints on the floor: wet ones after you've waded, bloody ones after
 * you've walked through what you killed, and in the snow everyone leaves
 * tracks, you and whatever else is out there. A print is a small lit
 * surface of its own (so it reads under any light) that fades on its own
 * clock in the shader: nothing is touched per frame but the time.
 */
export class Footprints {
  private readonly boots: PrintSet;
  private readonly bare: PrintSet;
  private readonly matrix = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    this.boots = new PrintSet(scene, 0);
    this.bare = new PrintSet(scene, 1);
  }

  /**
   * A print at (x, z) on the floor, facing `yaw` (the direction of travel,
   * as the player's yaw: 0 faces -Z). `right` mirrors it for a right foot;
   * `strength` 0..1 is how much was on the sole.
   */
  place(x: number, z: number, yaw: number, kind: PrintKind, right: boolean, bare: boolean, strength: number, time: number): void {
    const [w, l] = bare ? SIZE.bare : SIZE.boot;
    // The plane's toes (+V) point along -Z before rotating, so a yaw of 0 points them the way you face.
    this.q.setFromAxisAngle(Footprints.UP, yaw + (Math.random() - 0.5) * 0.12);
    this.s.set(right ? -w : w, 1, l);
    // Just above the floor and the snow lying on it.
    this.p.set(x, 0.022, z);
    this.matrix.compose(this.p, this.q, this.s);
    const look = LOOK[kind];
    this.color.setHex(look.color);
    const cover = look.cover * Math.max(0, Math.min(1, strength));
    (bare ? this.bare : this.boots).place(this.matrix, this.color, time, LIFE[kind] * (0.8 + Math.random() * 0.4), cover);
  }

  update(time: number): void {
    this.boots.update(time);
    this.bare.update(time);
  }
}
