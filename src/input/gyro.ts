import { clamp } from '../utils/math'

const STEER_DEADZONE_DEG = 3
const STEER_MAX_DEG = 30
const STEER_EMA_ALPHA = 0.25
const STEER_CURVE_POWER = 1.6

const PITCH_DEADZONE_DEG = 5
const PITCH_MAX_DEG = 22
const PITCH_EMA_ALPHA = 0.25
const PITCH_CURVE_POWER = 1.4

const CALIBRATE_MS = 1000

interface GyroInternal {
  rawSteerDeg: number
  filteredSteer: number
  steerZero: number

  rawPitchDeg: number
  filteredPitch: number
  pitchZero: number

  calibrating: boolean
  calibSteerSum: number
  calibPitchSum: number
  calibCount: number
  lastEventAt: number
}

export interface GyroController {
  isAvailable: () => boolean
  /** -1..+1 steer signal from left/right tilt (after deadzone, S-curve, EMA). */
  getSteer: () => number
  /** -1..+1 pitch signal from forward/back tilt: + = throttle, − = brake. */
  getPitch: () => number
  recenter: () => void
  destroy: () => void
}

const screenAngle = (): number => {
  try {
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
      return screen.orientation.angle
    }
  } catch {
    /* noop */
  }
  const w = window as unknown as { orientation?: number }
  return typeof w.orientation === 'number' ? w.orientation : 0
}

/** Map raw beta/gamma to a single horizontal "steer" angle in degrees,
 *  accounting for landscape orientation. */
const computeSteerDeg = (beta: number | null, gamma: number | null): number => {
  if (beta === null || gamma === null) return 0
  const a = screenAngle()
  if (a === 90) return beta
  if (a === -90 || a === 270) return -beta
  if (a === 180) return -gamma
  return gamma
}

/** Map raw beta/gamma to a single "pitch" angle in degrees (forward/back
 *  tilt). In landscape, the device's long axis swaps with its short axis,
 *  so what looks like "tilt forward" maps to a different sensor channel. */
const computePitchDeg = (beta: number | null, gamma: number | null): number => {
  if (beta === null || gamma === null) return 0
  const a = screenAngle()
  if (a === 90) return gamma
  if (a === -90 || a === 270) return -gamma
  if (a === 180) return -beta
  return beta
}

export async function tryRequestGyroPermission(): Promise<boolean> {
  try {
    const D = (window as unknown as {
      DeviceOrientationEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> }
    }).DeviceOrientationEvent
    if (D && typeof D.requestPermission === 'function') {
      const result = await D.requestPermission()
      return result === 'granted'
    }
    // Non-iOS: assume available; actual presence verified via event arrival
    return true
  } catch (e) {
    console.warn('[F1S] gyro permission error:', e)
    return false
  }
}

const filterSignal = (
  raw: number,
  zero: number,
  prev: number,
  deadzoneDeg: number,
  maxDeg: number,
  curvePow: number,
  emaAlpha: number,
): number => {
  const adjusted = raw - zero
  const sign = adjusted < 0 ? -1 : 1
  const mag = Math.abs(adjusted)
  let v: number
  if (mag < deadzoneDeg) {
    v = 0
  } else {
    const norm = clamp((mag - deadzoneDeg) / (maxDeg - deadzoneDeg), 0, 1)
    v = sign * Math.pow(norm, curvePow)
  }
  const next = prev + (v - prev) * emaAlpha
  return clamp(next, -1, 1)
}

export function createGyro(): GyroController {
  const s: GyroInternal = {
    rawSteerDeg: 0,
    filteredSteer: 0,
    steerZero: 0,
    rawPitchDeg: 0,
    filteredPitch: 0,
    pitchZero: 0,
    calibrating: true,
    calibSteerSum: 0,
    calibPitchSum: 0,
    calibCount: 0,
    lastEventAt: 0,
  }
  const calibStart = performance.now()

  const onOrient = (ev: DeviceOrientationEvent): void => {
    s.rawSteerDeg = computeSteerDeg(ev.beta, ev.gamma)
    s.rawPitchDeg = computePitchDeg(ev.beta, ev.gamma)
    s.lastEventAt = performance.now()
    if (s.calibrating) {
      s.calibSteerSum += s.rawSteerDeg
      s.calibPitchSum += s.rawPitchDeg
      s.calibCount++
      if (performance.now() - calibStart > CALIBRATE_MS) {
        if (s.calibCount > 0) {
          s.steerZero = s.calibSteerSum / s.calibCount
          s.pitchZero = s.calibPitchSum / s.calibCount
        }
        s.calibrating = false
      }
    }
  }
  window.addEventListener('deviceorientation', onOrient, true)

  const getSteer = (): number => {
    if (s.lastEventAt === 0) return 0
    s.filteredSteer = filterSignal(
      s.rawSteerDeg, s.steerZero, s.filteredSteer,
      STEER_DEADZONE_DEG, STEER_MAX_DEG, STEER_CURVE_POWER, STEER_EMA_ALPHA,
    )
    return s.filteredSteer
  }

  const getPitch = (): number => {
    if (s.lastEventAt === 0) return 0
    s.filteredPitch = filterSignal(
      s.rawPitchDeg, s.pitchZero, s.filteredPitch,
      PITCH_DEADZONE_DEG, PITCH_MAX_DEG, PITCH_CURVE_POWER, PITCH_EMA_ALPHA,
    )
    return s.filteredPitch
  }

  return {
    isAvailable: () => s.lastEventAt > 0,
    getSteer,
    getPitch,
    recenter: () => {
      s.steerZero = s.rawSteerDeg
      s.pitchZero = s.rawPitchDeg
      s.filteredSteer = 0
      s.filteredPitch = 0
    },
    destroy: () => {
      window.removeEventListener('deviceorientation', onOrient, true)
    },
  }
}
