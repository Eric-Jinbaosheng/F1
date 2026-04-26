// Douyin 互动空间 / 小游戏 sensor bridge.
//
// The Douyin host webview exposes `window.tt.*` (mirroring WeChat's `wx.*`)
// instead of the standard W3C DeviceOrientation / DeviceMotion APIs. Inside
// the sandbox the HTML5 events do not fire at all, so a build that only
// listens for `deviceorientation` will appear "frozen" — exactly the
// symptom the user reported.
//
// Surface area we use:
//   tt.authorize({ scope: 'scope.sensor' })       — gate for user permission
//   tt.startDeviceMotionListening({ interval })   — turn the sensor on
//   tt.onDeviceMotionChange((res) => { ... })     — receives alpha/beta/gamma
//                                                   in degrees, same units as
//                                                   the standard event
//   tt.stopDeviceMotionListening()                — when we tear down
//
// We support both `tt.*` (Douyin / Toutiao) and `wx.*` (WeChat host) so the
// same bundle works inside either embed.

interface MiniMotionEvent {
  alpha?: number
  beta?: number
  gamma?: number
}

interface MiniGyroEvent {
  // Angular velocity in rad/s.
  x?: number
  y?: number
  z?: number
}

interface MiniAccelEvent {
  // m/s². Includes gravity (host platform spec).
  x?: number
  y?: number
  z?: number
}

interface MiniSDK {
  authorize?: (opts: {
    scope: string
    success?: () => void
    fail?: (err?: unknown) => void
  }) => void
  getSetting?: (opts: {
    success?: (res: { authSetting: Record<string, boolean> }) => void
    fail?: (err?: unknown) => void
  }) => void
  startDeviceMotionListening?: (opts: {
    interval?: 'game' | 'ui' | 'normal'
    success?: () => void
    fail?: (err?: unknown) => void
  }) => void
  stopDeviceMotionListening?: (opts?: { success?: () => void }) => void
  onDeviceMotionChange?: (cb: (e: MiniMotionEvent) => void) => void
  offDeviceMotionChange?: (cb: (e: MiniMotionEvent) => void) => void
  startGyroscope?: (opts: {
    interval?: 'game' | 'ui' | 'normal'
    success?: () => void
    fail?: (err?: unknown) => void
  }) => void
  stopGyroscope?: (opts?: { success?: () => void }) => void
  onGyroscopeChange?: (cb: (e: MiniGyroEvent) => void) => void
  offGyroscopeChange?: (cb: (e: MiniGyroEvent) => void) => void
  startAccelerometer?: (opts: {
    interval?: 'game' | 'ui' | 'normal'
    success?: () => void
    fail?: (err?: unknown) => void
  }) => void
  stopAccelerometer?: (opts?: { success?: () => void }) => void
  onAccelerometerChange?: (cb: (e: MiniAccelEvent) => void) => void
  offAccelerometerChange?: (cb: (e: MiniAccelEvent) => void) => void
}

const getSDK = (): MiniSDK | null => {
  const w = window as unknown as { tt?: MiniSDK; wx?: MiniSDK }
  return w.tt ?? w.wx ?? null
}

export const isMiniHost = (): boolean => {
  const sdk = getSDK()
  if (!sdk) return false
  // Any one of these is enough to declare we're inside a mini-host.
  return !!(
    sdk.startDeviceMotionListening ||
    sdk.startGyroscope ||
    sdk.startAccelerometer
  )
}

const promisify =
  <T extends { success?: (res: unknown) => void; fail?: (err?: unknown) => void }>(
    fn: ((opts: T) => void) | undefined,
  ) =>
  (opts: Omit<T, 'success' | 'fail'> = {} as T): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (!fn) {
        reject(new Error('SDK fn missing'))
        return
      }
      fn({
        ...(opts as T),
        success: (res: unknown) => resolve(res),
        fail: (err?: unknown) => reject(err),
      } as T)
    })

/** Ask the host for sensor permission. Resolves true if granted (or if the
 *  host doesn't require an explicit grant — some Douyin builds skip it). */
export async function requestSensorAuth(): Promise<boolean> {
  const sdk = getSDK()
  if (!sdk) return false
  // Check existing permission first (avoid re-prompting on every game start).
  if (sdk.getSetting) {
    try {
      const res = await new Promise<{ authSetting: Record<string, boolean> }>(
        (resolve, reject) => {
          sdk.getSetting!({
            success: (r: { authSetting: Record<string, boolean> }) => resolve(r),
            fail: (e?: unknown) => reject(e),
          })
        },
      )
      if (res.authSetting['scope.sensor']) return true
    } catch {
      // fall through to authorize()
    }
  }
  if (!sdk.authorize) return true // no auth API → assume open
  try {
    await new Promise<void>((resolve, reject) => {
      sdk.authorize!({
        scope: 'scope.sensor',
        success: () => resolve(),
        fail: (e) => reject(e),
      })
    })
    return true
  } catch (e) {
    console.warn('[F1S] Douyin sensor authorize failed:', e)
    return false
  }
}

export type MiniSensorSource = 'devmotion' | 'gyroscope' | 'accelerometer'

export interface MiniSensorListener {
  /** Detected source actually delivering data. */
  source: () => MiniSensorSource | null
  /** Latest beta (rotation around device-X, deg, ~ portrait pitch). */
  beta: () => number | null
  /** Latest gamma (rotation around device-Y, deg, ~ portrait roll). */
  gamma: () => number | null
  destroy: () => void
}

/** Subscribe to whichever sensor API the Douyin host exposes. Tries them
 *  in order of usefulness for our tilt-driven controls:
 *    devmotion   — gives alpha/beta/gamma directly (best fit)
 *    gyroscope   — gives angular velocity, integrated to angles here
 *    accelerometer — gives gravity vector, derived to angles here
 */
export function createMiniSensorListener(): MiniSensorListener | null {
  const sdk = getSDK()
  if (!sdk) return null

  let source: MiniSensorSource | null = null
  let beta: number | null = null
  let gamma: number | null = null

  // Gyroscope integration state (only used if we fall through to gyroscope).
  let gyroLastT = 0
  let gyroIntegBeta = 0
  let gyroIntegGamma = 0

  const motionCb = (e: MiniMotionEvent): void => {
    // Don't downgrade once a higher-priority source is active.
    if (source && source !== 'devmotion') return
    source = 'devmotion'
    beta = typeof e.beta === 'number' ? e.beta : beta
    gamma = typeof e.gamma === 'number' ? e.gamma : gamma
  }
  const gyroCb = (e: MiniGyroEvent): void => {
    if (source && source !== 'gyroscope') return
    source = 'gyroscope'
    const now = performance.now()
    if (gyroLastT > 0) {
      const dt = (now - gyroLastT) / 1000
      // Integrate angular velocity (rad/s) → angle (deg).
      const radToDeg = 57.29577951308232
      gyroIntegBeta += (e.x ?? 0) * dt * radToDeg
      gyroIntegGamma += (e.y ?? 0) * dt * radToDeg
      // Bleed slowly toward zero so drift doesn't accumulate forever
      // (gyroscope-only integration is inherently drifty).
      gyroIntegBeta *= 0.995
      gyroIntegGamma *= 0.995
      beta = gyroIntegBeta
      gamma = gyroIntegGamma
    }
    gyroLastT = now
  }
  const accelCb = (e: MiniAccelEvent): void => {
    if (source && source !== 'accelerometer') return
    source = 'accelerometer'
    const x = e.x ?? 0
    const y = e.y ?? 0
    const z = e.z ?? 0
    // Same derivation as our DeviceMotion fallback in gyro.ts.
    beta = (Math.atan2(-y, z) * 180) / Math.PI
    gamma = (Math.atan2(x, Math.hypot(y, z)) * 180) / Math.PI
  }

  // Best source first. Each start fires asynchronously; whichever delivers
  // data wins (the source-priority guard above keeps later sources from
  // overwriting an earlier one).
  if (sdk.startDeviceMotionListening && sdk.onDeviceMotionChange) {
    try {
      sdk.startDeviceMotionListening({
        interval: 'game',
        success: () => console.log('[F1S][mini] devmotion started'),
        fail: (err) => console.warn('[F1S][mini] devmotion start failed:', err),
      })
      sdk.onDeviceMotionChange(motionCb)
    } catch (e) {
      console.warn('[F1S][mini] devmotion subscribe error:', e)
    }
  }
  if (sdk.startGyroscope && sdk.onGyroscopeChange) {
    try {
      sdk.startGyroscope({
        interval: 'game',
        success: () => console.log('[F1S][mini] gyroscope started'),
        fail: (err) => console.warn('[F1S][mini] gyroscope start failed:', err),
      })
      sdk.onGyroscopeChange(gyroCb)
    } catch (e) {
      console.warn('[F1S][mini] gyroscope subscribe error:', e)
    }
  }
  if (sdk.startAccelerometer && sdk.onAccelerometerChange) {
    try {
      sdk.startAccelerometer({
        interval: 'game',
        success: () => console.log('[F1S][mini] accelerometer started'),
        fail: (err) => console.warn('[F1S][mini] accelerometer start failed:', err),
      })
      sdk.onAccelerometerChange(accelCb)
    } catch (e) {
      console.warn('[F1S][mini] accelerometer subscribe error:', e)
    }
  }
  // Reference promisify so unused-import-style lint doesn't strip — we keep
  // it around for any future SDK fn that returns success/fail callbacks.
  void promisify

  return {
    source: () => source,
    beta: () => beta,
    gamma: () => gamma,
    destroy: () => {
      try {
        sdk.offDeviceMotionChange?.(motionCb)
        sdk.stopDeviceMotionListening?.()
        sdk.offGyroscopeChange?.(gyroCb)
        sdk.stopGyroscope?.()
        sdk.offAccelerometerChange?.(accelCb)
        sdk.stopAccelerometer?.()
      } catch {
        /* noop */
      }
    },
  }
}
