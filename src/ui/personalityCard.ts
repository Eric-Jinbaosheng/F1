/**
 * Pure-HTML "Racer Personality" result card.
 *
 * Layout adapts at render time:
 *   - Portrait viewport → vertical card (photo on top, text below)
 *   - Landscape viewport → horizontal card (photo on the left, text panel
 *     on the right). The personality block (driver name + type name +
 *     match score) is the visual focal point and takes ≥ 50 % of the
 *     card area, with body text sized for thumb-distance readability on
 *     a phone in race posture.
 */

import { generateRacerPersonalityResult } from '../racerPersonality'
import type { PlayerStats } from '../racerPersonality'
// Anime portraits inlined as data URLs by Vite (assetsInlineLimit=100MB)
// so the bundle is fully self-contained — no extra files to ship in the
// ZIP and no relative path lookups.
import hamiltonPhoto from '../assets/drivers/hamilton.webp?url'
import antoPhoto from '../assets/drivers/anto.webp?url'
import verstapanPhoto from '../assets/drivers/verstapan.webp?url'

/** Concrete telemetry captured during the race, used to generate the
 *  "为何你是这个类型" reasons grounded in actual performance. */
export interface RaceTelemetry {
  bestLapMs: number
  topSpeedKmh: number
  wallHits: number
  carHits: number
  finalPosition: number
  fieldSize: number
}

export interface PersonalityCardController {
  /** Render the card. Resolves once the user dismisses it. */
  show: (stats: Partial<PlayerStats>, telemetry?: RaceTelemetry) => Promise<void>
  hide: () => void
}

const formatLap = (ms: number): string => {
  if (!ms || ms <= 0) return '—'
  const total = Math.floor(ms)
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const cs = Math.floor((total % 1000))
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(3, '0')}`
}

/** Build 4 reason bullets straight from race telemetry. The matched
 *  archetype's flavour line is appended as the last bullet so the card
 *  still reads as character-led, not a stat dump. */
const buildTelemetryReasons = (
  t: RaceTelemetry,
  archetypeFlavour: string | undefined,
): string[] => {
  const out: string[] = []
  // 1) Lap time — always show, gives the player a number to brag about.
  if (t.bestLapMs > 0) {
    out.push(`你的单圈用时 ${formatLap(t.bestLapMs)},是这场比赛你节奏感的真实写照。`)
  }
  // 2) Top speed.
  if (t.topSpeedKmh > 0) {
    const speed = Math.round(t.topSpeedKmh)
    if (speed >= 290) {
      out.push(`最高时速 ${speed} km/h —— 你确实敢把油门踩到底。`)
    } else if (speed >= 240) {
      out.push(`最高时速 ${speed} km/h,直道上你愿意搏一把。`)
    } else {
      out.push(`最高时速 ${speed} km/h,你更倾向于稳住而不是堆速。`)
    }
  }
  // 3) Collisions — wall + car contacts. Phrase by severity.
  const totalHits = t.wallHits + t.carHits
  if (totalHits === 0) {
    out.push('全场零接触零撞墙,走线干净到像在跑计时赛。')
  } else if (t.carHits === 0) {
    out.push(`撞墙 ${t.wallHits} 次但全程没碰对手 —— 极限是你跟自己较劲的事。`)
  } else if (t.wallHits === 0) {
    out.push(`与对手 ${t.carHits} 次接触,进攻意图非常明显,大部分弯都在缠斗。`)
  } else {
    out.push(`撞墙 ${t.wallHits} 次、与对手 ${t.carHits} 次接触 —— 你这场比赛主打一个"先冲再说"。`)
  }
  // 4) Final position — comeback / domination flavour, plus archetype line.
  const pos = t.finalPosition
  const N = t.fieldSize
  if (pos === 1) {
    out.push(`最终 P1/${N},把领跑变成了节奏控制。`)
  } else if (pos === N) {
    out.push(`最终 P${pos}/${N},压力下的成长比名次更值得记录。`)
  } else {
    out.push(`最终 P${pos}/${N},混战中找到了自己的位置。`)
  }
  // 5) Append the archetype flavour line if available — keeps the F1TI
  // character voice without burying the telemetry data.
  if (archetypeFlavour) out.push(archetypeFlavour)
  return out
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

const isLandscape = (): boolean => {
  try {
    return window.innerWidth >= window.innerHeight
  } catch {
    return false
  }
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

  const show = (
    stats: Partial<PlayerStats>,
    telemetry?: RaceTelemetry,
  ): Promise<void> => {
    hide()
    const data = generateRacerPersonalityResult(stats)
    const personality = data['你的赛车人格']
    const tags = data['核心标签']
    // Telemetry-grounded reasons replace the generic ones when a race
    // actually completed; the archetype flavour line still tags along
    // as the closing bullet so the card keeps its F1TI voice.
    const reasons = telemetry
      ? buildTelemetryReasons(telemetry, data['为何你是这个类型'].slice(-1)[0])
      : data['为何你是这个类型']
    const landscape = isLandscape()

    return new Promise<void>((resolve) => {
      resolveFn = resolve

      host = document.createElement('div')
      host.style.cssText = `
        position: fixed; inset: 0; z-index: 110;
        display: flex; align-items: center; justify-content: center;
        background: rgba(8,12,22,0.94);
        padding: 12px;
        font-family: -apple-system, "PingFang SC", BlinkMacSystemFont, "Helvetica Neue", sans-serif;
      `

      // --- Outer card frame.
      const card = document.createElement('div')
      const cardSize = landscape
        ? 'width: min(94vw, 940px); height: min(82vh, 540px);'
        : 'width: min(420px, 92vw); aspect-ratio: 1086 / 1449; max-height: 88vh;'
      card.style.cssText = `
        position: relative;
        ${cardSize}
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
        inset: 7px;
        border: 1.5px solid ${CARD_RED};
        border-radius: 2px;
        pointer-events: none;
      `

      // Outer column — flex direction depends on orientation.
      const col = document.createElement('div')
      col.style.cssText = `
        position: absolute; inset: 16px;
        display: flex;
        flex-direction: ${landscape ? 'row' : 'column'};
        align-items: stretch;
        gap: ${landscape ? '18px' : '8px'};
      `

      // --- Driver photo slot.
      const photoBox = document.createElement('div')
      photoBox.style.cssText = landscape
        ? `flex: 0 0 38%; min-height: 0;
           display: flex; align-items: center; justify-content: center;
           overflow: hidden;`
        : `flex: 0 0 36%; min-height: 0;
           display: flex; align-items: center; justify-content: center;
           overflow: hidden;`
      const photo = document.createElement('img')
      photo.alt = ''
      photo.style.cssText = `
        max-width: 100%; max-height: 100%;
        object-fit: contain;
        display: block;
      `
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

      // --- Right-hand text panel (or stacked-below in portrait).
      // Make the entire panel scrollable so the user can always reach
      // every bullet of "为何你是这个类型" + tag strip, regardless of
      // viewport height or how many telemetry reasons we generated. Doing
      // it on the panel (not inner reasonBox) sidesteps the nested-flex
      // gotcha where overflow on a flex child gets ignored unless every
      // ancestor has min-height: 0. iOS WebKit needs the touch flag.
      const panel = document.createElement('div')
      panel.style.cssText = `
        flex: 1 1 0; min-height: 0; min-width: 0;
        display: flex; flex-direction: column;
        gap: ${landscape ? '8px' : '6px'};
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        padding-right: 4px; /* leave room for the scrollbar */
      `

      // --- "你的赛车人格" wave header.
      const makeWaveHeader = (text: string, fontSizeCss: string): HTMLDivElement => {
        const row = document.createElement('div')
        row.style.cssText = `
          display: flex; align-items: center; gap: 10px;
          margin: 2px 0;
        `
        const lineL = document.createElement('div')
        const lineR = document.createElement('div')
        const lineCss = `
          flex: 1 1 0; height: 0; border-top: 1.5px solid ${CARD_RED};
          position: relative;
        `
        lineL.style.cssText = lineCss
        lineR.style.cssText = lineCss
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
          font-size: ${fontSizeCss};
          font-weight: 700;
          color: ${CARD_RED};
          letter-spacing: 5px;
          padding: 0 4px;
          white-space: nowrap;
        `
        row.appendChild(lineL)
        row.appendChild(t)
        row.appendChild(lineR)
        return row
      }

      const headerSize = landscape ? 'clamp(13px, 2.4vh, 17px)' : 'clamp(13px, 2vh, 16px)'
      const personalityHeader = makeWaveHeader('你 的 赛 车 人 格', headerSize)

      // --- Driver-name block — the FOCAL POINT of the card.
      // We give it a tall padding so the bracket frame reads big, and
      // the font scales aggressively with the available height/width.
      const nameBox = document.createElement('div')
      nameBox.style.cssText = `
        position: relative;
        display: flex; align-items: center; justify-content: center;
        padding: ${landscape ? '20px 32px' : '14px 28px'};
        margin: 4px 6px 0;
      `
      const bracketL = document.createElement('span')
      const bracketR = document.createElement('span')
      const bracketCss = `
        position: absolute; top: 50%; transform: translateY(-50%);
        width: 18px; height: 100%;
        border: 3px solid ${CARD_RED};
      `
      bracketL.style.cssText = bracketCss + 'left: 0; border-right: none;'
      bracketR.style.cssText = bracketCss + 'right: 0; border-left: none;'
      const driverName = document.createElement('div')
      driverName.textContent = personality['匹配车手'].toUpperCase()
      // ~ 50 % of the card height in landscape thanks to clamp upper bound.
      driverName.style.cssText = `
        font-size: ${landscape ? 'clamp(28px, 7vh, 56px)' : 'clamp(28px, 5.5vh, 44px)'};
        font-weight: 900;
        color: ${CARD_RED};
        letter-spacing: ${landscape ? '4px' : '2px'};
        white-space: nowrap;
        text-align: center;
        line-height: 1.05;
      `
      nameBox.appendChild(bracketL)
      nameBox.appendChild(driverName)
      nameBox.appendChild(bracketR)

      // --- Type name — sits right under the giant driver name and reads
      // as a SECONDARY headline (much bigger than before).
      const typeLine = document.createElement('div')
      typeLine.textContent = personality['类型名称']
      typeLine.style.cssText = `
        text-align: center;
        font-size: ${landscape ? 'clamp(16px, 2.8vh, 22px)' : 'clamp(15px, 2.4vh, 19px)'};
        font-weight: 700;
        color: ${CARD_INK};
        letter-spacing: 4px;
        margin-top: 4px;
      `

      // --- Stat strip: lap time + top speed + match score. Big enough
      // to read at arm's length, prominent for the player's brag rights.
      const statStrip = document.createElement('div')
      statStrip.style.cssText = `
        display: flex; justify-content: center; align-items: stretch;
        gap: ${landscape ? '20px' : '14px'};
        margin: ${landscape ? '6px 8px' : '4px 6px'};
        padding: ${landscape ? '6px 0' : '4px 0'};
        border-top: 1px solid ${CARD_RED_SOFT};
        border-bottom: 1px solid ${CARD_RED_SOFT};
      `
      const makeStat = (label: string, value: string): HTMLDivElement => {
        const cell = document.createElement('div')
        cell.style.cssText = `
          flex: 1 1 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 2px;
        `
        const v = document.createElement('div')
        v.textContent = value
        v.style.cssText = `
          font-size: ${landscape ? 'clamp(15px, 2.6vh, 20px)' : 'clamp(14px, 2.2vh, 17px)'};
          font-weight: 800;
          color: ${CARD_RED};
          letter-spacing: 1px;
          line-height: 1;
        `
        const l = document.createElement('div')
        l.textContent = label
        l.style.cssText = `
          font-size: ${landscape ? 'clamp(9px, 1.3vh, 11px)' : 'clamp(8px, 1.2vh, 10px)'};
          color: ${CARD_INK_SOFT};
          letter-spacing: 2px;
        `
        cell.appendChild(v)
        cell.appendChild(l)
        return cell
      }
      const lapStr = telemetry ? formatLap(telemetry.bestLapMs) : '—'
      const speedStr = telemetry && telemetry.topSpeedKmh > 0
        ? `${Math.round(telemetry.topSpeedKmh)} km/h`
        : '—'
      statStrip.appendChild(makeStat('单圈用时', lapStr))
      statStrip.appendChild(makeStat('最高时速', speedStr))
      statStrip.appendChild(makeStat('匹配度', `${personality['匹配度']}%`))

      // --- "为何你是这个类型" header.
      const reasonHeader = makeWaveHeader('为 何 你 是 这 个 类 型', headerSize)

      // --- Reasons box. The OUTER panel is the scroll container; this
      // div just lays out the bullets at their natural height.
      const reasonBox = document.createElement('div')
      reasonBox.style.cssText = `
        display: flex; flex-direction: column;
        gap: 3px;
        padding: 4px 4px 6px;
        margin: 0 2px;
        font-size: ${landscape ? 'clamp(11px, 1.85vh, 14px)' : 'clamp(11px, 1.7vh, 13px)'};
        line-height: 1.55;
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

      // --- Tags strip (bottom). NO emoji wreath any more.
      const tagStrip = document.createElement('div')
      tagStrip.textContent = tags.map((t) => `# ${t}`).join('   ')
      tagStrip.style.cssText = `
        text-align: center;
        font-size: ${landscape ? 'clamp(11px, 1.7vh, 13px)' : 'clamp(10px, 1.5vh, 12px)'};
        color: ${CARD_RED};
        letter-spacing: 2px;
        margin-top: ${landscape ? '6px' : '4px'};
      `

      // --- Assemble the panel.
      panel.appendChild(personalityHeader)
      panel.appendChild(nameBox)
      panel.appendChild(typeLine)
      panel.appendChild(statStrip)
      panel.appendChild(reasonHeader)
      panel.appendChild(reasonBox)
      panel.appendChild(tagStrip)

      col.appendChild(photoBox)
      col.appendChild(panel)

      card.appendChild(innerRing)
      card.appendChild(col)

      // --- Continue button.
      const actions = document.createElement('div')
      actions.style.cssText = `
        position: absolute; bottom: ${landscape ? '12px' : '20px'}; left: 50%;
        transform: translateX(-50%);
        z-index: 2;
      `
      const closeBtn = document.createElement('button')
      closeBtn.textContent = '继 续'
      closeBtn.style.cssText = `
        min-width: 130px; min-height: 44px;
        background: #ff1801; color: #fff; border: none; border-radius: 8px;
        font-size: 15px; font-weight: 800; letter-spacing: 4px; cursor: pointer;
      `
      closeBtn.addEventListener('click', hide, { once: true })
      actions.appendChild(closeBtn)

      host.appendChild(card)
      host.appendChild(actions)
      document.body.appendChild(host)

      // After layout: shrink the driver name until it fits inside the
      // bracketed box. Long names ("ANDREA KIMI ANTONELLI", "GUENTHER
      // STEINER") would otherwise overflow the brackets at the
      // landscape font ceiling. We start at the CSS-clamped size and
      // step down 1 px at a time until either it fits or we hit a
      // floor. requestAnimationFrame so we measure post-layout.
      requestAnimationFrame(() => {
        const minSize = 18
        // The brackets are absolutely positioned at left/right of
        // nameBox and are 18 px wide each, so subtract a generous
        // margin so glyphs don't touch the bracket strokes.
        const horizontalReserve = 56
        const limit = Math.max(0, nameBox.clientWidth - horizontalReserve)
        let size = parseFloat(getComputedStyle(driverName).fontSize) || 32
        while (driverName.scrollWidth > limit && size > minSize) {
          size -= 1
          driverName.style.fontSize = `${size}px`
        }
        // If we hit the floor and the text STILL overflows
        // (e.g. "ANDREA KIMI ANTONELLI" in a narrow viewport), allow
        // wrapping to two lines and tighten the letter-spacing.
        if (driverName.scrollWidth > limit) {
          driverName.style.whiteSpace = 'normal'
          driverName.style.letterSpacing = '1px'
          driverName.style.lineHeight = '1.05'
        }
      })
    })
  }

  return { show, hide }
}
