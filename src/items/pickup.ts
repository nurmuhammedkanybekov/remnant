import * as THREE from "three";

export type PickupType = "ammo" | "medkit" | "note";

export class Pickup {
  readonly mesh: THREE.Mesh | THREE.Group;
  collected = false;

  constructor(
    scene: THREE.Scene,
    readonly type: PickupType,
    pos: THREE.Vector2,
    readonly noteText?: string
  ) {
    this.mesh = buildPickupMesh(type);
    this.mesh.position.set(pos.x, 0.6, pos.y);
    scene.add(this.mesh);
  }

  update(dt: number): void {
    this.mesh.rotation.y += dt * 1.4;
    this.mesh.position.y = 0.6 + Math.sin(performance.now() * 0.003) * 0.08;
  }

  collect(scene: THREE.Scene): void {
    this.collected = true;
    scene.remove(this.mesh);
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(this.mesh.position.x - x, this.mesh.position.z - z);
  }
}

function buildPickupMesh(type: PickupType): THREE.Mesh {
  let geo: THREE.BufferGeometry;
  let color: number;
  switch (type) {
    case "ammo":
      geo = new THREE.BoxGeometry(0.22, 0.14, 0.32);
      color = 0xd8b23a;
      break;
    case "medkit":
      geo = new THREE.BoxGeometry(0.3, 0.22, 0.3);
      color = 0xd23c3c;
      break;
    case "note":
      geo = new THREE.PlaneGeometry(0.24, 0.32);
      color = 0xe4d9b0;
      break;
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    roughness: 0.6,
  });
  return new THREE.Mesh(geo, mat);
}
