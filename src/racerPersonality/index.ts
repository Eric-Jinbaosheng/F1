/**
 * Racer-personality public entry. Accepts either:
 *   - already-computed PlayerStats (preferred)
 *   - raw RaceData (auto-converted via heuristic scoring)
 *
 * Returns the final Chinese-keyed JSON the front-end card consumes.
 */

import { CORE_TAGS } from './tags'
import { findBestRacerPersonality, normalizeStats, clamp } from './scoring'
import { generateReasons } from './reasonGenerator'
import type { PlayerStats, StatKey } from './driverProfiles'

/** Raw race data the matcher can also accept. Every field optional —
 *  `calculatePlayerStatsFromRaceData` falls back gracefully. */
export interface RaceData {
  bestLapTime?: number
  averageLapTime?: number
  referenceLapTime?: number
  fastestPossibleLapTime?: number
  lapTimes?: number[]
  offTrackCount?: number
  collisionCount?: number
  wallHitCount?: number
  penaltySeconds?: number
  maxSpeed?: number
  averageCornerSpeed?: number
  idealCornerSpeed?: number
  apexHitRate?: number
  brakingAccuracy?: number
  lateBrakeSuccessRate?: number
  lockupCount?: number
  racingLineAccuracy?: number
  trackWidthUsage?: number
  successfulOvertakes?: number
  overtakeAttempts?: number
  lateBrakeOvertakes?: number
  defendedAttacks?: number
  lapsUnderPressure?: number
  riskyOvertakeAttempts?: number
  nearWallCount?: number
  startPosition?: number
  finishPosition?: number
  lastLapQuality?: number
  mistakesUnderPressure?: number
  resourceEfficiency?: number
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** Heuristic mapping from raw race telemetry to the 12 normalised
 *  metrics. Each formula is tuned to land in [0, 100]; unknown values
 *  collapse to a neutral 50. */
export function calculatePlayerStatsFromRaceData(raceData: RaceData): PlayerStats {
  // ---- pace: best-lap delta vs reference + raw top speed contribution.
  const bestLap = num(raceData.bestLapTime, 0)
  const refLap = num(raceData.referenceLapTime, 0)
  const fastestPossible = num(raceData.fastestPossibleLapTime, 0)
  let pace = 50
  if (bestLap > 0 && refLap > 0) {
    // Player matches reference = 80; best possible (5 % faster) = 100.
    const advantage = (refLap - bestLap) / refLap // +ve = faster
    pace = clamp(80 + advantage * 400, 0, 100)
  } else if (bestLap > 0 && fastestPossible > 0) {
    pace = clamp(100 - (bestLap - fastestPossible) * 4, 0, 100)
  }
  if (raceData.maxSpeed !== undefined) {
    // Blend in raw top speed: 250 km/h ≈ 60, 320 km/h ≈ 100.
    const speedScore = clamp((raceData.maxSpeed - 200) * (100 / 120), 0, 100)
    pace = pace * 0.7 + speedScore * 0.3
  }

  // ---- consistency: low std dev across lapTimes = high score.
  let consistency = 50
  if (raceData.lapTimes && raceData.lapTimes.length >= 2) {
    const lt = raceData.lapTimes
    const mean = lt.reduce((a, b) => a + b, 0) / lt.length
    const variance = lt.reduce((a, b) => a + (b - mean) ** 2, 0) / lt.length
    const stdDev = Math.sqrt(variance)
    // 0.0s std dev → 100, 3.0s std dev → 0.
    consistency = clamp(100 - stdDev * 33, 0, 100)
  }

  // ---- clean: fewer mistakes / penalties = higher.
  const mistakes =
    num(raceData.offTrackCount) +
    num(raceData.collisionCount) +
    num(raceData.wallHitCount) +
    num(raceData.penaltySeconds) * 0.4
  const clean = clamp(100 - mistakes * 8, 0, 100)

  // ---- cornering: actual / ideal corner speed + apex hit rate.
  let cornering = 50
  if (raceData.averageCornerSpeed && raceData.idealCornerSpeed) {
    const ratio = raceData.averageCornerSpeed / raceData.idealCornerSpeed
    cornering = clamp(ratio * 90, 0, 100) // 1.0 ratio → 90
  }
  if (raceData.apexHitRate !== undefined) {
    cornering = cornering * 0.65 + clamp(raceData.apexHitRate * 100, 0, 100) * 0.35
  }

  // ---- braking: weighted blend of accuracy / late-brake success / lockup penalty.
  let braking = 50
  const ba = raceData.brakingAccuracy
  const lb = raceData.lateBrakeSuccessRate
  if (ba !== undefined || lb !== undefined) {
    const baScore = ba !== undefined ? ba * 100 : 50
    const lbScore = lb !== undefined ? lb * 100 : 50
    braking = baScore * 0.6 + lbScore * 0.4
  }
  braking = clamp(braking - num(raceData.lockupCount) * 5, 0, 100)

  // ---- racingLine: accuracy + width usage.
  let racingLine = 50
  if (raceData.racingLineAccuracy !== undefined) {
    racingLine = raceData.racingLineAccuracy * 100
  }
  if (raceData.trackWidthUsage !== undefined) {
    racingLine = racingLine * 0.7 + raceData.trackWidthUsage * 100 * 0.3
  }
  racingLine = clamp(racingLine, 0, 100)

  // ---- attack: success rate × volume + late-brake bonus.
  const so = num(raceData.successfulOvertakes)
  const oa = num(raceData.overtakeAttempts)
  const successRate = oa > 0 ? so / oa : 0
  let attack = clamp(so * 12, 0, 100) * 0.5 + successRate * 100 * 0.5
  attack = clamp(attack + num(raceData.lateBrakeOvertakes) * 5, 0, 100)

  // ---- defense: defended attacks per lap-under-pressure.
  let defense = 50
  if (raceData.defendedAttacks !== undefined && raceData.lapsUnderPressure !== undefined) {
    const lup = Math.max(1, raceData.lapsUnderPressure)
    defense = clamp((raceData.defendedAttacks / lup) * 60 + 40, 0, 100)
  } else if (raceData.defendedAttacks !== undefined) {
    defense = clamp(50 + raceData.defendedAttacks * 8, 0, 100)
  }

  // ---- risk: risky moves + near-wall events.
  const risk = clamp(
    num(raceData.riskyOvertakeAttempts) * 12 + num(raceData.nearWallCount) * 7,
    0,
    100,
  )

  // ---- comeback: positions gained from start to finish.
  let comeback = 50
  if (raceData.startPosition !== undefined && raceData.finishPosition !== undefined) {
    const gained = raceData.startPosition - raceData.finishPosition
    comeback = clamp(50 + gained * 8, 0, 100)
  }

  // ---- pressure: last-lap quality minus mistakes-under-pressure.
  let pressure = 50
  if (raceData.lastLapQuality !== undefined) pressure = raceData.lastLapQuality * 100
  pressure = clamp(pressure - num(raceData.mistakesUnderPressure) * 10, 0, 100)

  // ---- management: direct mapping of resource efficiency.
  const management =
    raceData.resourceEfficiency !== undefined
      ? clamp(raceData.resourceEfficiency * 100, 0, 100)
      : 50

  return {
    pace: Math.round(pace),
    consistency: Math.round(consistency),
    clean: Math.round(clean),
    cornering: Math.round(cornering),
    braking: Math.round(braking),
    racingLine: Math.round(racingLine),
    attack: Math.round(attack),
    defense: Math.round(defense),
    risk: Math.round(risk),
    comeback: Math.round(comeback),
    pressure: Math.round(pressure),
    management: Math.round(management),
  }
}

/** Type guard: input is raw race telemetry rather than already-scored stats. */
function isRaceData(input: unknown): input is RaceData {
  if (!input || typeof input !== 'object') return false
  const o = input as Record<string, unknown>
  // Heuristic: race data has none of the 12 stat keys but has at least
  // one telemetry field.
  const statHits = ['pace', 'cornering', 'attack', 'risk'].filter((k) => k in o).length
  if (statHits >= 2) return false
  return (
    'bestLapTime' in o ||
    'lapTimes' in o ||
    'maxSpeed' in o ||
    'finishPosition' in o ||
    'apexHitRate' in o
  )
}

export interface RacerPersonalityResult {
  你的赛车人格: {
    类型名称: string
    类型代码: string
    匹配车手: string
    匹配度: number
    一句话总结: string
  }
  为何你是这个类型: string[]
  核心标签: string[]
  玩家指标: PlayerStats
  相似人格Top3: Array<{
    类型名称: string
    匹配车手: string
    匹配度: number
  }>
}

/** Public entry. Accepts either PlayerStats or RaceData. */
export function generateRacerPersonalityResult(
  input: Partial<PlayerStats> | RaceData,
): RacerPersonalityResult {
  const stats = isRaceData(input)
    ? calculatePlayerStatsFromRaceData(input)
    : normalizeStats(input as Partial<PlayerStats>)

  const { best, ranked } = findBestRacerPersonality(stats)
  const reasons = generateReasons(stats, best)
  const tags = CORE_TAGS[best.typeCode] ?? []

  const top3 = ranked.slice(0, 3).map((r) => ({
    类型名称: r.profile.typeName,
    匹配车手: r.profile.matchedDriver,
    匹配度: Math.round(r.score),
  }))

  return {
    你的赛车人格: {
      类型名称: best.typeName,
      类型代码: best.typeCode,
      匹配车手: best.matchedDriver,
      匹配度: Math.round(ranked[0].score),
      一句话总结: best.summary,
    },
    为何你是这个类型: reasons,
    核心标签: tags,
    玩家指标: stats,
    相似人格Top3: top3,
  }
}

// Re-exports so callers only need `import { ... } from './racerPersonality'`.
export { DRIVER_PROFILES, STAT_KEYS } from './driverProfiles'
export type { DriverProfile, PlayerStats, StatKey } from './driverProfiles'
export { CORE_TAGS } from './tags'
export { WEIGHTS, matchScore, findBestRacerPersonality, normalizeStats, clamp } from './scoring'
export { generateReasons } from './reasonGenerator'
