export interface KeyboardController {
  /** -1..+1 steer signal from arrow / A-D / Q-E keys */
  getSteer: () => number
  /** true if Up / W / Space is held */
  isThrottleHeld: () => boolean
  /** true if Down / S is held */
  isBrakeHeld: () => boolean
  /** true if Shift is held (DRS boost) */
  isBoostHeld: () => boolean
  isAnyHeld: () => boolean
  destroy: () => void
}

const STEER_KEYS_LEFT = new Set(['ArrowLeft', 'a', 'A', 'q', 'Q'])
const STEER_KEYS_RIGHT = new Set(['ArrowRight', 'd', 'D', 'e', 'E'])
const THROTTLE_KEYS = new Set(['ArrowUp', 'w', 'W', ' '])
const BRAKE_KEYS = new Set(['ArrowDown', 's', 'S'])
const BOOST_KEYS = new Set(['Shift'])

// --- Steering tuning: keyboard input is binary (key down / up) so the
// raw signal is jerky compared to analog gyro / mouse stick. We tame it
// in two ways:
//   MAX_STEER < 1  → cap the magnitude so a held key isn't full-lock
//   RAMP_RATE      → smoothly accelerate the value toward the target
//                    instead of slamming straight to ±MAX_STEER
const KB_MAX_STEER = 0.7
const KB_RAMP_RATE_PER_S = 4.0 // 0 → MAX_STEER takes ~175 ms

export function createKeyboard(target: EventTarget = window): KeyboardController {
  const held = new Set<string>()
  let steerSmoothed = 0
  let lastSteerCallMs = 0

  const onDown = (ev: Event): void => {
    const k = (ev as KeyboardEvent).key
    if (
      STEER_KEYS_LEFT.has(k) ||
      STEER_KEYS_RIGHT.has(k) ||
      THROTTLE_KEYS.has(k) ||
      BRAKE_KEYS.has(k) ||
      BOOST_KEYS.has(k)
    ) {
      held.add(k)
      ev.preventDefault()
    }
  }
  const onUp = (ev: Event): void => {
    const k = (ev as KeyboardEvent).key
    held.delete(k)
  }
  const onBlur = (): void => held.clear()

  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  window.addEventListener('blur', onBlur)

  const anyIn = (set: Set<string>): boolean => {
    for (const k of held) if (set.has(k)) return true
    return false
  }

  return {
    getSteer: () => {
      const left = anyIn(STEER_KEYS_LEFT) ? -1 : 0
      const right = anyIn(STEER_KEYS_RIGHT) ? 1 : 0
      const target = (left + right) * KB_MAX_STEER

      // Frame-rate-independent ramp toward `target`. First call seeds dt
      // to one frame so the very first poll doesn't take a giant step.
      const now = performance.now()
      const dt = lastSteerCallMs === 0
        ? 0.016
        : Math.min(0.05, (now - lastSteerCallMs) / 1000)
      lastSteerCallMs = now

      const diff = target - steerSmoothed
      const step = KB_RAMP_RATE_PER_S * dt
      if (Math.abs(diff) <= step) steerSmoothed = target
      else steerSmoothed += Math.sign(diff) * step
      return steerSmoothed
    },
    isThrottleHeld: () => anyIn(THROTTLE_KEYS),
    isBrakeHeld: () => anyIn(BRAKE_KEYS),
    isBoostHeld: () => anyIn(BOOST_KEYS),
    isAnyHeld: () => held.size > 0,
    destroy: () => {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    },
  }
}
