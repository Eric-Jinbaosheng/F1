import { formatLapTime } from '../utils/math'
import { storage } from '../utils/storage'

export interface ResultController {
  show: (data: {
    lapMs: number
    topSpeedKmh: number
    crashes: number
    opponentHits: number
    position: number
    fieldSize: number
    isPB: boolean
    onRestart: () => void
    onMenu: () => void
  }) => void
  hide: () => void
}

const HEADLINES: Record<number, { text: string; color: string }> = {
  1: { text: '🏆 P1 · 冠 军',   color: '#ffd166' },
  2: { text: 'P2 · 亚 军',       color: '#c0c0c0' },
  3: { text: 'P3 · 季 军',       color: '#cd7f32' },
  4: { text: 'P4 · 完 赛',       color: '#aaaaaa' },
}

export function createResult(): ResultController {
  let host: HTMLDivElement | null = null

  const hide = (): void => {
    if (host && host.parentElement) host.parentElement.removeChild(host)
    host = null
  }

  const show = (data: Parameters<ResultController['show']>[0]): void => {
    hide()
    host = document.createElement('div')
    host.style.cssText = `
      position: fixed; inset: 0; z-index: 100;
      display: flex; align-items: center; justify-content: center;
      background: rgba(10,14,26,0.92); color: #fff; padding: 24px;
      flex-direction: column; gap: 16px;
    `
    const head = HEADLINES[data.position] ?? { text: 'FINISH', color: '#ff1801' }
    const title = document.createElement('div')
    title.textContent = head.text
    title.style.cssText = `font-size: 36px; font-weight: 900; letter-spacing: 6px; color: ${head.color};`

    const sub = document.createElement('div')
    sub.style.cssText = 'font-size: 14px; color: #aaa; letter-spacing: 4px;'
    sub.textContent = data.isPB ? '🔥 PERSONAL BEST' : `共 ${data.fieldSize} 名车手`

    const lap = document.createElement('div')
    lap.textContent = formatLapTime(data.lapMs)
    lap.style.cssText = 'font-size: 72px; font-weight: 900; font-variant-numeric: tabular-nums;'

    const stats = document.createElement('div')
    stats.style.cssText = 'display: flex; gap: 28px; font-size: 14px; color: #aaa; flex-wrap: wrap; justify-content: center;'
    stats.innerHTML = `
      <div>顶速 <span style="color:#fff;font-size:20px;font-weight:700">${Math.round(data.topSpeedKmh)}</span> km/h</div>
      <div>撞墙 <span style="color:#fff;font-size:20px;font-weight:700">${data.crashes}</span> 次</div>
      <div>追尾 <span style="color:#fff;font-size:20px;font-weight:700">${data.opponentHits}</span> 次</div>
      <div>历史最佳 <span style="color:#fff;font-size:20px;font-weight:700">${storage.getBestLap() ? formatLapTime(storage.getBestLap()!) : '—'}</span></div>
    `

    const buttons = document.createElement('div')
    buttons.style.cssText = 'display: flex; gap: 16px; margin-top: 16px;'
    const restart = document.createElement('button')
    restart.textContent = '再 来 一 局'
    restart.style.cssText = `
      min-width: 160px; min-height: 64px;
      background: #ff1801; color: #fff; border: none; border-radius: 8px;
      font-size: 20px; font-weight: 800; letter-spacing: 4px; cursor: pointer;
    `
    restart.addEventListener('click', () => {
      data.onRestart()
    }, { once: true })
    const menu = document.createElement('button')
    menu.textContent = '返 回 首 页'
    menu.style.cssText = `
      min-width: 160px; min-height: 64px;
      background: transparent; color: #fff; border: 2px solid #fff; border-radius: 8px;
      font-size: 20px; font-weight: 800; letter-spacing: 4px; cursor: pointer;
    `
    menu.addEventListener('click', () => {
      data.onMenu()
    }, { once: true })
    buttons.appendChild(restart)
    buttons.appendChild(menu)

    host.appendChild(title)
    host.appendChild(sub)
    host.appendChild(lap)
    host.appendChild(stats)
    host.appendChild(buttons)
    document.body.appendChild(host)
  }

  return { show, hide }
}
