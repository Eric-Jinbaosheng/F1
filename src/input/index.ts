import { createGyro, tryRequestGyroPermission, type GyroController } from './gyro'
import { createMouseJoystick, type MouseJoystickController } from './mouseJoystick'
import { createTouch, type TouchController } from './touch'
import { createKeyboard, type KeyboardController } from './keyboard'
import { clamp } from '../utils/math'

export interface GameInput {
  steer: number // -1..+1
  throttle: number // 0..1 (auto-cruise baseline + DRS)
  brake: number // 0..1
  drs: boolean
}

export type InputMode = 'gyro' | 'touch' | 'keyboard'

export type GyroSource = 'sensor' | 'mouse'

export interface InputController {
  mode: InputMode
  /** When `mode === 'gyro'`, identifies which provider supplied the data. */
  gyroSource: GyroSource | null
  getInput: () => GameInput
  recenter: () => void
  destroy: () => void
}

const DEFAULT_THROTTLE = 0.6
const DRS_BOOST = 0.4 // raises throttle from 0.6 to 1.0
const FALLBACK_MS = 600

const isCoarsePointer = (): boolean => {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/** Lightweight common interface for any "tilt/joystick" input source. */
interface VirtualStick {
  getSteer: () => number
  getPitch: () => number
  recenter: () => void
  destroy: () => void
}

/**
 * Must be called from inside a user-gesture handler (e.g. button click).
 * If `preferred` is supplied (from the menu), we try that mode first; on
 * failure we fall back to the device-appropriate default.
 */
export async function initInput(preferred?: InputMode): Promise<InputController> {
  const touch: TouchController = createTouch()
  const keyboard: KeyboardController = createKeyboard()

  let gyro: GyroController | null = null
  let mouseJoy: MouseJoystickController | null = null
  let stick: VirtualStick | null = null
  let gyroSource: GyroSource | null = null
  // Default mode: keyboard on desktop (fine pointer), touch on mobile.
  let mode: InputMode = isCoarsePointer() ? 'touch' : 'keyboard'

  // Try gyro if explicitly requested OR (no preference + touch device).
  const wantGyro = preferred === 'gyro' || (!preferred && isCoarsePointer())
  if (wantGyro) {
    try {
      const granted = await tryRequestGyroPermission()
      if (granted) {
        gyro = createGyro()
        await new Promise<void>((res) => setTimeout(res, FALLBACK_MS))
        if (gyro.isAvailable()) {
          stick = gyro
          gyroSource = 'sensor'
          mode = 'gyro'
        } else {
          gyro.destroy()
          gyro = null
        }
      }
    } catch (e) {
      console.warn('[F1S] gyro init failed, will try fallback:', e)
    }
    // No real sensor — desktop fallback: mouse-as-joystick.
    if (!gyro && !isCoarsePointer()) {
      mouseJoy = createMouseJoystick()
      stick = mouseJoy
      gyroSource = 'mouse'
      mode = 'gyro'
    }
  }

  // Honour an explicit non-gyro preference.
  if (preferred === 'keyboard') mode = 'keyboard'
  else if (preferred === 'touch') mode = 'touch'

  const getInput = (): GameInput => {
    // Steer: priority is virtual stick > active keyboard > touch.
    let steer = 0
    const kbSteer = keyboard.getSteer()
    if (stick && mode === 'gyro') {
      steer = stick.getSteer()
      if (steer === 0 && kbSteer !== 0) steer = kbSteer
    } else if (kbSteer !== 0) {
      steer = kbSteer
    } else {
      steer = touch.getSteer()
    }
    steer = clamp(steer, -1, 1)

    const kbThrottle = keyboard.isThrottleHeld()
    const kbBrake = keyboard.isBrakeHeld()
    const kbBoost = keyboard.isBoostHeld()
    const touchDrs = touch.isRightHeld()
    const touchBrake = touch.isLeftHeld() && !touchDrs

    const drs = kbBoost || touchDrs
    let throttle = DEFAULT_THROTTLE
    let brake = 0

    // Keyboard always wins when held — handy fallback during gyro play.
    if (kbThrottle) {
      throttle = drs ? DEFAULT_THROTTLE + DRS_BOOST : 1.0
    } else if (kbBrake) {
      brake = 1.0
    } else if (stick && mode === 'gyro') {
      // Virtual stick pitch: forward = throttle up, back = brake.
      const pitch = stick.getPitch()
      if (pitch > 0) {
        throttle = DEFAULT_THROTTLE + pitch * (1 - DEFAULT_THROTTLE)
      } else if (pitch < 0) {
        // Ease off the throttle AND apply brake — feels like lifting + braking.
        throttle = DEFAULT_THROTTLE * (1 + pitch)
        brake = Math.min(1, -pitch * 0.95)
      }
      if (drs) throttle = Math.min(1, throttle + DRS_BOOST * 0.5)
    } else if (drs) {
      throttle = DEFAULT_THROTTLE + DRS_BOOST
    } else if (touchBrake) {
      brake = 0.8
    }

    return { steer, throttle, brake, drs }
  }

  return {
    mode,
    gyroSource,
    getInput,
    recenter: () => stick?.recenter(),
    destroy: () => {
      gyro?.destroy()
      mouseJoy?.destroy()
      touch.destroy()
      keyboard.destroy()
    },
  }
}
