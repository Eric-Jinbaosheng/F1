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
  easy: 0.86,
  medium: 1.0,
  hard: 1.06,
}

const PROFILES: Array<Omit<OpponentProfile, 'baseSpeed' | 'latGripG'>> = [
  // Veteran: balanced, mistakes rarely.
  { name: 'Veteran',   color: '#ffd166', driftAmplitude: 1.2, driftFreq: 9,  startStagger: 0.0030, startLat:  3, mistakeRate: 0.006, mistakeMinS: 0.8, mistakeMaxS: 1.5 },
  // Aggressor: fastest on straights, worst in corners, error-prone.
  { name: 'Aggressor', color: '#ef476f', driftAmplitude: 2.6, driftFreq: 5,  startStagger: 0.0030, startLat: -3, mistakeRate: 0.028, mistakeMinS: 1.2, mistakeMaxS: 2.4 },
  // Rookie: middling everything, decent mistake rate.
  { name: 'Rookie',    color: '#06d6a0', driftAmplitude: 1.8, driftFreq: 13, startStagger: 0.0055, startLat:  0, mistakeRate: 0.018, mistakeMinS: 1.0, mistakeMaxS: 2.0 },
]

export function createOpponents(track: TrackBundle, difficulty: Difficulty): OpponentState[] {
  const k = DIFFICULTY_SCALE[difficulty]
  // Per-AI base speed and grip — Aggressor is fastest on straights but
  // worst in corners; Veteran is the most balanced.
  // Targets a field average of ~78 m/s (≈280 km/h) on medium difficulty.
  const tuning: Array<{ base: number; grip: number }> = [
    { base: 86, grip: 1.05 },   // Veteran
    { base: 92, grip: 0.85 },   // Aggressor
    { base: 84, grip: 0.95 },   // Rookie
  ]

  const opps: OpponentState[] = []
  for (let i = 0; i < 3; i++) {
    const profile: OpponentProfile = {
      ...PROFILES[i],
      baseSpeed: tuning[i].base * k,
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

  // --- Catchup: when behind the player, briefly raise the cap. The further
  // behind, the bigger the boost — but max +18 % so the AI can't teleport.
  if (playerProgress !== undefined) {
    const ahead = playerProgress - (opp.lap + opp.t)
    if (ahead > 0.002) {
      const boostFactor = 1 + Math.min(0.18, ahead * 18)
      vTarget = Math.min(opp.profile.baseSpeed * 1.18, vTarget * boostFactor)
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

  // Lateral position: small sin-wave drift normally, larger wobble during a
  // mistake (looks like the car running wide / clipping a kerb).
  const p = track.getPositionAt(opp.t).clone()
  const lat = new THREE.Vector3(-tg.z, 0, tg.x).normalize()
  const phase = opp.t * Math.PI * 2 * opp.profile.driftFreq
  const driftScale = opp.mistakeRemaining > 0 ? 3.5 : 1.0
  const off = Math.sin(phase) * opp.profile.driftAmplitude * driftScale
  p.addScaledVector(lat, off)
  opp.pos.copy(p)
  opp.heading = Math.atan2(tg.x, tg.z)
}

/** Total race progress (0..N) — for ranking. */
export function progress(state: { t: number; lap: number }): number {
  return state.lap + state.t
}
