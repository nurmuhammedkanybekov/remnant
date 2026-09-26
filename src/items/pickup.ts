import * as THREE from "three";
import { textures } from "../fx/textures";
import { ITEMS, type PickupType } from "../content/items";

export type { PickupType };

export class Pickup {
  readonly group = new THREE.Group();
  private readonly item: THREE.Object3D;
  private readonly glow: THREE.Sprite;
  collected = false;
  private phase = Math.random() * 10;

  constructor(
    private readonly scene: THREE.Scene,
    readonly type: PickupType,
    pos: THREE.Vector2,
    readonly noteText?: string
  ) {
    this.item = buildItem(type);
    this.group.add(this.item);
    // Soft halo so items can be spotted in the dark without a flashlight.
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures().glow,
        color: ITEMS[type].glow,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.glow.scale.setScalar(0.9);
    this.group.add(this.glow);
    // Small offset from cell centre so pickups don't all sit dead-centre.
    this.group.position.set(pos.x + 0.6, 0, pos.y - 0.4);
    scene.add(this.group);
  }

  update(dt: number): void {
    this.phase += dt;
    this.item.rotation.y += dt * 1.2;
    this.item.position.y = 0.55 + Math.sin(this.phase * 2.2) * 0.06;
    this.glow.position.y = this.item.position.y;
    this.glow.material.opacity = 0.25 + Math.sin(this.phase * 3) * 0.1;
  }

  collect(): void {
    this.collected = true;
    this.scene.remove(this.group);
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(this.group.position.x - x, this.group.position.z - z);
  }
}

function buildItem(type: PickupType): THREE.Object3D {
  const tex = textures();
  const g = new THREE.Group();
  switch (type) {
    case "ammo": {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.18, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x4d5a36, roughness: 0.7, metalness: 0.3 })
      );
      g.add(box);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.345, 0.05, 0.225),
        new THREE.MeshStandardMaterial({ color: 0xd8b23a, emissive: 0x6a5010, roughness: 0.5 })
      );
      g.add(band);
      for (let i = 0; i < 4; i++) {
        const round = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.015, 0.07, 8),
          new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.9, roughness: 0.3 })
        );
        round.position.set(-0.08 + i * 0.05, 0.13, 0);
        g.add(round);
      }
      break;
    }
    case "medkit": {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.24, 0.16),
        new THREE.MeshStandardMaterial({ map: tex.medkit, roughness: 0.6, emissive: 0x221010 })
      );
      g.add(box);
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x333333 })
      );
      handle.position.y = 0.12;
      g.add(handle);
      break;
    }
    case "battery": {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.26, 14),
        new THREE.MeshStandardMaterial({ color: 0x1d2b3a, metalness: 0.5, roughness: 0.4 })
      );
      g.add(body);
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.07, 14),
        new THREE.MeshStandardMaterial({ color: 0x7fd8ff, emissive: 0x2a7090, roughness: 0.4 })
      );
      g.add(stripe);
      const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.03, 10),
        new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 1, roughness: 0.3 })
      );
      tip.position.y = 0.145;
      g.add(tip);
      g.rotation.z = 0.3;
      break;
    }
    case "keycard": {
      const card = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.16, 0.01),
        new THREE.MeshStandardMaterial({ color: 0x2a6a44, emissive: 0x1a6a3a, roughness: 0.4 })
      );
      g.add(card);
      const chip = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.04, 0.012),
        new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: 1, roughness: 0.3 })
      );
      chip.position.set(-0.07, 0.02, 0);
      g.add(chip);
      break;
    }
    case "note": {
      const paper = new THREE.Mesh(
        new THREE.PlaneGeometry(0.24, 0.32),
        new THREE.MeshStandardMaterial({ map: tex.paper, side: THREE.DoubleSide, emissive: 0x302a1a, roughness: 1 })
      );
      paper.rotation.x = -0.4;
      g.add(paper);
      break;
    }
  }
  return g;
}
