import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import type { QualityPreset } from "./quality";

/**
 * Final full-screen pass, applied after tone mapping (so it works in
 * display space): film grain, vignette, chromatic aberration on damage,
 * and desaturation as health drops.
 */
const PostShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uDamage: { value: 0 }, // 0..1, spikes on hit and decays
    uLowHealth: { value: 0 }, // 0..1, persistent
    uGrain: { value: 0.06 },
    uFilm: { value: 1 }, // 0 turns off grain and the resting chromatic aberration (quality)
    uBars: { value: 0 }, // 0..1: cinema bars top and bottom (the menu)
    uGamma: { value: 1 }, // the player's brightness: a gamma lift (raises the shadows, keeps black black)
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDamage;
    uniform float uLowHealth;
    uniform float uGrain;
    uniform float uFilm;
    uniform float uBars;
    uniform float uGamma;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float d = length(c);

      // Chromatic aberration grows toward the edges and with damage.
      float ca = 0.0015 * uFilm + uDamage * 0.012 + uLowHealth * 0.003;
      vec2 off = c * ca;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // Desaturate + red tint as health drops.
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum), uLowHealth * 0.6);
      col += vec3(0.25, 0.0, 0.0) * uDamage * smoothstep(0.2, 0.75, d);
      col += vec3(0.12, 0.0, 0.0) * uLowHealth * smoothstep(0.3, 0.8, d) * (0.6 + 0.4 * sin(uTime * 5.0));

      // The grade: colour drained, blacks crushed, shadows pushed cold and
      // green, highlights a dirty warm. Old film stock, not a cartoon.
      float l2 = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l2), col, 0.72);
      col = max(col - 0.015, 0.0) * 1.03;
      vec3 sc = clamp(col, 0.0, 1.0);
      col = mix(col, sc * sc * (3.0 - 2.0 * sc), 0.35);
      float shadowAmt = 1.0 - smoothstep(0.0, 0.32, l2);
      col += vec3(-0.006, 0.006, 0.01) * shadowAmt;
      col *= mix(vec3(1.0), vec3(1.04, 1.0, 0.92), smoothstep(0.3, 0.9, l2));

      // Vignette
      float vig = smoothstep(0.85, 0.25, d);
      col *= mix(0.3, 1.0, vig);

      // Grain (animated)
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime * 13.7) * 100.0) - 0.5;
      col += g * uGrain * uFilm;

      // The player's brightness.
      col = pow(max(col, 0.0), vec3(1.0 / uGamma));

      // Cinema bars.
      float bar = 0.105 * uBars;
      if (uv.y < bar || uv.y > 1.0 - bar) col = vec3(0.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Engine {
  readonly scene: THREE.Scene;
  /** Separate scene for the first-person weapon so it never clips into walls. */
  readonly viewScene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly post: ShaderPass;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.viewScene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 120);
    this.camera.position.set(0, 1.7, 0);
    // The camera must be in the scene graph, or lights parented to it
    // (flashlight, muzzle flash) won't be picked up by the renderer.
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Ambient occlusion goes in here (index 1) when the quality asks for it.
    const vm = new RenderPass(this.viewScene, this.camera);
    vm.clear = false;
    vm.clearDepth = true;
    this.composer.addPass(vm);
    this.composer.addPass(new OutputPass());
    this.post = new ShaderPass(PostShader);
    this.composer.addPass(this.post);

    window.addEventListener("resize", () => this.onResize());
  }

  /** Removes everything from the world scene except the camera, whose children (lights) are dropped too. */
  resetWorld(): void {
    for (const child of [...this.scene.children]) {
      if (child === this.camera) continue;
      this.scene.remove(child);
      child.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.camera.clear();
    this.scene.fog = null;
  }

  /** Applies a graphics quality preset (resolution and film effects; the rest is read when a level is built). */
  setQuality(q: QualityPreset): void {
    const ratio = Math.min(window.devicePixelRatio, q.pixelRatioCap);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.post.uniforms.uFilm.value = q.filmEffects ? 1 : 0;
    this.shadowSize = q.shadows;
    this.renderer.shadowMap.enabled = q.shadows > 0;
    if (q.ao && !this.ao) {
      this.ao = new GTAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 12 });
      this.ao.blendIntensity = 0.9;
      // Glows, sprites, particles and anything see-through would be drawn
      // into the occlusion's depth and normals as solid quads, leaving dark
      // squares round every eye and lamp halo: hide them for that pass.
      const ao = this.ao;
      const render = ao.render.bind(ao);
      ao.render = (...args: Parameters<GTAOPass["render"]>) => {
        const hidden: THREE.Object3D[] = [];
        this.scene.traverseVisible((o) => {
          const m = o as THREE.Mesh;
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          const seeThrough = mat && (Array.isArray(mat) ? mat.some((x) => x.transparent) : mat.transparent);
          if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || seeThrough) hidden.push(o);
        });
        for (const o of hidden) o.visible = false;
        render(...args);
        for (const o of hidden) o.visible = true;
      };
      this.composer.insertPass(this.ao, 1);
    } else if (!q.ao && this.ao) {
      this.composer.removePass(this.ao);
      this.ao.dispose();
      this.ao = null;
    }
  }

  /** Flashlight shadow map size for the current quality (0: none). */
  shadowSize = 0;
  private ao: GTAOPass | null = null;

  /** The player's brightness setting: a gamma lift in the final pass. */
  setBrightness(b: number): void {
    this.post.uniforms.uGamma.value = b;
  }

  /** Cinema bars top and bottom (the menu), eased in and out. */
  setBars(on: boolean): void {
    this.barsTarget = on ? 1 : 0;
  }
  private barsTarget = 0;

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setPostFx(damage: number, lowHealth: number, time: number): void {
    this.post.uniforms.uDamage.value = damage;
    this.post.uniforms.uLowHealth.value = lowHealth;
    this.post.uniforms.uTime.value = time;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    const u = this.post.uniforms.uBars;
    u.value += (this.barsTarget - u.value) * 0.08;
    this.composer.render();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
