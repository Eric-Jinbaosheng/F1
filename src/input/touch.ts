import { clamp } from '../utils/math'

interface TouchPoint {
  id: number
  x: number
  y: number
  startX: number
  side: 'left' | 'right'
}

export interface TouchController {
  getSteer: () => number
  /** boolean for left-half held (drift/brake) and right-half held (drs/throttle boost) */
  isLeftHeld: () => boolean
  isRightHeld: () => boolean
  destroy: () => void
}

export function createTouch(target: HTMLElement = document.body): TouchController {
  const points: Map<number, TouchPoint> = new Map()

  const onStart = (ev: TouchEvent): void => {
    for (const t of Array.from(ev.changedTouches)) {
      const side: 'left' | 'right' = t.clientX < window.innerWidth / 2 ? 'left' : 'right'
      points.set(t.identifier, {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        startX: t.clientX,
        side,
      })
    }
  }
  const onMove = (ev: TouchEvent): void => {
    for (const t of Array.from(ev.changedTouches)) {
      const p = points.get(t.identifier)
      if (!p) continue
      p.x = t.clientX
      p.y = t.clientY
    }
  }
  const onEnd = (ev: TouchEvent): void => {
    for (const t of Array.from(ev.changedTouches)) points.delete(t.identifier)
  }

  target.addEventListener('touchstart', onStart, { passive: true })
  target.addEventListener('touchmove', onMove, { passive: true })
  target.addEventListener('touchend', onEnd, { passive: true })
  target.addEventListener('touchcancel', onEnd, { passive: true })

  const getSteer = (): number => {
    if (points.size === 0) return 0
    // Average sign across active touches; magnitude grows with sustained press time
    // Simpler: each held side contributes ±1
    let s = 0
    for (const p of points.values()) {
      s += p.side === 'left' ? -1 : 1
    }
    return clamp(s, -1, 1)
  }

  const isLeftHeld = (): boolean => {
    for (const p of points.values()) if (p.side === 'left') return true
    return false
  }
  const isRightHeld = (): boolean => {
    for (const p of points.values()) if (p.side === 'right') return true
    return false
  }

  return {
    getSteer,
    isLeftHeld,
    isRightHeld,
    destroy: () => {
      target.removeEventListener('touchstart', onStart)
      target.removeEventListener('touchmove', onMove)
      target.removeEventListener('touchend', onEnd)
      target.removeEventListener('touchcancel', onEnd)
    },
  }
}
