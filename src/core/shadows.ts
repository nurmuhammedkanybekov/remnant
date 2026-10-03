import * as THREE from "three";

/**
 * Lets everything solid under `root` cast and catch shadows. Glass, water,
 * decals, glows and sprites are left out: they'd only make dark smudges.
 */
export function castShadows(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const see = mats.every((mat) => !mat.transparent && !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial);
    m.castShadow = see;
    m.receiveShadow = see;
    // Shadows from the faces turned towards the light only: a light inside
    // something (you walked into a cabinet; props don't block you) isn't
    // snuffed out by the inside of it.
    if (see) for (const mat of mats) mat.shadowSide = THREE.FrontSide;
  });
}

/** The flashlight (or any spotlight) casts shadows of `size` (0: none). */
export function spotShadows(light: THREE.SpotLight, size: number): void {
  light.castShadow = size > 0;
  if (!size) return;
  light.shadow.mapSize.set(size, size);
  light.shadow.camera.near = 0.15;
  light.shadow.camera.far = 24;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.025;
  light.shadow.radius = 3;
}
