import { storage } from '../utils/storage'
import { formatLapTime } from '../utils/math'
import type { Difficulty } from '../game/opponents'

export interface MenuController {
  show: (onStart: (difficulty: Difficulty) => void) => void
  hide: () => void
}

const DIFF_LABELS: Record<Difficulty, { label: string; tag: string }> = {
  easy: { label: '简 单', tag: '新手友好' },
  medium: { label: '中 等', tag: '势均力敌' },
  hard: { label: '困 难', tag: '强劲对手' },
}

export function createMenu(): MenuController {
  let host: HTMLDivElement | null = null

  const show = (onStart: (difficulty: Difficulty) => void): void => {
    hide()
    host = document.createElement('div')
    host.style.cssText = `
      position: fixed; inset: 0; z-index: 100;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: linear-gradient(180deg, rgba(10,14,26,0.85), rgba(10,14,26,0.95));
      color: #fff; gap: 20px; padding: 24px;
    `
    const title = document.createElement('div')
    title.textContent = 'F1 体感飙速'
    title.style.cssText = 'font-size: 48px; font-weight: 900; letter-spacing: 4px;'

    const sub = document.createElement('div')
    sub.textContent = 'FEEL THE F1'
    sub.style.cssText = 'font-size: 18px; color: #ff1801; letter-spacing: 6px; font-weight: 700;'

    const diffLabel = document.createElement('div')
    diffLabel.textContent = '选 择 难 度'
    diffLabel.style.cssText = 'font-size: 14px; color: #aaa; letter-spacing: 4px; margin-top: 8px;'

    const diffRow = document.createElement('div')
    diffRow.style.cssText = 'display: flex; gap: 12px;'

    let selected: Difficulty = 'medium'
    const diffButtons: Record<Difficulty, HTMLButtonElement> = {} as Record<Difficulty, HTMLButtonElement>
    const paint = (): void => {
      for (const d of Object.keys(DIFF_LABELS) as Difficulty[]) {
        const b = diffButtons[d]
        const active = d === selected
        b.style.background = active ? '#ff1801' : 'transparent'
        b.style.color = active ? '#fff' : '#ddd'
        b.style.borderColor = active ? '#ff1801' : '#666'
      }
    }
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
      const b = document.createElement('button')
      b.style.cssText = `
        min-width: 110px; min-height: 56px;
        background: transparent; color: #ddd; border: 2px solid #666; border-radius: 8px;
        font-size: 16px; font-weight: 700; letter-spacing: 2px; cursor: pointer;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 6px 12px;
      `
      const lab = document.createElement('div')
      lab.textContent = DIFF_LABELS[d].label
      lab.style.cssText = 'font-size: 18px; font-weight: 800;'
      const tag = document.createElement('div')
      tag.textContent = DIFF_LABELS[d].tag
      tag.style.cssText = 'font-size: 11px; opacity: 0.8; margin-top: 2px;'
      b.appendChild(lab)
      b.appendChild(tag)
      b.addEventListener('click', () => {
        selected = d
        paint()
      })
      diffButtons[d] = b
      diffRow.appendChild(b)
    }
    paint()

    const btn = document.createElement('button')
    btn.textContent = '开 始 比 赛'
    btn.style.cssText = `
      min-width: 220px; min-height: 76px; margin-top: 8px;
      background: #fff; color: #ff1801;
      border: none; border-radius: 8px;
      font-size: 22px; font-weight: 900; letter-spacing: 4px;
      cursor: pointer;
    `
    btn.addEventListener('click', () => {
      onStart(selected)
    }, { once: true })

    const note = document.createElement('div')
    note.style.cssText = 'font-size: 12px; color: #888; max-width: 360px; text-align: center; line-height: 1.6;'
    note.textContent = '3 名 AI 对手 · 1 圈定胜负 · 抢先冲线 = P1'

    const best = storage.getBestLap()
    const bestEl = document.createElement('div')
    bestEl.style.cssText = 'font-size: 13px; color: #888; min-height: 18px;'
    bestEl.textContent = best ? `个人最佳: ${formatLapTime(best)}` : '首次挑战 · 倾斜手机过弯'

    host.appendChild(title)
    host.appendChild(sub)
    host.appendChild(diffLabel)
    host.appendChild(diffRow)
    host.appendChild(btn)
    host.appendChild(note)
    host.appendChild(bestEl)
    document.body.appendChild(host)
  }

  const hide = (): void => {
    if (host && host.parentElement) host.parentElement.removeChild(host)
    host = null
  }

  return { show, hide }
}
