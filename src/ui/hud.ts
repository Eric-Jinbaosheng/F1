import { formatLapTime } from '../utils/math'

export interface HudController {
  show: () => void
  hide: () => void
  update: (data: {
    speedKmh: number
    lapMs: number
    mode: string
    gyroSource?: 'sensor' | 'mouse' | null
    position?: number
    fieldSize?: number
  }) => void
  flash: (msg: string, color?: string, ms?: number) => void
}

export function createHud(): HudController {
  let host: HTMLDivElement | null = null
  let speedEl: HTMLDivElement | null = null
  let lapEl: HTMLDivElement | null = null
  let modeEl: HTMLDivElement | null = null
  let posEl: HTMLDivElement | null = null
  let flashEl: HTMLDivElement | null = null
  let flashTimer = 0

  const show = (): void => {
    hide()
    host = document.createElement('div')
    host.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 50;
      color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `
    speedEl = document.createElement('div')
    speedEl.style.cssText = `
      position: absolute; left: 24px; bottom: 24px;
      font-size: 56px; font-weight: 900; letter-spacing: 2px;
      text-shadow: 0 2px 8px rgba(0,0,0,0.7);
    `
    lapEl = document.createElement('div')
    lapEl.style.cssText = `
      position: absolute; right: 24px; top: 24px;
      font-size: 32px; font-weight: 700;
      text-shadow: 0 2px 8px rgba(0,0,0,0.7);
    `
    // On mobile (coarse pointer), the input mode is obvious from how the
    // user is holding the device — the cyan info chip just clutters the
    // screen, so we skip rendering it. Desktop keeps it as a hint for
    // keyboard / mouse-joystick controls.
    const isMobile = (() => {
      try {
        return window.matchMedia('(pointer: coarse)').matches
      } catch {
        return false
      }
    })()
    modeEl = document.createElement('div')
    modeEl.style.cssText = `
      position: absolute; left: 24px; top: 160px;
      font-size: 12px; padding: 4px 8px; border-radius: 4px;
      background: rgba(0,0,0,0.5); color: #25f4ee;
      ${isMobile ? 'display: none;' : ''}
    `
    posEl = document.createElement('div')
    posEl.style.cssText = `
      position: absolute; right: 24px; bottom: 24px;
      font-size: 18px; font-weight: 700; letter-spacing: 3px;
      padding: 8px 18px; border-radius: 8px;
      background: rgba(0,0,0,0.5); color: #fff;
      text-shadow: 0 2px 8px rgba(0,0,0,0.7);
    `
    flashEl = document.createElement('div')
    flashEl.style.cssText = `
      position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
      font-size: 80px; font-weight: 900; letter-spacing: 6px;
      opacity: 0; pointer-events: none;
      text-shadow: 0 4px 24px rgba(0,0,0,0.9);
      transition: opacity 0.15s ease;
    `
    host.appendChild(speedEl)
    host.appendChild(lapEl)
    host.appendChild(modeEl)
    host.appendChild(posEl)
    host.appendChild(flashEl)
    document.body.appendChild(host)
  }

  const hide = (): void => {
    if (host && host.parentElement) host.parentElement.removeChild(host)
    host = null
    speedEl = null
    lapEl = null
    modeEl = null
    posEl = null
    flashEl = null
  }

  const update = (data: {
    speedKmh: number
    lapMs: number
    mode: string
    gyroSource?: 'sensor' | 'mouse' | null
    position?: number
    fieldSize?: number
  }): void => {
    if (speedEl) speedEl.textContent = `${Math.round(data.speedKmh)} km/h`
    if (lapEl) lapEl.textContent = formatLapTime(data.lapMs)
    if (modeEl) {
      modeEl.textContent =
        data.mode === 'gyro'
          ? data.gyroSource === 'mouse'
            ? '鼠标摇杆 · 移动鼠标 = 推摇杆 · 上下=油门/刹车'
            : '体感模式 · 左右倾=转向 · 前后倾=油门/刹车'
          : data.mode === 'keyboard'
            ? '键盘模式 ↑↓←→ / Space=油门 Shift=DRS'
            : '触屏模式'
    }
    if (posEl) {
      if (data.position && data.fieldSize) {
        posEl.textContent = `P${data.position} / ${data.fieldSize}`
        posEl.style.color = data.position === 1 ? '#ffd166' : '#fff'
      } else {
        posEl.textContent = ''
      }
    }
    if (flashEl && flashTimer > 0) {
      flashTimer -= 16
      if (flashTimer <= 0) {
        flashEl.style.opacity = '0'
      }
    }
  }

  const flash = (msg: string, color = '#ff1801', ms = 1500): void => {
    if (!flashEl) return
    flashEl.textContent = msg
    flashEl.style.color = color
    flashEl.style.opacity = '1'
    flashTimer = ms
  }

  return { show, hide, update, flash }
}
