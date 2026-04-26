import { clamp } from '../utils/math'
import {
  createMiniSensorListener,
  isMiniHost,
  requestSensorAuth,
  type MiniSensorListener,
} from './douyinSensor'

const STEER_DEADZONE_DEG = 1.5
// Doubled (28 → 56): user has to tilt 2× as far for the same steering
// magnitude → effectively halves on-track sensitivity.
const STEER_MAX_DEG = 56
const STEER_EMA_ALPHA = 0.3
const STEER_CURVE_POWER = 1.5

const PITCH_DEADZONE_DEG = 2.5
// Doubled (20 → 40): same halving applied to throttle/brake tilt.
const PITCH_MAX_DEG = 40
const PITCH_EMA_ALPHA = 0.3
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
  source: '' | 'orientation' | 'orientationabsolute' | 'motion' | 'mini-devmotion' | 'mini-gyroscope' | 'mini-accelerometer'
  lastBeta: number | null
  lastGamma: number | null
  eventCount: number
}

export interface GyroDebugSnapshot {
  source: string
  available: boolean
  steerDeg: number
  pitchDeg: number
  rawBeta: number | null
  rawGamma: number | null
  effectiveAngle: number
  steer01: number
  pitch01: number
  zeroSteer: number
  zeroPitch: number
  calibrating: boolean
  eventCount: number
  msSinceLastEvent: number
}

export interface GyroController {
  isAvailable: () => boolean
  /** -1..+1 steer signal from left/right tilt (after deadzone, S-curve, EMA). */
  getSteer: () => number
  /** -1..+1 pitch signal from forward/back tilt: + = throttle, − = brake. */
  getPitch: () => number
  /** Diagnostic: which event source produced the last sample. */
  source: () => string
  /** Diagnostic snapshot — for on-screen debug overlay. */
  debug: () => GyroDebugSnapshot
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

/** True when the visible viewport is wider than tall — i.e. the user is
 *  physically holding the device in landscape, regardless of what the
 *  unreliable `screen.orientation` API claims. */
const isLandscapeViewport = (): boolean => {
  try {
    return window.innerWidth >= window.innerHeight
  } catch {
    return false
  }
}

/** Effective screen angle, falling back to a landscape assumption when
 *  `screen.orientation` reports 0 but the viewport is clearly landscape
 *  (the case in many WebView sandboxes — Douyin included — where the API
 *  doesn't update with the iframe's CSS orientation). */
const effectiveAngle = (): number => {
  const a = screenAngle()
  if (a !== 0) return a
  // 0 is suspect — if we ARE in a landscape viewport, default to 90°
  // (landscape-right, USB port on the right). The user can recenter to
  // null out any base-tilt asymmetry; sign-flip handled at recenter time.
  if (isLandscapeViewport()) return 90
  return 0
}

/** Map raw beta/gamma to a single horizontal "steer" angle in degrees,
 *  accounting for landscape orientation. */
const computeSteerDeg = (beta: number | null, gamma: number | null): number => {
  if (beta === null || gamma === null) return 0
  const a = effectiveAngle()
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
  const a = effectiveAngle()
  if (a === 90) return gamma
  if (a === -90 || a === 270) return -gamma
  if (a === 180) return -beta
  return beta
}

/** Derive a steer-equivalent angle from accelerationIncludingGravity. The
 *  gravity vector pointing through the device tells us tilt without needing
 *  the magnetometer/gyro that DeviceOrientationEvent depends on — useful in
 *  webviews that suppress DeviceOrientationEvent (e.g. Douyin's sandboxed
 *  iframe). Output domain matches computeSteerDeg() so the rest of the
 *  pipeline is unchanged. */
const motionToBetaGamma = (
  ax: number | null,
  ay: number | null,
  az: number | null,
): { beta: number; gamma: number } | null => {
  if (ax === null || ay === null || az === null) return null
  // Beta: pitch about device-X. atan2(-ay, az) gives radians.
  const beta = (Math.atan2(-ay, az) * 180) / Math.PI
  // Gamma: roll about device-Y. atan2(ax, sqrt(ay²+az²)) gives radians.
  const gamma = (Math.atan2(ax, Math.hypot(ay, az)) * 180) / Math.PI
  return { beta, gamma }
}

export async function tryRequestGyroPermission(): Promise<boolean> {
  // Inside Douyin / WeChat mini-host, the standard DeviceOrientation events
  // never fire. The host exposes its own `tt.*` / `wx.*` sensor APIs that
  // require an explicit `scope.sensor` authorization. Ask for it FIRST so
  // when createGyro() spins up later, the listeners can immediately receive
  // data.
  if (isMiniHost()) {
    const ok = await requestSensorAuth()
    console.log('[F1S][gyro] mini-host sensor auth:', ok)
    // Even on failure we keep going — the standard web API path may still
    // work if the host supports both.
  }

  // iOS 13+: must call DeviceOrientationEvent.requestPermission() from a
  // user gesture handler. Likewise DeviceMotionEvent on iOS gates motion
  // events. Request both — on Android they're unconditionally available.
  let okOri = true
  let okMot = true
  try {
    const D = (window as unknown as {
      DeviceOrientationEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> }
    }).DeviceOrientationEvent
    if (D && typeof D.requestPermission === 'function') {
      const r = await D.requestPermission()
      okOri = r === 'granted'
    }
  } catch (e) {
    console.warn('[F1S] DeviceOrientationEvent.requestPermission error:', e)
    okOri = false
  }
  try {
    const M = (window as unknown as {
      DeviceMotionEvent?: { requestPermission?: () => Promise<'granted' | 'denied'> }
    }).DeviceMotionEvent
    if (M && typeof M.requestPermission === 'function') {
      const r = await M.requestPermission()
      okMot = r === 'granted'
    }
  } catch (e) {
    console.warn('[F1S] DeviceMotionEvent.requestPermission error:', e)
    okMot = false
  }
  // Always return true if we're in a mini-host — its sensor auth path is
  // independent of these two browser APIs.
  return isMiniHost() || okOri || okMot
}

/** Shortest angular distance from `zero` to `raw` on a circular axis.
 *  W3C beta is [-180,180] and gamma is [-90,90] — naive subtraction breaks
 *  when the player's pose pushes the reading across the ±180 boundary
 *  (e.g. zero=-179, current=+179 ⇒ raw diff 358° but actual physical motion
 *  is only 2°). Wrap into [-180,180] so the steer/pitch signal reflects
 *  the true tilt rather than the wrap discontinuity. */
const wrapDiff = (raw: number, zero: number): number => {
  let d = raw - zero
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
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
  const adjusted = wrapDiff(raw, zero)
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
    source: '',
    lastBeta: null,
    lastGamma: null,
    eventCount: 0,
  }
  const calibStart = performance.now()

  const ingest = (
    beta: number | null,
    gamma: number | null,
    src: GyroInternal['source'],
  ): void => {
    if (beta === null && gamma === null) return
    s.lastBeta = beta
    s.lastGamma = gamma
    s.rawSteerDeg = computeSteerDeg(beta, gamma)
    s.rawPitchDeg = computePitchDeg(beta, gamma)
    s.lastEventAt = performance.now()
    s.eventCount++
    if (s.source !== src) {
      s.source = src
      console.log('[F1S][gyro] using source:', src)
    }
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

  const onOrient = (ev: DeviceOrientationEvent): void => {
    ingest(ev.beta, ev.gamma, 'orientation')
  }
  const onOrientAbs = (ev: DeviceOrientationEvent): void => {
    // Only use absolute as a fallback if normal orientation isn't firing.
    if (s.source && s.source !== 'orientationabsolute') return
    ingest(ev.beta, ev.gamma, 'orientationabsolute')
  }
  const onMotion = (ev: DeviceMotionEvent): void => {
    // DeviceOrientationEvent is preferred — only fall through to motion
    // when nothing else has fired in the last 500 ms.
    const now = performance.now()
    if (s.source && s.source !== 'motion' && now - s.lastEventAt < 500) return
    const a = ev.accelerationIncludingGravity
    if (!a) return
    const bg = motionToBetaGamma(a.x ?? null, a.y ?? null, a.z ?? null)
    if (bg) ingest(bg.beta, bg.gamma, 'motion')
  }

  // Attach all three listeners; first one to deliver wins (orientation
  // events take priority over motion via the source check above).
  window.addEventListener('deviceorientation', onOrient, true)
  window.addEventListener('deviceorientationabsolute', onOrientAbs, true)
  window.addEventListener('devicemotion', onMotion, true)

  // Douyin / WeChat mini-host sensor bridge. When inside the host webview,
  // the standard window events above stay silent — this is the path that
  // actually delivers data. We poll its values into the same ingest()
  // pipeline so all the calibration / deadzone / EMA logic is shared.
  let miniListener: MiniSensorListener | null = null
  if (isMiniHost()) {
    miniListener = createMiniSensorListener()
    if (miniListener) {
      console.log('[F1S][gyro] mini-host sensor listener active')
    }
  }
  let miniPollHandle: ReturnType<typeof setInterval> | null = null
  if (miniListener) {
    miniPollHandle = setInterval(() => {
      const ml = miniListener
      if (!ml) return
      const beta = ml.beta()
      const gamma = ml.gamma()
      const src = ml.source()
      if (beta === null && gamma === null) return
      // Map mini-host source to our internal source enum so the diagnostic
      // overlay shows the actual provider.
      const internalSrc: GyroInternal['source'] =
        src === 'devmotion' ? 'mini-devmotion'
        : src === 'gyroscope' ? 'mini-gyroscope'
        : src === 'accelerometer' ? 'mini-accelerometer'
        : 'mini-devmotion'
      // Mini-host wins over standard events — if we ever start receiving
      // mini data, override any earlier source label so the user sees it.
      ingest(beta, gamma, internalSrc)
    }, 16) // ~60 Hz; the underlying sensor is throttled to 'game' interval (~20 ms)
  }

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
    source: () => s.source,
    debug: (): GyroDebugSnapshot => ({
      source: s.source || 'none',
      available: s.lastEventAt > 0,
      steerDeg: s.rawSteerDeg,
      pitchDeg: s.rawPitchDeg,
      rawBeta: s.lastBeta,
      rawGamma: s.lastGamma,
      effectiveAngle: effectiveAngle(),
      steer01: s.filteredSteer,
      pitch01: s.filteredPitch,
      zeroSteer: s.steerZero,
      zeroPitch: s.pitchZero,
      calibrating: s.calibrating,
      eventCount: s.eventCount,
      msSinceLastEvent: s.lastEventAt > 0 ? performance.now() - s.lastEventAt : -1,
    }),
    recenter: () => {
      s.steerZero = s.rawSteerDeg
      s.pitchZero = s.rawPitchDeg
      s.filteredSteer = 0
      s.filteredPitch = 0
    },
    destroy: () => {
      window.removeEventListener('deviceorientation', onOrient, true)
      window.removeEventListener('deviceorientationabsolute', onOrientAbs, true)
      window.removeEventListener('devicemotion', onMotion, true)
      if (miniPollHandle !== null) clearInterval(miniPollHandle)
      miniListener?.destroy()
    },
  }
}
