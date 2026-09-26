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

/** Sparks, blood, bullet-hole decals and ambient dust. */
export class Effects {
  private readonly sparks = new ParticlePool(160, THREE.AdditiveBlending);
  private readonly blood = new ParticlePool(220, THREE.NormalBlending);
  private readonly decals: THREE.Mesh[] = [];
  private decalCursor = 0;
  private readonly dust: THREE.Points;
  private readonly dustBase: Float32Array;

  constructor(
    private readonly scene: THREE.Scene,
    dustMotes = 260
  ) {
    scene.add(this.sparks.points, this.blood.points);

    const decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
    const decalMat = new THREE.MeshStandardMaterial({
      map: textures().bulletHole,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 1,
    });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(decalGeo, decalMat);
      m.visible = false;
      scene.add(m);
      this.decals.push(m);
    }

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

  impact(point: THREE.Vector3, normal: THREE.Vector3): void {
    const c = new THREE.Color(1, 0.75, 0.4);
    for (let i = 0; i < 10; i++) {
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3);
      v.x += (Math.random() - 0.5) * 4;
      v.y += (Math.random() - 0.2) * 4;
      v.z += (Math.random() - 0.5) * 4;
      this.sparks.emit(point, v, 0.25 + Math.random() * 0.25, 0.05 + Math.random() * 0.04, c, 9);
    }
    const dustC = new THREE.Color(0.35, 0.33, 0.3);
    for (let i = 0; i < 6; i++) {
      const v = normal.clone().multiplyScalar(0.6 + Math.random());
      v.y += Math.random() * 0.5;
      this.blood.emit(point, v, 0.6 + Math.random() * 0.5, 0.12 + Math.random() * 0.1, dustC, -0.3);
    }
    const decal = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    decal.visible = true;
    decal.position.copy(point).addScaledVector(normal, 0.01);
    decal.lookAt(point.clone().add(normal));
    decal.rotateZ(Math.random() * Math.PI);
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
    this.scene.remove(this.sparks.points, this.blood.points, this.dust, ...this.decals);
  }
}
