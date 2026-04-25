export type TickFn = (dt: number, now: number) => void

export class GameLoop {
  private rafId: number | null = null
  private lastTime = 0
  private readonly maxDt = 1 / 30
  private readonly tick: TickFn

  constructor(tick: TickFn) {
    this.tick = tick
  }

  start(): void {
    if (this.rafId !== null) return
    this.lastTime = performance.now()
    const frame = (now: number) => {
      const rawDt = (now - this.lastTime) / 1000
      this.lastTime = now
      const dt = rawDt > this.maxDt ? this.maxDt : rawDt
      try {
        this.tick(dt, now)
      } catch (e) {
        console.warn('[F1S] tick error:', e)
      }
      this.rafId = requestAnimationFrame(frame)
    }
    this.rafId = requestAnimationFrame(frame)
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
}
