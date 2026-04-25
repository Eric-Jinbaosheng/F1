import { createGyro, tryRequestGyroPermission, type GyroController } from './gyro'
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

export interface InputController {
  mode: InputMode
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

/** Must be called from inside a user-gesture handler (e.g. button click). */
export async function initInput(): Promise<InputController> {
  // Always wire up touch + keyboard fallbacks; gyro is opt-in on mobile.
  const touch: TouchController = createTouch()
  const keyboard: KeyboardController = createKeyboard()

  let gyro: GyroController | null = null
  // Default mode: keyboard on desktop (fine pointer), touch on mobile.
  let mode: InputMode = isCoarsePointer() ? 'touch' : 'keyboard'

  // Only attempt gyro on touch-capable devices — desktop browsers either
  // lack it or fire empty events and would shadow the keyboard.
  if (isCoarsePointer()) {
    try {
      const granted = await tryRequestGyroPermission()
      if (granted) {
        gyro = createGyro()
        await new Promise<void>((res) => setTimeout(res, FALLBACK_MS))
        if (gyro.isAvailable()) {
          mode = 'gyro'
        } else {
          gyro.destroy()
          gyro = null
          mode = 'touch'
        }
      }
    } catch (e) {
      console.warn('[F1S] gyro init failed, falling back to touch:', e)
      mode = 'touch'
    }
  }

  const getInput = (): GameInput => {
    // Steer: priority is gyro > active keyboard > touch.
    let steer = 0
    const kbSteer = keyboard.getSteer()
    if (gyro) {
      steer = gyro.getSteer()
      if (steer === 0 && kbSteer !== 0) steer = kbSteer
    } else if (kbSteer !== 0) {
      steer = kbSteer
    } else {
      steer = touch.getSteer()
    }
    steer = clamp(steer, -1, 1)

    // Throttle / brake: keyboard takes precedence when held; otherwise
    // auto-cruise + touch DRS / brake.
    const kbThrottle = keyboard.isThrottleHeld()
    const kbBrake = keyboard.isBrakeHeld()
    const kbBoost = keyboard.isBoostHeld()
    const touchDrs = touch.isRightHeld()
    const touchBrake = touch.isLeftHeld() && !touchDrs

    const drs = kbBoost || touchDrs
    let throttle = DEFAULT_THROTTLE
    if (kbThrottle) throttle = drs ? DEFAULT_THROTTLE + DRS_BOOST : 1.0
    else if (drs) throttle = DEFAULT_THROTTLE + DRS_BOOST

    let brake = 0
    if (kbBrake) brake = 1.0
    else if (touchBrake) brake = 0.8

    return { steer, throttle, brake, drs }
  }

  return {
    mode,
    getInput,
    recenter: () => gyro?.recenter(),
    destroy: () => {
      gyro?.destroy()
      touch.destroy()
      keyboard.destroy()
    },
  }
}
