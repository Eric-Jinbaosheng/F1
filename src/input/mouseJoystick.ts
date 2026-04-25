import { clamp } from '../utils/math'

const DEADZONE_PX = 80
const MAX_PX = 280
const CURVE_POWER = 1.4

export interface MouseJoystickController {
  getSteer: () => number
  /** + = forward / throttle (cursor above centre); − = back / brake. */
  getPitch: () => number
  /** Snap the centre to the current cursor position. */
  recenter: () => void
  destroy: () => void
}

/** Treats the mouse cursor as a virtual joystick centred on the viewport.
 *  Cursor right of centre → steer right; cursor above centre → throttle.
 *  Same getSteer/getPitch contract as the real gyro so the rest of the
 *  input system can use either source interchangeably. */
export function createMouseJoystick(): MouseJoystickController {
  let cx = window.innerWidth / 2
  let cy = window.innerHeight / 2
  let mx = cx
  let my = cy

  const onMove = (ev: MouseEvent): void => {
    mx = ev.clientX
    my = ev.clientY
  }
  const onResize = (): void => {
    cx = window.innerWidth / 2
    cy = window.innerHeight / 2
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('resize', onResize)

  const norm = (delta: number): number => {
    const sign = delta < 0 ? -1 : 1
    const mag = Math.abs(delta)
    if (mag < DEADZONE_PX) return 0
    const v = clamp((mag - DEADZONE_PX) / (MAX_PX - DEADZONE_PX), 0, 1)
    return sign * Math.pow(v, CURVE_POWER)
  }

  return {
    getSteer: () => norm(mx - cx),
    // Cursor up (smaller y) = throttle, cursor down (larger y) = brake.
    getPitch: () => -norm(my - cy),
    recenter: () => {
      cx = mx
      cy = my
    },
    destroy: () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('resize', onResize)
    },
  }
}
