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

/** One archetype-flavour line, hand-written to match the F1TI card vibe. */
const DRIVER_FLAVOR: Record<string, string> = {
  ALON: '你像一个三天没睡的全能老兵,任何赛况都能榨出最后一丝表现。',
  ANTO: '你的速度像没经过提醒,直接冒出来,本人比观众还吃惊。',
  BOTT: '你不抢戏,但每次车队需要稳定输出,坐你车上的人都心安。',
  GASL: '你越被压低,反弹得越离谱,谷底是你最舒服的赛道。',
  HMLT: '你的稳和狠是叠在一起的,看似温柔,关键弯一刀准杀。',
  KIMI: '你不预热、不社交、不啰嗦,直接打开车门,把成绩交出来。',
  LNDO: '你不喜欢等,刹车点说晚就晚,情绪也说有就有。',
  LOCK: '你能跟住前面所有人,只差最后那 0.1 秒撕开排名。',
  MASI: '你一上场,所有人都先看判官眼色,不知道这场会判出什么。',
  MILK: '你越喜欢谁,谁越容易翻车,自己稳得反而踩不出节奏。',
  PIAS: '你不靠情绪靠节奏,几圈下来对手发现自己已经被慢慢榨干。',
  RICO: '你笑着开车,刹车永远晚两米,送出最离谱的内线超车。',
  RUSS: '你把比赛当考试,每个弯都是 PPT 第几页。',
  STEI: '你的嗓门是车队第二动力,带着队伍冲刺撞墙都能整齐。',
  STRL: '你不出错就是赢,不冒险就是稳,不靠拼也能完赛。',
  TIFS: '你像一个永远等明年的人,被现实磨出了别人没有的韧性。',
  TOTO: '你的指令像耳机一样脆,但每个判断都对,强势又准确。',
  VETL: '你不再求最快,但你能用一句话把后辈讲明白。',
  VSTP: '你的车速是行业标尺,所有人都在追你的减速点。',
  ZHOU: '你不一定第一,但你给后面来的人留好了车道。',
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
