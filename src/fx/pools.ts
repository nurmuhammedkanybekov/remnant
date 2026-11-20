import * as THREE from "three";
import { textures } from "./textures";

/** Pools kept at once; the oldest is reused. */
const MAX_POOLS = 40;
/** Seconds for a pool to spread most of the way. */
const SPREAD_TIME = 9;

/**
 * Blood spreading out from under a body, slowly, the way it does: a small
 * dark patch that keeps growing for a few seconds after the thing has
 * stopped moving. Wet and glossy, so your torch catches it. Walk through it
 * and your boots leave prints (see LevelSession.leavePrint).
 */
export class BloodPools {
  private readonly mesh: THREE.InstancedMesh;
  /** x: birth time. */
  private readonly birth: THREE.InstancedBufferAttribute;
  private readonly uTime = { value: 0 };
  private cursor = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.birth = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS).fill(-1e6), 1);
    geo.setAttribute("aBirth", this.birth);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a0403,
      alphaMap: textures().bloodPool,
      alphaHash: true,
      // Wet: the torch shows in it.
      roughness: 0.3,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const uTime = this.uTime;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aBirth;\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          {
            // Spreading: fast at first, slowing as it thins out.
            float age = max(0.0, uTime - aBirth);
            transformed.xz *= 0.12 + 0.88 * (1.0 - exp(-age * ${(3 / SPREAD_TIME).toFixed(4)}));
          }`
        );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_POOLS);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadowCast = true;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_POOLS; i++) this.mesh.setMatrixAt(i, hidden);
    scene.add(this.mesh);
  }

  /** A pool starting now at (x, z), `size` metres across when it's done. */
  spill(x: number, z: number, size: number, time: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_POOLS;
    this.q.setFromAxisAngle(BloodPools.UP, Math.random() * Math.PI * 2);
    // A hair above the footprints' floor height, so prints on top of a pool still show on it.
    this.matrix.compose(new THREE.Vector3(x, 0.018, z), this.q, new THREE.Vector3(size, 1, size));
    this.mesh.setMatrixAt(i, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.birth.setX(i, time);
    this.birth.needsUpdate = true;
  }

  update(time: number): void {
    this.uTime.value = time;
  }
}
