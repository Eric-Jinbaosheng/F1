import { storage } from '../utils/storage'
import { formatLapTime } from '../utils/math'
import type { Difficulty } from '../game/opponents'
import type { InputMode } from '../input'

export interface MenuStartConfig {
  difficulty: Difficulty
  inputMode: InputMode
  /** Whether AI race-commentary clips should play during the race. */
  commentaryEnabled: boolean
}

export interface MenuController {
  show: (onStart: (cfg: MenuStartConfig) => void) => void
  hide: () => void
}

const DIFF_LABELS: Record<Difficulty, { label: string; tag: string }> = {
  easy: { label: '简 单', tag: '新手友好' },
  medium: { label: '中 等', tag: '势均力敌' },
  hard: { label: '困 难', tag: '强劲对手' },
}

const INPUT_LABELS: Record<InputMode, { label: string; tag: string }> = {
  keyboard: { label: '键 盘', tag: 'WASD/方向键' },
  touch: { label: '触 屏', tag: '左右半屏' },
  gyro: { label: '体 感', tag: '倾斜手机' },
}

type Commentary = 'on' | 'off'
const COMMENTARY_LABELS: Record<Commentary, { label: string; tag: string }> = {
  on: { label: '开 启', tag: 'AI 解说员' },
  off: { label: '关 闭', tag: '安静比赛' },
}

const isCoarsePointer = (): boolean => {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

export function createMenu(): MenuController {
  let host: HTMLDivElement | null = null

  const show = (onStart: (cfg: MenuStartConfig) => void): void => {
    hide()
    host = document.createElement('div')
    host.style.cssText = `
      position: fixed; inset: 0; z-index: 100;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: linear-gradient(180deg, rgba(10,14,26,0.85), rgba(10,14,26,0.95));
      color: #fff; gap: 16px; padding: 24px;
      overflow-y: auto;
    `
    const title = document.createElement('div')
    title.textContent = 'F1 体感飙速'
    title.style.cssText = 'font-size: 44px; font-weight: 900; letter-spacing: 4px;'

    const sub = document.createElement('div')
    sub.textContent = 'FEEL THE F1'
    sub.style.cssText = 'font-size: 18px; color: #ff1801; letter-spacing: 6px; font-weight: 700;'

    const makeRow = (
      caption: string,
      keys: string[],
      labels: Record<string, { label: string; tag: string }>,
      initial: string,
      onChange: (key: string) => void,
    ): HTMLDivElement => {
      const wrap = document.createElement('div')
      wrap.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 8px;'
      const cap = document.createElement('div')
      cap.textContent = caption
      cap.style.cssText = 'font-size: 13px; color: #aaa; letter-spacing: 4px;'
      const row = document.createElement('div')
      row.style.cssText = 'display: flex; gap: 10px;'
      let selected = initial
      const buttons: Record<string, HTMLButtonElement> = {}
      const paint = (): void => {
        for (const k of keys) {
          const b = buttons[k]
          const active = k === selected
          b.style.background = active ? '#ff1801' : 'transparent'
          b.style.color = active ? '#fff' : '#ddd'
          b.style.borderColor = active ? '#ff1801' : '#666'
        }
      }
      for (const k of keys) {
        const b = document.createElement('button')
        b.style.cssText = `
          min-width: 100px; min-height: 52px;
          background: transparent; color: #ddd; border: 2px solid #666; border-radius: 8px;
          font-size: 15px; font-weight: 700; letter-spacing: 2px; cursor: pointer;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 4px 10px;
        `
        const lab = document.createElement('div')
        lab.textContent = labels[k].label
        lab.style.cssText = 'font-size: 16px; font-weight: 800;'
        const tag = document.createElement('div')
        tag.textContent = labels[k].tag
        tag.style.cssText = 'font-size: 10px; opacity: 0.8; margin-top: 2px;'
        b.appendChild(lab)
        b.appendChild(tag)
        b.addEventListener('click', () => {
          selected = k
          paint()
          onChange(k)
        })
        buttons[k] = b
        row.appendChild(b)
      }
      paint()
      wrap.appendChild(cap)
      wrap.appendChild(row)
      return wrap
    }

    let chosenDiff: Difficulty = 'medium'
    let chosenInput: InputMode = isCoarsePointer() ? 'touch' : 'keyboard'
    let chosenCommentary: Commentary = 'on'

    const diffRow = makeRow(
      '难  度',
      ['easy', 'medium', 'hard'],
      DIFF_LABELS as Record<string, { label: string; tag: string }>,
      chosenDiff,
      (k) => { chosenDiff = k as Difficulty },
    )

    const inputRow = makeRow(
      '操 作 方 式',
      ['keyboard', 'touch', 'gyro'],
      INPUT_LABELS as Record<string, { label: string; tag: string }>,
      chosenInput,
      (k) => { chosenInput = k as InputMode },
    )

    const commentaryRow = makeRow(
      '解  说',
      ['on', 'off'],
      COMMENTARY_LABELS as Record<string, { label: string; tag: string }>,
      chosenCommentary,
      (k) => { chosenCommentary = k as Commentary },
    )

    const btn = document.createElement('button')
    btn.textContent = '开 始 比 赛'
    btn.style.cssText = `
      min-width: 220px; min-height: 70px; margin-top: 8px;
      background: #fff; color: #ff1801;
      border: none; border-radius: 8px;
      font-size: 22px; font-weight: 900; letter-spacing: 4px;
      cursor: pointer;
    `
    btn.addEventListener('click', () => {
      onStart({
        difficulty: chosenDiff,
        inputMode: chosenInput,
        commentaryEnabled: chosenCommentary === 'on',
      })
    }, { once: true })

    const note = document.createElement('div')
    note.style.cssText = 'font-size: 12px; color: #888; max-width: 360px; text-align: center; line-height: 1.6;'
    note.textContent = '体感:左右倾 = 转向 · 前后倾 = 油门/刹车 · 1 圈定胜负'

    const best = storage.getBestLap()
    const bestEl = document.createElement('div')
    bestEl.style.cssText = 'font-size: 13px; color: #888; min-height: 18px;'
    bestEl.textContent = best ? `个人最佳: ${formatLapTime(best)}` : '首次挑战'

    host.appendChild(title)
    host.appendChild(sub)
    host.appendChild(diffRow)
    host.appendChild(inputRow)
    host.appendChild(commentaryRow)
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
