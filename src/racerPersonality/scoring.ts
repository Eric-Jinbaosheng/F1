/**
 * Numerical core: stat normalisation, weighted similarity scoring, and
 * the best-match search that powers the personality matcher.
 */

import {
  DRIVER_PROFILES,
  STAT_KEYS,
  type DriverProfile,
  type PlayerStats,
  type StatKey,
} from './driverProfiles'

/** Per-stat weight applied to the absolute difference. Pace, consistency
 *  and clean drive weigh slightly more because they shape "first
 *  impression" of a driving style; racing line / management slightly less. */
export const WEIGHTS: PlayerStats = {
  pace: 1.25,
  consistency: 1.15,
  clean: 1.15,
  cornering: 1.0,
  braking: 1.0,
  racingLine: 1.0,
  attack: 1.1,
  defense: 1.0,
  risk: 1.1,
  comeback: 1.0,
  pressure: 1.1,
  management: 0.95,
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

/** Coerce arbitrary input into a complete 12-key 0..100 PlayerStats.
 *  Missing keys default to 50 (neutral); out-of-range values are clamped. */
export function normalizeStats(input: Partial<PlayerStats> | undefined | null): PlayerStats {
  const out = {} as PlayerStats
  for (const k of STAT_KEYS) {
    const raw = (input?.[k] ?? 50) as number
    out[k] = clamp(typeof raw === 'number' ? raw : 50, 0, 100)
  }
  return out
}

/** Weighted similarity 0..100. 100 = identical profile. */
export function matchScore(
  player: PlayerStats,
  driver: DriverProfile,
  weights: PlayerStats = WEIGHTS,
): number {
  let totalWeight = 0
  let weightedDiff = 0
  for (const k of STAT_KEYS) {
    const w = weights[k]
    weightedDiff += Math.abs(player[k] - driver.profile[k]) * w
    totalWeight += w
  }
  const avgDiff = totalWeight > 0 ? weightedDiff / totalWeight : 0
  return clamp(100 - avgDiff, 0, 100)
}

export interface MatchResult {
  best: DriverProfile
  bestScore: number
  ranked: Array<{ profile: DriverProfile; score: number }>
}

/** Score every archetype, sort desc, return best + full ranking.
 *
 *  With a small active roster (HMLT/ANTO/VSTP) deterministic argmax
 *  always picks the same archetype for typical play, so the player
 *  feels like they "always get ANTO". We make the result genuinely
 *  varied by:
 *
 *    1. Sampling near-uniformly from all active candidates (weighted
 *       only loosely by score so good play still nudges the pick).
 *    2. Refusing to repeat the immediately previous archetype when
 *       the active pool has > 1 entry — ensures the player sees a
 *       different card on consecutive runs.
 */
const SOFTNESS: number = 1 // 0 = uniform; 1 = mild bias toward higher score
const TOP_N = 6
const LAST_PICK_KEY = 'f1s_last_personality'

const readLastPick = (): string | null => {
  try {
    return typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(LAST_PICK_KEY)
      : null
  } catch {
    return null
  }
}
const writeLastPick = (code: string): void => {
  try {
    sessionStorage?.setItem(LAST_PICK_KEY, code)
  } catch {
    /* noop */
  }
}

export function findBestRacerPersonality(
  player: PlayerStats,
  weights: PlayerStats = WEIGHTS,
): MatchResult {
  const ranked = DRIVER_PROFILES.map((p) => ({
    profile: p,
    score: matchScore(player, p, weights),
  })).sort((a, b) => b.score - a.score)

  let pool = ranked.slice(0, Math.min(TOP_N, ranked.length))
  // Refuse to re-pick the same archetype as the last run when we have
  // alternatives — guarantees consecutive games show different cards.
  const last = readLastPick()
  if (last && pool.length > 1 && pool.some((r) => r.profile.typeCode === last)) {
    const filtered = pool.filter((r) => r.profile.typeCode !== last)
    if (filtered.length > 0) pool = filtered
  }

  const weightsArr = pool.map((r) =>
    SOFTNESS === 0 ? 1 : Math.pow(Math.max(r.score, 1), SOFTNESS),
  )
  const total = weightsArr.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  let pickedIdx = 0
  for (let i = 0; i < pool.length; i++) {
    r -= weightsArr[i]
    if (r <= 0) {
      pickedIdx = i
      break
    }
  }
  const picked = pool[pickedIdx]
  writeLastPick(picked.profile.typeCode)

  // Promote the picked one to the head of `ranked` so callers that read
  // ranked[0] (e.g. for 匹配度) stay in sync with `best`.
  const reordered = [picked, ...ranked.filter((r) => r !== picked)]
  return { best: picked.profile, bestScore: picked.score, ranked: reordered }
}

/** Sort a player's stats by raw value, return the top N keys. */
export function topStats(player: PlayerStats, n = 4): StatKey[] {
  return [...STAT_KEYS]
    .sort((a, b) => player[b] - player[a])
    .slice(0, n)
}
