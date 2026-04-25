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

/** Score every archetype, sort desc, return best + full ranking. */
export function findBestRacerPersonality(
  player: PlayerStats,
  weights: PlayerStats = WEIGHTS,
): MatchResult {
  const ranked = DRIVER_PROFILES.map((p) => ({
    profile: p,
    score: matchScore(player, p, weights),
  })).sort((a, b) => b.score - a.score)
  return { best: ranked[0].profile, bestScore: ranked[0].score, ranked }
}

/** Sort a player's stats by raw value, return the top N keys. */
export function topStats(player: PlayerStats, n = 4): StatKey[] {
  return [...STAT_KEYS]
    .sort((a, b) => player[b] - player[a])
    .slice(0, n)
}
