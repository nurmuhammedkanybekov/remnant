import * as THREE from "three";

export class Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly listener: THREE.AudioListener;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.05,
      100
    );
    this.camera.position.set(0, 1.7, 0);

    this.listener = new THREE.AudioListener();
    this.camera.add(this.listener);
    // The camera must be part of the scene graph, or lights/objects
    // parented to it (flashlight, muzzle flash) won't be picked up
    // by the renderer's scene traversal.
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    window.addEventListener("resize", () => this.onResize());
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
