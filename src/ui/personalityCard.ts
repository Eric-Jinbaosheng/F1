/**
 * Pure-HTML "Racer Personality" result card. Recreates the look of the
 * MBTI-style template (white card / red double border / wave dividers /
 * lined reasons box) without depending on any image asset.
 *
 * The big headline is the matched F1 driver's name (e.g.
 * "CHARLES LECLERC"); the type name sits beneath as a subtitle.
 */

import { generateRacerPersonalityResult } from '../racerPersonality'
import type { PlayerStats } from '../racerPersonality'
// Anime portraits inlined as data URLs by Vite (assetsInlineLimit=100MB)
// so the bundle is fully self-contained — no extra files to ship in the
// ZIP and no relative path lookups.
import hamiltonPhoto from '../assets/drivers/hamilton.webp?url'
import antoPhoto from '../assets/drivers/anto.webp?url'
import verstapanPhoto from '../assets/drivers/verstapan.webp?url'

export interface PersonalityCardController {
  /** Render the card. Resolves once the user dismisses it. */
  show: (stats: Partial<PlayerStats>) => Promise<void>
  hide: () => void
}

const CARD_RED = '#b71c1c'
const CARD_RED_SOFT = 'rgba(183,28,28,0.18)'
const CARD_INK = '#3a1a1a'
const CARD_INK_SOFT = '#7a4040'

/** Anime portrait per F1TI typeCode. Add an entry here when a new
 *  portrait ships — no other code change needed. Values are data: URLs
 *  produced by Vite's `?url` import (see top of file). */
const PHOTO_BY_TYPECODE: Record<string, string> = {
  HMLT: hamiltonPhoto,
  ANTO: antoPhoto,
  VSTP: verstapanPhoto,
}

export function createPersonalityCard(): PersonalityCardController {
  let host: HTMLDivElement | null = null
  let resolveFn: (() => void) | null = null

  const hide = (): void => {
    if (host && host.parentElement) host.parentElement.removeChild(host)
    host = null
    if (resolveFn) {
      const r = resolveFn
      resolveFn = null
      r()
    }
  }

  const show = (stats: Partial<PlayerStats>): Promise<void> => {
    hide()
    const data = generateRacerPersonalityResult(stats)
    const personality = data['你的赛车人格']
    const reasons = data['为何你是这个类型']
    const tags = data['核心标签']

    return new Promise<void>((resolve) => {
      resolveFn = resolve

      host = document.createElement('div')
      host.style.cssText = `
        position: fixed; inset: 0; z-index: 110;
        display: flex; align-items: center; justify-content: center;
        background: rgba(8,12,22,0.94);
        padding: 16px;
        font-family: -apple-system, "PingFang SC", BlinkMacSystemFont, "Helvetica Neue", sans-serif;
      `

      // --- Outer card: white, double red border via outer ring + inner ring.
      const card = document.createElement('div')
      card.style.cssText = `
        position: relative;
        width: min(420px, 92vw);
        aspect-ratio: 1086 / 1449;
        max-height: 92vh;
        background: #fff;
        border: 4px solid ${CARD_RED};
        border-radius: 4px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.5);
        overflow: hidden;
      `

      // Inner ring — slightly inset second border.
      const innerRing = document.createElement('div')
      innerRing.style.cssText = `
        position: absolute;
        inset: 8px;
        border: 1.5px solid ${CARD_RED};
        border-radius: 2px;
        pointer-events: none;
      `

      // Stack everything inside a padded column.
      const col = document.createElement('div')
      col.style.cssText = `
        position: absolute; inset: 18px;
        display: flex; flex-direction: column;
        align-items: stretch;
        gap: 10px;
      `

      // --- Driver photo slot (top half of the card). Empty by default;
      // drop a matching file at drivers/<slug>.<ext> and it appears here.
      const photoBox = document.createElement('div')
      photoBox.style.cssText = `
        flex: 1 1 0; min-height: 0;
        display: flex; align-items: center; justify-content: center;
        margin: 4px 6px 0;
        overflow: hidden;
      `
      const photo = document.createElement('img')
      photo.alt = ''
      photo.style.cssText = `
        max-width: 100%; max-height: 100%;
        object-fit: contain;
        display: block;
      `
      // Look up the inlined portrait. Missing → hide the slot.
      const typeCode = personality['类型代码'] as string | undefined
      const photoUrl = typeCode ? PHOTO_BY_TYPECODE[typeCode] : null
      if (photoUrl) {
        photo.src = photoUrl
      } else {
        photo.style.display = 'none'
      }
      photo.addEventListener('error', () => {
        photo.style.display = 'none'
      })
      photoBox.appendChild(photo)

      // --- "你的赛车人格" header (with red wave dividers on either side).
      const makeWaveHeader = (text: string): HTMLDivElement => {
        const row = document.createElement('div')
        row.style.cssText = `
          display: flex; align-items: center; gap: 10px;
          margin: 4px 0;
        `
        const lineL = document.createElement('div')
        const lineR = document.createElement('div')
        const lineCss = `
          flex: 1 1 0; height: 0; border-top: 1.5px solid ${CARD_RED};
          position: relative;
        `
        lineL.style.cssText = lineCss
        lineR.style.cssText = lineCss
        // Tiny diamond decorations on the inside ends of the lines.
        for (const el of [lineL, lineR]) {
          const dot = document.createElement('span')
          dot.style.cssText = `
            position: absolute; top: -4px; width: 6px; height: 6px;
            background: ${CARD_RED}; transform: rotate(45deg);
            ${el === lineL ? 'right: 0;' : 'left: 0;'}
          `
          el.appendChild(dot)
        }
        const t = document.createElement('div')
        t.textContent = text
        t.style.cssText = `
          font-size: clamp(13px, 2vh, 16px);
          font-weight: 700;
          color: ${CARD_RED};
          letter-spacing: 6px;
          padding: 0 4px;
        `
        row.appendChild(lineL)
        row.appendChild(t)
        row.appendChild(lineR)
        return row
      }

      const personalityHeader = makeWaveHeader('你 的 赛 车 人 格')

      // --- Driver name in the bracketed white box.
      const nameBox = document.createElement('div')
      nameBox.style.cssText = `
        position: relative;
        display: flex; align-items: center; justify-content: center;
        padding: 8px 26px;
        margin: 0 4px;
      `
      const bracketL = document.createElement('span')
      const bracketR = document.createElement('span')
      const bracketCss = `
        position: absolute; top: 50%; transform: translateY(-50%);
        width: 14px; height: 100%;
        border: 2px solid ${CARD_RED};
      `
      bracketL.style.cssText = bracketCss + 'left: 0; border-right: none;'
      bracketR.style.cssText = bracketCss + 'right: 0; border-left: none;'
      const driverName = document.createElement('div')
      driverName.textContent = personality['匹配车手'].toUpperCase()
      driverName.style.cssText = `
        font-size: clamp(18px, 3.2vh, 26px);
        font-weight: 900;
        color: ${CARD_RED};
        letter-spacing: 3px;
        white-space: nowrap;
      `
      nameBox.appendChild(bracketL)
      nameBox.appendChild(driverName)
      nameBox.appendChild(bracketR)

      // --- Subtitle line: type name + match score.
      const subtitle = document.createElement('div')
      subtitle.textContent = `${personality['类型名称']}　·　匹配度 ${personality['匹配度']}%`
      subtitle.style.cssText = `
        text-align: center;
        font-size: 11px;
        color: ${CARD_INK_SOFT};
        letter-spacing: 3px;
      `

      // --- "RACER PERSONALITY CARD" tagline.
      const cardTag = document.createElement('div')
      cardTag.textContent = '— RACER  PERSONALITY  CARD —'
      cardTag.style.cssText = `
        text-align: center;
        font-size: 9px;
        color: ${CARD_RED};
        letter-spacing: 4px;
        margin: 2px 0 6px;
      `

      // --- "为何你是这个类型" header.
      const reasonHeader = makeWaveHeader('为 何 你 是 这 个 类 型')

      // --- Reasons box (lined area).
      const reasonBox = document.createElement('div')
      reasonBox.style.cssText = `
        position: relative;
        display: flex; flex-direction: column;
        gap: 4px;
        padding: 6px 4px 8px;
        margin: 0 2px;
        font-size: clamp(10px, 1.6vh, 12.5px);
        line-height: 1.5;
        color: ${CARD_INK};
      `
      for (const r of reasons) {
        const line = document.createElement('div')
        line.textContent = '· ' + r
        line.style.cssText = `
          padding: 2px 4px 4px;
          border-bottom: 1px dashed ${CARD_RED_SOFT};
        `
        reasonBox.appendChild(line)
      }

      // --- Tags strip (bottom).
      const tagStrip = document.createElement('div')
      tagStrip.textContent = tags.map((t) => `# ${t}`).join('   ')
      tagStrip.style.cssText = `
        text-align: center;
        font-size: 10px;
        color: ${CARD_RED};
        letter-spacing: 2px;
        margin-top: 4px;
      `

      // --- Laurel wreaths (decorative footer).
      const wreath = document.createElement('div')
      wreath.textContent = '🌿　　　🌿'
      wreath.style.cssText = `
        text-align: center; font-size: 14px;
        color: ${CARD_RED};
        margin-top: 2px;
      `

      col.appendChild(photoBox)
      col.appendChild(personalityHeader)
      col.appendChild(nameBox)
      col.appendChild(subtitle)
      col.appendChild(cardTag)
      col.appendChild(reasonHeader)
      col.appendChild(reasonBox)
      col.appendChild(tagStrip)
      col.appendChild(wreath)

      card.appendChild(innerRing)
      card.appendChild(col)

      // --- Continue button below the card.
      const actions = document.createElement('div')
      actions.style.cssText = `
        position: absolute; bottom: 22px; left: 50%;
        transform: translateX(-50%);
      `
      const closeBtn = document.createElement('button')
      closeBtn.textContent = '继 续'
      closeBtn.style.cssText = `
        min-width: 140px; min-height: 50px;
        background: #ff1801; color: #fff; border: none; border-radius: 8px;
        font-size: 16px; font-weight: 800; letter-spacing: 4px; cursor: pointer;
      `
      closeBtn.addEventListener('click', hide, { once: true })
      actions.appendChild(closeBtn)

      host.appendChild(card)
      host.appendChild(actions)
      document.body.appendChild(host)
    })
  }

  return { show, hide }
}
