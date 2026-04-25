import { clamp } from '../utils/math'

const DEADZONE_DEG = 3
const MAX_ANGLE_DEG = 30
const EMA_ALPHA = 0.25
const CURVE_POWER = 1.6
const CALIBRATE_MS = 1000

interface GyroInternal {
  rawAngle: number
  filtered: number
  zero: number
  calibrating: boolean
  calibAccum: number
  calibCount: number
  lastEventAt: number
}

export interface GyroController {
  isAvailable: () => boolean
  /** -1..+1 steer signal after deadzone, limit, EMA, S-curve */
  getSteer: () => number
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
  // Older iOS: window.orientation
  const w = window as unknown as { orientation?: number }
  return typeof w.orientation === 'number' ? w.orientation : 0
}

/** Map raw beta/gamma to a single horizontal "steer" angle in degrees,
 * accounting for landscape orientation. */
const computeSteerDeg = (beta: number | null, gamma: number | null): number => {
  if (beta === null || gamma === null) return 0
  const a = screenAngle()
  if (a === 90) return beta
  if (a === -90 || a === 270) return -beta
  if (a === 180) return -gamma
  return gamma
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

export function createGyro(): GyroController {
  const s: GyroInternal = {
    rawAngle: 0,
    filtered: 0,
    zero: 0,
    calibrating: true,
    calibAccum: 0,
    calibCount: 0,
    lastEventAt: 0,
  }
  const calibStart = performance.now()

  const onOrient = (ev: DeviceOrientationEvent): void => {
    const deg = computeSteerDeg(ev.beta, ev.gamma)
    s.rawAngle = deg
    s.lastEventAt = performance.now()
    if (s.calibrating) {
      s.calibAccum += deg
      s.calibCount++
      if (performance.now() - calibStart > CALIBRATE_MS) {
        s.zero = s.calibCount > 0 ? s.calibAccum / s.calibCount : 0
        s.calibrating = false
      }
    }
  }
  window.addEventListener('deviceorientation', onOrient, true)

  const getSteer = (): number => {
    if (s.lastEventAt === 0) return 0
    const adjusted = s.rawAngle - s.zero
    let v = adjusted
    const sign = v < 0 ? -1 : 1
    const mag = Math.abs(v)
    if (mag < DEADZONE_DEG) v = 0
    else {
      const norm = clamp((mag - DEADZONE_DEG) / (MAX_ANGLE_DEG - DEADZONE_DEG), 0, 1)
      v = sign * Math.pow(norm, CURVE_POWER)
    }
    s.filtered = s.filtered + (v - s.filtered) * EMA_ALPHA
    return clamp(s.filtered, -1, 1)
  }

  return {
    isAvailable: () => s.lastEventAt > 0,
    getSteer,
    recenter: () => {
      s.zero = s.rawAngle
      s.filtered = 0
    },
    destroy: () => {
      window.removeEventListener('deviceorientation', onOrient, true)
    },
  }
}
