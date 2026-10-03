import * as THREE from "three";
import { textures } from "./textures";

const vert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * (300.0 / -mv.z);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;
const frag = /* glsl */ `
  uniform sampler2D map;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

interface Particle {
  life: number;
  maxLife: number;
  vel: THREE.Vector3;
  gravity: number;
  size: number;
}

/** A fixed-size pool of point sprites with velocity, gravity and fade. */
class ParticlePool {
  readonly points: THREE.Points;
  private readonly particles: Particle[] = [];
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly color: Float32Array;
  private cursor = 0;

  constructor(
    private readonly count: number,
    blending: THREE.Blending
  ) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3).fill(-999);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.color = new Float32Array(count * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: textures().glow } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.particles.push({ life: 0, maxLife: 1, vel: new THREE.Vector3(), gravity: 0, size: 0 });
    }
  }

  emit(p: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, color: THREE.Color, gravity: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const part = this.particles[i];
    part.life = part.maxLife = life;
    part.vel.copy(vel);
    part.gravity = gravity;
    part.size = size;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.color.set([color.r, color.g, color.b], i * 3);
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      const part = this.particles[i];
      if (part.life <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      part.life -= dt;
      part.vel.y -= part.gravity * dt;
      part.vel.multiplyScalar(1 - 1.5 * dt);
      this.pos[i * 3] += part.vel.x * dt;
      this.pos[i * 3 + 1] = Math.max(0.02, this.pos[i * 3 + 1] + part.vel.y * dt);
      this.pos[i * 3 + 2] += part.vel.z * dt;
      const t = Math.max(0, part.life / part.maxLife);
      this.alpha[i] = t;
      this.size[i] = part.size * (0.5 + 0.5 * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}

/** What the effects need to know about the level: where the walls and the water are. */
export interface EffectsWorld {
  solidAt(x: number, z: number): boolean;
  waterAt(x: number, z: number): boolean;
}

/** Bullet holes stay for the whole level (the oldest go first past this many). */
const HOLES = 160;
const SPLATS = 60;
/** Chips of concrete knocked off by bullets: they fly, bounce and lie where they land. */
const CHIPS = 160;
const CHIP_LIFE = 45;

interface Chip {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  size: number;
  age: number;
  resting: boolean;
  alive: boolean;
}

/** A pool of flat decals (holes, blood) laid on surfaces, recycled oldest first. */
class DecalPool {
  private readonly meshes: THREE.Mesh[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, count: number, map: THREE.Texture, offset: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: offset,
      roughness: 0.9,
    });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.matrixAutoUpdate = false;
      scene.add(m);
      this.meshes.push(m);
    }
  }

  place(point: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    const m = this.meshes[this.cursor];
    this.cursor = (this.cursor + 1) % this.meshes.length;
    m.visible = true;
    m.position.copy(point).addScaledVector(normal, 0.008);
    m.lookAt(point.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size);
    m.updateMatrix();
  }

  get all(): THREE.Mesh[] {
    return this.meshes;
  }
}

/** Sparks, blood, bullet holes, chips of concrete, splashes and ambient dust. */
export class Effects {
  private readonly sparks = new ParticlePool(220, THREE.AdditiveBlending);
  private readonly blood = new ParticlePool(420, THREE.NormalBlending);
  private readonly holes: DecalPool;
  private readonly splats: DecalPool;
  private readonly chips: Chip[] = [];
  private readonly chipMesh: THREE.InstancedMesh;
  private chipCursor = 0;
  private world: EffectsWorld | null = null;
  private readonly dust: THREE.Points;
  private readonly dustBase: Float32Array;

  constructor(
    private readonly scene: THREE.Scene,
    dustMotes = 260
  ) {
    scene.add(this.sparks.points, this.blood.points);

    this.holes = new DecalPool(scene, HOLES, textures().bulletHole, -4);
    this.splats = new DecalPool(scene, SPLATS, textures().bloodSplat, -3);
    this.chipMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
      CHIPS
    );
    this.chipMesh.frustumCulled = false;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const shade = new THREE.Color();
    for (let i = 0; i < CHIPS; i++) {
      this.chipMesh.setMatrixAt(i, hidden);
      const g = 0.13 + Math.random() * 0.1;
      this.chipMesh.setColorAt(i, shade.setRGB(g, g * 0.97, g * 0.92));
      this.chips.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        size: 0,
        age: 0,
        resting: true,
        alive: false,
      });
    }
    scene.add(this.chipMesh);

    // Dust motes: a box of points that follows the player; only the ones
    // inside the flashlight cone are visible (computed in the shader).
    const N = dustMotes;
    this.dustBase = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.dustBase[i * 3] = (Math.random() - 0.5) * 10;
      this.dustBase[i * 3 + 1] = Math.random() * 3;
      this.dustBase[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const dustMat = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        varying float vLit;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = 0.9 * (300.0 / -mv.z) * 0.05;
          vec3 d = normalize(mv.xyz);
          vLit = smoothstep(0.88, 0.97, -d.z) * smoothstep(9.0, 1.0, -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        varying float vLit;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r) * vLit * uLight * 0.35;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.9, 0.92, 1.0), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, dustMat);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
  }

  /** Lets the effects know the level: chips bounce off its walls, shots into flooded floor splash. */
  setWorld(world: EffectsWorld): void {
    this.world = world;
  }

  /**
   * A bullet hitting the level: a hole that stays, a spit of sparks, chips of
   * concrete that fly off and lie where they land, and dust hanging in the
   * air. Into water it's a splash instead; into the ceiling, grit falls.
   * `small` for shotgun pellets.
   */
  impact(point: THREE.Vector3, normal: THREE.Vector3, small = false): void {
    if (normal.y > 0.5 && this.world?.waterAt(point.x, point.z)) {
      this.splash(point, small ? 0.6 : 1);
      return;
    }
    const k = small ? 0.55 : 1;
    const c = new THREE.Color(1, 0.75, 0.4);
    for (let i = 0; i < 8 * k; i++) {
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3);
      v.x += (Math.random() - 0.5) * 4;
      v.y += (Math.random() - 0.2) * 4;
      v.z += (Math.random() - 0.5) * 4;
      this.sparks.emit(point, v, 0.15 + Math.random() * 0.25, 0.04 + Math.random() * 0.04, c, 9);
    }
    // Dust: a puff that hangs and drifts. Off the ceiling it falls instead.
    const ceiling = normal.y < -0.5;
    const dustC = new THREE.Color(0.38, 0.36, 0.33);
    for (let i = 0; i < 12 * k; i++) {
      const v = normal.clone().multiplyScalar(0.3 + Math.random() * 0.9);
      v.x += (Math.random() - 0.5) * 0.4;
      v.z += (Math.random() - 0.5) * 0.4;
      v.y += ceiling ? 0 : Math.random() * 0.3;
      this.blood.emit(point, v, 1.2 + Math.random() * 1.6, 0.16 + Math.random() * 0.3, dustC, ceiling ? 1.5 : -0.08);
    }
    // Chips of concrete.
    const n = Math.round((small ? 1 : 3) + Math.random() * (small ? 1 : 3));
    for (let i = 0; i < n; i++) {
      const v = normal.clone().multiplyScalar(1 + Math.random() * 2.5);
      v.x += (Math.random() - 0.5) * 2;
      v.y += Math.random() * 1.5;
      v.z += (Math.random() - 0.5) * 2;
      this.chip(point.clone().addScaledVector(normal, 0.03), v, 0.015 + Math.random() * (small ? 0.02 : 0.035));
    }
    this.holes.place(point, normal, (small ? 0.09 : 0.16) + Math.random() * 0.05);
  }

  /** A shot into flooded floor: a spout of water and droplets falling back. */
  splash(point: THREE.Vector3, k = 1): void {
    const c = new THREE.Color(0.55, 0.62, 0.62);
    for (let i = 0; i < 18 * k; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 1.6);
      this.blood.emit(point, v, 0.4 + Math.random() * 0.4, 0.03 + Math.random() * 0.05, c, 9.8);
    }
    for (let i = 0; i < 6 * k; i++) {
      const a = Math.random() * Math.PI * 2;
      this.blood.emit(point, new THREE.Vector3(Math.cos(a) * 0.6, 0.05, Math.sin(a) * 0.6), 0.6, 0.18, new THREE.Color(0.3, 0.36, 0.36), 0);
    }
  }

  /** Blood thrown onto a surface behind whatever was hit. */
  bloodSplat(point: THREE.Vector3, normal: THREE.Vector3, size = 0.6): void {
    this.splats.place(point, normal, size * (0.8 + Math.random() * 0.5));
  }

  private chip(p: THREE.Vector3, v: THREE.Vector3, size: number): void {
    const c = this.chips[this.chipCursor];
    this.chipCursor = (this.chipCursor + 1) % CHIPS;
    c.pos.copy(p);
    c.vel.copy(v);
    c.rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    c.spin.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
    c.size = size;
    c.age = 0;
    c.resting = false;
    c.alive = true;
  }

  private readonly chipMatrix = new THREE.Matrix4();
  private readonly chipQuat = new THREE.Quaternion();
  private readonly chipScale = new THREE.Vector3();

  /** Gravity, bounces off the floor and walls, friction; chips that settle stay put until they're old. */
  private updateChips(dt: number): void {
    let dirty = false;
    for (let i = 0; i < CHIPS; i++) {
      const c = this.chips[i];
      if (!c.alive) continue;
      c.age += dt;
      if (c.age > CHIP_LIFE) {
        c.alive = false;
        this.chipMesh.setMatrixAt(i, this.chipMatrix.makeScale(0, 0, 0));
        dirty = true;
        continue;
      }
      if (c.resting) continue;
      c.vel.y -= 9.8 * dt;
      const ox = c.pos.x;
      const oz = c.pos.z;
      c.pos.addScaledVector(c.vel, dt);
      if (this.world?.solidAt(c.pos.x, c.pos.z)) {
        // Off a wall: back out and bounce, losing most of the speed.
        if (this.world.solidAt(c.pos.x, oz)) {
          c.pos.x = ox;
          c.vel.x *= -0.35;
        }
        if (this.world.solidAt(ox, c.pos.z)) {
          c.pos.z = oz;
          c.vel.z *= -0.35;
        }
      }
      const floor = c.size / 2;
      if (c.pos.y < floor) {
        c.pos.y = floor;
        if (Math.abs(c.vel.y) < 0.7) {
          c.resting = true;
          c.rot.x = Math.round(c.rot.x / (Math.PI / 2)) * (Math.PI / 2);
          c.rot.z = Math.round(c.rot.z / (Math.PI / 2)) * (Math.PI / 2);
        } else {
          c.vel.y *= -0.32;
          c.vel.x *= 0.55;
          c.vel.z *= 0.55;
          c.spin.multiplyScalar(0.5);
        }
      }
      if (!c.resting) {
        c.rot.x += c.spin.x * dt;
        c.rot.y += c.spin.y * dt;
        c.rot.z += c.spin.z * dt;
      }
      this.chipQuat.setFromEuler(c.rot);
      this.chipMatrix.compose(c.pos, this.chipQuat, this.chipScale.set(c.size, c.size * 0.7, c.size * 1.2));
      this.chipMesh.setMatrixAt(i, this.chipMatrix);
      dirty = true;
    }
    if (dirty) this.chipMesh.instanceMatrix.needsUpdate = true;
  }

  bloodBurst(point: THREE.Vector3, dir: THREE.Vector3, amount = 16): void {
    for (let i = 0; i < amount; i++) {
      const v = dir.clone().multiplyScalar(1 + Math.random() * 3);
      v.x += (Math.random() - 0.5) * 3;
      v.y += Math.random() * 2.5;
      v.z += (Math.random() - 0.5) * 3;
      const shade = 0.25 + Math.random() * 0.25;
      this.blood.emit(point, v, 0.5 + Math.random() * 0.6, 0.07 + Math.random() * 0.08, new THREE.Color(shade, 0.02, 0.02), 9);
    }
  }

  /** A bottle smashing: glints of glass. */
  glassBurst(point: THREE.Vector3): void {
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 4, 0.5 + Math.random() * 2.5, (Math.random() - 0.5) * 4);
      const g = 0.5 + Math.random() * 0.5;
      this.sparks.emit(
        point,
        v,
        0.25 + Math.random() * 0.35,
        0.03 + Math.random() * 0.03,
        new THREE.Color(0.55 * g, 0.85 * g, 0.6 * g),
        10
      );
    }
  }

  /** A glob of acid bursting. */
  acidSplash(point: THREE.Vector3): void {
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, 0.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
      const g = 0.6 + Math.random() * 0.4;
      this.sparks.emit(point, v, 0.3 + Math.random() * 0.4, 0.06 + Math.random() * 0.05, new THREE.Color(0.45 * g, g, 0.15 * g), 8);
    }
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6);
      this.blood.emit(point, v, 0.8 + Math.random() * 0.6, 0.15 + Math.random() * 0.1, new THREE.Color(0.25, 0.35, 0.1), -0.4);
    }
  }

  update(dt: number, camera: THREE.Camera, flashlightLevel: number, time: number): void {
    this.sparks.update(dt);
    this.blood.update(dt);
    this.updateChips(dt);
    const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (let i = 0; i < arr.length / 3; i++) {
      // Wrap each mote into a 10x10 box around the camera, with slow drift.
      const bx = this.dustBase[i * 3] + Math.sin(time * 0.2 + i) * 0.4;
      const bz = this.dustBase[i * 3 + 2] + Math.cos(time * 0.17 + i * 1.3) * 0.4;
      arr[i * 3] = cx + ((((bx - cx) % 10) + 15) % 10) - 5;
      arr[i * 3 + 1] = (this.dustBase[i * 3 + 1] + time * 0.03 * ((i % 3) - 1) + 30) % 3;
      arr[i * 3 + 2] = cz + ((((bz - cz) % 10) + 15) % 10) - 5;
    }
    pos.needsUpdate = true;
    (this.dust.material as THREE.ShaderMaterial).uniforms.uLight.value = flashlightLevel;
  }

  dispose(): void {
    this.scene.remove(this.sparks.points, this.blood.points, this.dust, this.chipMesh, ...this.holes.all, ...this.splats.all);
  }
}
