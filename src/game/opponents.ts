import * as THREE from 'three'
import type { TrackBundle } from '../render/track'

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface OpponentProfile {
  name: string
  color: string
  baseSpeed: number       // m/s on a long straight
  latGripG: number        // higher = faster through corners
  driftAmplitude: number  // lateral wobble (m), pure aesthetic
  driftFreq: number       // wobble cycles per lap
  /** Positive t offset — AI sits AHEAD of the player on the grid so the
   *  player can see them; a negative value would wrap to t≈0.999 and the
   *  AI would be flagged as having finished the lap immediately. */
  startStagger: number
  startLat: number        // lateral offset on the grid (m)
  /** Poisson rate: average mistakes per second. Aggressor > Rookie > Veteran. */
  mistakeRate: number
  mistakeMinS: number     // mistake duration (slow + wobble) range
  mistakeMaxS: number
}

export interface OpponentState {
  profile: OpponentProfile
  t: number               // 0..1 along curve
  lap: number             // completed laps
  speed: number           // m/s
  pos: THREE.Vector3
  heading: number
  /** >0 while the AI is currently fumbling (off-line + slowed). */
  mistakeRemaining: number
  /** Set true on the first frame mistakeRemaining ticks above 0 — the main
   *  loop reads this to fire sparks/SFX once per mistake then clears it. */
  mistakeJustTriggered: boolean
}

const DIFFICULTY_SCALE: Record<Difficulty, number> = {
  easy: 0.88,
  medium: 1.0,
  hard: 1.12,
}

/** Base speed cap — kept under the player's MAX_SPEED (85 m/s ≈ 306 km/h)
 *  so AIs can never run away from the player on a flat-out straight. */
const BASE_SPEED_CAP = 84

/**
 * Real-F1 starting grid layout (FIA Sporting Regs ≈ 8 m longitudinal,
 * staggered left/right). For an N-car grid:
 *   slot 1 (pole) — pole side, 0 m back
 *   slot 2        — off side,  GRID_SLOT_M back
 *   slot 3        — pole side, 2·GRID_SLOT_M back
 *   slot 4        — off side,  3·GRID_SLOT_M back  (← player sits here)
 *   ...
 * Pole-side / off-side defined by sign of POLE_LAT_M.
 */
export const GRID_SLOT_M = 8
export const POLE_LAT_M = 3
/** Player occupies the rear-most grid slot (4-car field → P4). */
export const PLAYER_GRID_SLOT = 4

/** Lateral offset (signed metres) for the given 1-based grid slot. */
export function gridLatForSlot(slot: number): number {
  // Odd slots = pole side, even slots = off side.
  return slot % 2 === 1 ? POLE_LAT_M : -POLE_LAT_M
}

/** Each AI's grid slot. Higher tier (Veteran) gets the better starting
 *  position — same as a real qualifying-driven grid. */
const AI_GRID_SLOTS: Record<string, number> = {
  Veteran: 1,   // pole
  Aggressor: 2, // P2
  Rookie: 3,    // P3
}

const PROFILES: Array<Omit<OpponentProfile, 'baseSpeed' | 'latGripG' | 'startStagger' | 'startLat'>> = [
  // Veteran: balanced, mistakes rarely.
  { name: 'Veteran',   color: '#ffd166', driftAmplitude: 1.2, driftFreq: 9,  mistakeRate: 0.006, mistakeMinS: 0.8, mistakeMaxS: 1.5 },
  // Aggressor: fastest on straights, worst in corners, error-prone.
  { name: 'Aggressor', color: '#ef476f', driftAmplitude: 2.6, driftFreq: 5,  mistakeRate: 0.028, mistakeMinS: 1.2, mistakeMaxS: 2.4 },
  // Rookie: middling everything, decent mistake rate.
  { name: 'Rookie',    color: '#06d6a0', driftAmplitude: 1.8, driftFreq: 13, mistakeRate: 0.018, mistakeMinS: 1.0, mistakeMaxS: 2.0 },
]

export function createOpponents(track: TrackBundle, difficulty: Difficulty): OpponentState[] {
  const k = DIFFICULTY_SCALE[difficulty]
  // Per-AI base speed and grip — Aggressor is fastest on straights but
  // worst in corners; Veteran is the most balanced.
  //   medium (k=1.0): avg ≈ 73 m/s ≈ 263 km/h
  //   easy   (k=0.88):              ≈ 230 km/h
  //   hard   (k=1.12, capped):      ≈ 290 km/h
  const tuning: Array<{ base: number; grip: number }> = [
    { base: 71, grip: 1.05 },   // Veteran   ≈ 255 km/h
    { base: 78, grip: 0.85 },   // Aggressor ≈ 281 km/h (capped at 302 on hard)
    { base: 69, grip: 0.95 },   // Rookie    ≈ 248 km/h
  ]

  const opps: OpponentState[] = []
  // Player sits in PLAYER_GRID_SLOT (the rear-most slot). Each AI's
  // longitudinal position relative to the player is therefore:
  //   metres ahead = (PLAYER_GRID_SLOT - aiSlot) * GRID_SLOT_M
  // → we convert metres to t-fraction using the live track length so the
  //   grid stays correctly proportioned regardless of circuit scale.
  const trackLen = track.length
  for (let i = 0; i < PROFILES.length; i++) {
    const slot = AI_GRID_SLOTS[PROFILES[i].name] ?? (i + 1)
    const metresAhead = (PLAYER_GRID_SLOT - slot) * GRID_SLOT_M
    const startStagger = metresAhead / trackLen
    const startLat = gridLatForSlot(slot)
    const profile: OpponentProfile = {
      ...PROFILES[i],
      startStagger,
      startLat,
      baseSpeed: Math.min(tuning[i].base * k, BASE_SPEED_CAP),
      latGripG: tuning[i].grip * k,
    }
    const t = ((profile.startStagger % 1) + 1) % 1
    const p = track.getPositionAt(t).clone()
    const tg = track.getTangentAt(t)
    const lat = new THREE.Vector3(-tg.z, 0, tg.x).normalize()
    p.addScaledVector(lat, profile.startLat)
    opps.push({
      profile,
      t,
      lap: 0,
      speed: 0,
      pos: p,
      heading: Math.atan2(tg.x, tg.z),
      mistakeRemaining: 0,
      mistakeJustTriggered: false,
    })
  }
  return opps
}

const LOOKAHEAD = 35 // metres: distance over which we estimate corner severity

export function updateOpponent(
  opp: OpponentState,
  dt: number,
  track: TrackBundle,
  playerProgress?: number,
): void {
  const length = track.length
  const tg = track.getTangentAt(opp.t)

  opp.mistakeJustTriggered = false

  // --- Mistakes: Poisson process. Tick down if active, else maybe trigger.
  if (opp.mistakeRemaining > 0) {
    opp.mistakeRemaining -= dt
    if (opp.mistakeRemaining < 0) opp.mistakeRemaining = 0
  } else if (Math.random() < opp.profile.mistakeRate * dt) {
    const dur = opp.profile.mistakeMinS +
      Math.random() * (opp.profile.mistakeMaxS - opp.profile.mistakeMinS)
    opp.mistakeRemaining = dur
    opp.mistakeJustTriggered = true
  }

  // --- Corner severity: angle change LOOKAHEAD m ahead → max cornering speed.
  const tNext = (opp.t + LOOKAHEAD / length) % 1
  const tgNext = track.getTangentAt(tNext)
  let dot = tg.x * tgNext.x + tg.z * tgNext.z
  if (dot > 1) dot = 1
  if (dot < -1) dot = -1
  const angDiff = Math.acos(dot)
  const curvature = angDiff / LOOKAHEAD
  const grip = opp.profile.latGripG * 9.81
  const vMaxCurve = curvature > 1e-5
    ? Math.sqrt(grip / curvature)
    : Number.POSITIVE_INFINITY
  let vTarget = Math.min(opp.profile.baseSpeed, vMaxCurve)

  // --- Catchup: when behind the player, lift the cap toward player MAX
  // (85 m/s). The bigger the gap, the harder the AI tries — at ~110 m
  // behind it's flat-out at 85 m/s. Capped at MAX so AI never out-runs the
  // player's top speed.
  const PLAYER_MAX = 85
  if (playerProgress !== undefined) {
    const ahead = playerProgress - (opp.lap + opp.t)
    if (ahead > 0.001) {
      const k = Math.min(1, ahead / 0.020) // 0..1 over a 0.020-progress gap
      vTarget = Math.min(PLAYER_MAX, vTarget + (PLAYER_MAX - vTarget) * k * 0.85)
    }
  }

  // --- Mistake forces a hard slowdown for its duration.
  if (opp.mistakeRemaining > 0) {
    vTarget = Math.min(vTarget, opp.speed * 0.5, 35)
  }

  // Smooth toward target — feels like throttle/brake instead of teleport.
  const dv = vTarget - opp.speed
  const accel = dv > 0 ? 22 : 42 // brake harder than accelerate
  opp.speed += Math.sign(dv) * Math.min(Math.abs(dv), accel * dt)
  if (opp.speed < 0) opp.speed = 0

  // Advance arc-length parameter.
  opp.t += (opp.speed * dt) / length
  while (opp.t >= 1) {
    opp.t -= 1
    opp.lap++
  }

  // Lateral position: each AI keeps its own racing-lane offset (startLat) for
  // the whole lap and wobbles around THAT, not the centreline. Without this,
  // two AIs that share a startStagger but start on opposite sides of the
  // grid (e.g. Veteran +3 m, Aggressor -3 m) both snap back to centre the
  // moment the race starts and visibly overlap. Keeping the lane offset
  // persistent also makes overtakes look intentional rather than telepor­ts
  // through each other.
  const p = track.getPositionAt(opp.t).clone()
  const lat = new THREE.Vector3(-tg.z, 0, tg.x).normalize()
  const phase = opp.t * Math.PI * 2 * opp.profile.driftFreq
  const driftScale = opp.mistakeRemaining > 0 ? 3.5 : 1.0
  const wobble = Math.sin(phase) * opp.profile.driftAmplitude * driftScale
  p.addScaledVector(lat, opp.profile.startLat + wobble)
  opp.pos.copy(p)
  opp.heading = Math.atan2(tg.x, tg.z)
}

/** Total race progress (0..N) — for ranking. */
export function progress(state: { t: number; lap: number }): number {
  return state.lap + state.t
}
