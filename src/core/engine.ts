import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

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
    uGrain: { value: 0.045 },
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
      float ca = 0.0015 + uDamage * 0.012 + uLowHealth * 0.003;
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

      // Vignette
      float vig = smoothstep(0.85, 0.25, d);
      col *= mix(0.35, 1.0, vig);

      // Grain (animated)
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime * 13.7) * 100.0) - 0.5;
      col += g * uGrain;

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
    container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const vm = new RenderPass(this.viewScene, this.camera);
    vm.clear = false;
    vm.clearDepth = true;
    this.composer.addPass(vm);
    this.composer.addPass(new OutputPass());
    this.post = new ShaderPass(PostShader);
    this.composer.addPass(this.post);

    window.addEventListener("resize", () => this.onResize());
  }

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
    this.composer.render();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
