import * as THREE from 'three'
import { clamp } from '../utils/math'
import type { GameInput } from '../input'
import type { TrackBundle } from '../render/track'

const MAX_SPEED = 85 // m/s ≈ 306 km/h
const ACCEL = 50 // m/s² at full throttle (arcade-snappy)
const BRAKE = 70 // m/s²
const DRAG_K = 0.55 // 1/s linear drag → terminal at full throttle ≈ MAX_SPEED
const TURN_RATE = 2.6 // rad/s at low speed (higher = tighter turn radius)
const SMART_LERP = 0.06
// Geometry-coupled boundaries (track.ts: ROAD_HALF_WIDTH=7, KERB_WIDTH=2):
// SOFT_OFFSET sits at the road/kerb seam → gentle pull-back when on kerb.
// HARD_OFFSET sits at the OUTER edge of the red/white kerb → invisible wall.
const SOFT_OFFSET = 7
const HARD_OFFSET = 9

export interface PhysicsState {
  pos: THREE.Vector3
  heading: number // radians; 0 means facing +Z (matches getTangentAt at t=0 if track tangent there is +Z)
  speed: number
  topSpeed: number
  lapProgress: number // 0..1 along curve
  lapsCompleted: number
  crashed: boolean
  crashCooldown: number // seconds remaining
  totalCrashes: number
}

export interface PhysicsBundle {
  state: PhysicsState
  reset: (track: TrackBundle) => void
  update: (dt: number, input: GameInput, track: TrackBundle) => void
  triggerCrash: () => void
}

/** Place the player on their F1 grid slot (rear-most, off-side column).
 *  Mirrors src/game/opponents.ts gridLatForSlot(PLAYER_GRID_SLOT=4) so the
 *  diagonal F1-style grid stays consistent across the field. */
function gridStartPos(tr: TrackBundle, out: THREE.Vector3): void {
  out.copy(tr.getPositionAt(0))
  const tg = tr.getTangentAt(0)
  // Lateral basis (perpendicular to tangent, planar).
  const lx = -tg.z
  const lz = tg.x
  const len = Math.hypot(lx, lz) || 1
  // Even slot → off side → -POLE_LAT_M (= -3). Player is slot 4.
  const PLAYER_LAT = -3
  out.x += (lx / len) * PLAYER_LAT
  out.z += (lz / len) * PLAYER_LAT
}

export function createPhysics(track: TrackBundle): PhysicsBundle {
  const state: PhysicsState = {
    pos: new THREE.Vector3(),
    heading: Math.atan2(track.getTangentAt(0).x, track.getTangentAt(0).z),
    speed: 0,
    topSpeed: 0,
    lapProgress: 0,
    lapsCompleted: 0,
    crashed: false,
    crashCooldown: 0,
    totalCrashes: 0,
  }
  gridStartPos(track, state.pos)

  let lastT = 0

  const reset = (tr: TrackBundle): void => {
    gridStartPos(tr, state.pos)
    const tg = tr.getTangentAt(0)
    state.heading = Math.atan2(tg.x, tg.z)
    state.speed = 0
    state.topSpeed = 0
    state.lapProgress = 0
    state.lapsCompleted = 0
    state.crashed = false
    state.crashCooldown = 0
    state.totalCrashes = 0
    lastT = 0
  }

  const triggerCrash = (): void => {
    if (state.crashed) return
    state.crashed = true
    state.crashCooldown = 1.5
    state.totalCrashes++
    state.speed *= 0.2
  }

  const update = (dt: number, input: GameInput, tr: TrackBundle): void => {
    if (state.crashed) {
      state.crashCooldown -= dt
      // Soft pull back to track centerline
      const proj = tr.projectToTrack(state.pos)
      state.pos.lerp(proj.closest, 0.15)
      const tg = tr.getTangentAt(proj.t)
      const targetHead = Math.atan2(tg.x, tg.z)
      state.heading += (targetHead - state.heading) * 0.15
      state.speed *= 0.92
      if (state.crashCooldown <= 0) {
        state.crashed = false
      }
      return
    }

    // Throttle / brake — frame-rate-independent linear drag.
    state.speed += input.throttle * ACCEL * dt
    state.speed -= input.brake * BRAKE * dt
    state.speed -= DRAG_K * state.speed * dt
    state.speed = clamp(state.speed, 0, MAX_SPEED)
    if (state.speed > state.topSpeed) state.topSpeed = state.speed

    // Steering — turn rate falls with speed.
    // Sign: input.steer is +1 for "right arrow"; in our world (+Z forward,
    // camera behind at -Z, +X to the screen-right), turning right means
    // heading should DECREASE so car forward rotates from +Z toward +X
    // visually (matches the player's mental model of "right = right").
    const turnFactor = 1 - (state.speed / MAX_SPEED) * 0.5
    state.heading -= input.steer * TURN_RATE * turnFactor * dt

    // Translate
    state.pos.x += Math.sin(state.heading) * state.speed * dt
    state.pos.z += Math.cos(state.heading) * state.speed * dt

    // Smart Steering: pull toward track centerline
    const proj = tr.projectToTrack(state.pos)
    const offset = proj.offset
    if (offset > SOFT_OFFSET) {
      state.pos.lerp(proj.closest, SMART_LERP)
    }
    if (offset > HARD_OFFSET) {
      triggerCrash()
      return
    }

    // Lap progress: track wrap detection
    const newT = proj.t
    const delta = newT - lastT
    if (delta < -0.5) {
      // wrapped from ~1 -> ~0
      state.lapsCompleted++
    }
    lastT = newT
    state.lapProgress = newT
  }

  return { state, reset, update, triggerCrash }
}

export const PHYS_MAX_SPEED = MAX_SPEED
