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

export function createKeyboard(target: EventTarget = window): KeyboardController {
  const held = new Set<string>()

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
      return left + right
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
