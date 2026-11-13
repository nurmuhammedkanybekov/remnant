import * as THREE from "three";
import { CELL_SIZE, WALL_HEIGHT } from "../world/grid";

const FLAKES = 1400;
/** The flakes live in a box this size around the camera, and wrap round inside it. */
const BOX = { x: 34, y: WALL_HEIGHT + 3, z: 34 };
const FALL = 0.9; // metres per second
const HIDDEN_Y = -50;

/**
 * Snow falling over the open-air cells of a level (and only there: under a
 * roof it stops at the eaves). A fixed field of flakes travels with the
 * camera, drifting on a slow wind; a flake over a roofed cell is parked out
 * of sight until it drifts back out under the sky.
 */
export class Snowfall {
  private readonly points: THREE.Points;
  private readonly base = new Float32Array(FLAKES * 3);
  private readonly pos: Float32Array;
  private readonly phase = new Float32Array(FLAKES);
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly sky: ReadonlySet<number>,
    private readonly cols: number,
    private readonly rows: number,
    tex: THREE.Texture
  ) {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < FLAKES; i++) {
      this.base[i * 3] = rand() * BOX.x;
      this.base[i * 3 + 1] = rand() * BOX.y;
      this.base[i * 3 + 2] = rand() * BOX.z;
      this.phase[i] = rand() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(FLAKES * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    // The field moves with the camera, so its bounds do too: never cull it.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.PointsMaterial({
      map: tex,
      color: 0xdfe6ee,
      size: 0.07,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    const t = this.time;
    // The box is anchored to a grid, not to the camera, so flakes don't slide when you turn or walk.
    const ox = camera.x - BOX.x / 2;
    const oz = camera.z - BOX.z / 2;
    const wrap = (v: number, size: number) => ((v % size) + size) % size;
    for (let i = 0; i < FLAKES; i++) {
      const b = i * 3;
      const ph = this.phase[i];
      const x = ox + wrap(this.base[b] + t * 0.35 + Math.sin(t * 0.7 + ph) * 0.3 - ox, BOX.x);
      const z = oz + wrap(this.base[b + 2] + t * 0.12 + Math.cos(t * 0.5 + ph) * 0.3 - oz, BOX.z);
      const y = wrap(this.base[b + 1] - t * FALL * (0.8 + (ph % 1) * 0.4), BOX.y);
      const col = Math.floor(x / CELL_SIZE);
      const row = Math.floor(z / CELL_SIZE);
      const open = col >= 0 && row >= 0 && col < this.cols && row < this.rows && this.sky.has(row * this.cols + col);
      this.pos[b] = x;
      this.pos[b + 1] = open ? y : HIDDEN_Y;
      this.pos[b + 2] = z;
    }
    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }
}
