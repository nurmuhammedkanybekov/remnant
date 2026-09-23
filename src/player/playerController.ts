import * as THREE from "three";
import type { Input } from "../core/input";
import { resolveCollision, type LevelData } from "../world/level";
import { Health } from "./health";
import { Flashlight } from "./flashlight";

const WALK_SPEED = 3.1;
const SPRINT_SPEED = 5.6;
const RADIUS = 0.35;
const MOUSE_SENSITIVITY = 0.0022;
const MAX_STAMINA = 100;
const STAMINA_DRAIN_PER_SEC = 22;
const STAMINA_REGEN_PER_SEC = 14;

export class PlayerController {
  readonly health = new Health(100);
  readonly flashlight: Flashlight;
  stamina = MAX_STAMINA;
  isSprinting = false;
  isMoving = false;
  private footstepDistance = 0;
  onFootstep: ((sprinting: boolean) => void) | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly level: LevelData,
    startX: number,
    startZ: number
  ) {
    this.camera.rotation.order = "YXZ";
    this.camera.position.set(startX, 1.7, startZ);
    // Face down the +X corridor rather than the default -Z, which in the
    // level's start room points straight into the nearest wall.
    this.camera.rotation.y = -Math.PI / 2;
    this.flashlight = new Flashlight(camera);
  }

  get position(): THREE.Vector3 {
    return this.camera.position;
  }

  update(dt: number, input: Input): void {
    if (input.locked) {
      this.camera.rotation.y -= input.mouseDeltaX * MOUSE_SENSITIVITY;
      this.camera.rotation.x -= input.mouseDeltaY * MOUSE_SENSITIVITY;
      this.camera.rotation.x = THREE.MathUtils.clamp(
        this.camera.rotation.x,
        -Math.PI / 2 + 0.05,
        Math.PI / 2 - 0.05
      );
    }

    let moveX = 0;
    let moveZ = 0;
    if (input.isDown("KeyW")) moveZ -= 1;
    if (input.isDown("KeyS")) moveZ += 1;
    if (input.isDown("KeyA")) moveX -= 1;
    if (input.isDown("KeyD")) moveX += 1;

    this.isMoving = moveX !== 0 || moveZ !== 0;
    const wantsSprint = input.isDown("ShiftLeft") && this.isMoving && this.stamina > 0;
    this.isSprinting = wantsSprint;

    if (wantsSprint) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_PER_SEC * dt);
    } else {
      this.stamina = Math.min(MAX_STAMINA, this.stamina + STAMINA_REGEN_PER_SEC * dt);
    }

    if (this.isMoving) {
      const len = Math.hypot(moveX, moveZ);
      moveX /= len;
      moveZ /= len;
      const speed = wantsSprint ? SPRINT_SPEED : WALK_SPEED;

      const yaw = this.camera.rotation.y;
      const forwardX = -Math.sin(yaw);
      const forwardZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);

      const dx = (forwardX * -moveZ + rightX * moveX) * speed * dt;
      const dz = (forwardZ * -moveZ + rightZ * moveX) * speed * dt;

      const resolved = resolveCollision(
        this.level,
        this.camera.position.x,
        this.camera.position.z,
        dx,
        dz,
        RADIUS
      );
      this.camera.position.x = resolved.x;
      this.camera.position.z = resolved.z;

      this.footstepDistance += Math.hypot(dx, dz);
      const stepDistance = wantsSprint ? 2.0 : 1.6;
      if (this.footstepDistance > stepDistance) {
        this.footstepDistance = 0;
        this.onFootstep?.(wantsSprint);
      }
    }

    if (input.wasJustPressed("KeyF")) this.flashlight.toggle();
    this.flashlight.update(dt);
  }
}
