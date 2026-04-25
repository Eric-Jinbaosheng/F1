/**
 * Reason synthesiser. Picks the player's standout stats and folds in one
 * archetype-specific flavour line so "为何你是这个类型" feels MBTI-ish,
 * not like a stat dump.
 */

import { topStats } from './scoring'
import type { DriverProfile, PlayerStats, StatKey } from './driverProfiles'

const STAT_REASONS: Record<StatKey, string> = {
  pace: '你在整体速度上表现突出,能快速建立比赛节奏。',
  consistency: '你的圈速波动较小,说明你能持续稳定地输出表现。',
  clean: '你的比赛过程非常干净,失误和碰撞控制得很好。',
  cornering: '你在弯道中展现出鲜明的节奏感,能够维持较高通过速度。',
  braking: '你的刹车点判断果断,能在关键区域创造进攻机会。',
  racingLine: '你的走线清晰,能够用更合理的线路维持速度。',
  attack: '你更倾向主动进攻,而不是保守跟车。',
  defense: '你在被追击时能守住关键位置,防守风格非常强硬。',
  risk: '你的驾驶风格更偏激进,喜欢在极限边缘寻找机会。',
  comeback: '你有很强的逆袭能力,能够在落后局面中持续追回位置。',
  pressure: '你在压力环境下依然能保持判断和竞争力。',
  management: '你很擅长管理比赛节奏和资源,不会过早消耗全部优势。',
}

/** One archetype-flavour line, hand-written to match the requested vibe. */
const DRIVER_FLAVOR: Record<string, string> = {
  'FAST-BORN':   '你具备同龄人少有的爆发力,在高压时刻能瞬间释放天赋。',
  'CLEAN-CTRL':  '你的比赛像一台精密仪器,几乎不留下任何低级失误。',
  'ALL-ROUND':   '你没有明显短板,攻、守、抗压都能维持相同水平。',
  'PURE-PACE':   '你能在单圈里榨干极限,把弯道当成自己的舞台。',
  'COMEBACK':    '你越往后越快,落后从来不是结束,而是逆袭的起点。',
  'OPPORTUNE':   '你很会等机会,对手一个犹豫就足够让你完成上位。',
  'HARD-ATTACK': '你不喜欢拖拉,刹车点比别人更晚,动作比别人更硬。',
  'WILD-ROOKIE': '你的弯道动作充满侵略性,像一颗正在燃烧的新星。',
  'STRATEGIST':  '你不靠鲁莽取胜,而是用节奏和资源管理,把对手耗到犯错。',
  'WILD-BREAK':  '你敢做别人不敢做的动作,经常打出看起来不可能的突破。',
  'RELIABLE':    '你的目标不是炫技,而是把车完整带回终点,不丢分。',
  'RAW-TALENT':  '你能在某些瞬间打出顶级水平,只是还没把整场串起来。',
  'TIME-TRIAL':  '你开车像在跑计时赛,把每一圈都打磨得几乎没有杂质。',
  'HARD-DEFEND': '你的防守极其顽固,内线卡位让追击者无从下手。',
}

/**
 * Build 3–4 Chinese reason bullets:
 *   - up to 3 lines from the player's top stats (must clear THRESHOLD)
 *   - 1 archetype flavour line, always last so the card feels personal
 */
export function generateReasons(player: PlayerStats, profile: DriverProfile): string[] {
  const THRESHOLD = 60 // a stat must clear this to be "your strength"
  const top = topStats(player, 4).filter((k) => player[k] >= THRESHOLD)

  const reasons: string[] = []
  const used = new Set<string>()

  for (const k of top) {
    const line = STAT_REASONS[k]
    if (line && !used.has(line)) {
      reasons.push(line)
      used.add(line)
    }
    if (reasons.length >= 3) break
  }

  // If the player's profile is mediocre (everything below threshold) we
  // still need something; fall back to the top two stats unconditionally.
  if (reasons.length === 0) {
    for (const k of topStats(player, 2)) reasons.push(STAT_REASONS[k])
  }

  const flavour = DRIVER_FLAVOR[profile.typeCode]
  if (flavour && !used.has(flavour)) reasons.push(flavour)

  // Cap at 4 — card layout has limited room.
  return reasons.slice(0, 4)
}
