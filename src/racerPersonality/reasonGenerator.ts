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

/** Per-archetype rich F1TI-flavoured reason cards (4 lines each), drawn
 *  directly from the lore in `结果文案/<code>-*.md`. When an archetype has
 *  an entry here, we skip the generic stat-based bullet generator and use
 *  this exclusively — the card reads as character analysis, not a stat
 *  dump. Add a new code here when its portrait + lore are ready. */
const F1TI_REASONS: Record<string, string[]> = {
  HMLT: [
    '所有人劝你坐下歇歇,你说"我再推一圈",然后又推了一圈,比年轻人还快。',
    '比赛说到极限,你换个姿势继续推。下一圈永远是你最快的那一圈。',
    '你的核心驱动力是三个字 —— "还没完",温和拒绝任何"应该到此为止"的判断。',
    '老汉推车,推到终点。轮胎永远"已经没了",但车永远在前进。',
  ],
  ANTO: [
    '所有人都在说"这件事很难"的时候,你脸上写的是困惑 —— 你真没听懂"难"是什么意思。',
    '前辈花十五年悟到的东西,你第一天用野路子就做到了,完事发现奖杯上的香槟自己还不够年龄喝。',
    '你赢了当场哭,输了也当场哭,被夸两句脸就红 —— 不是假谦虚,是真红。',
    '在一个全员戴面具的世界里,你是最后一个还没学会假装的人。',
  ],
  VSTP: [
    '你只认一个道理:快就是对的,慢就是错的,废话比慢还错。',
    '别人搞人际关系的时候你在精进业务,别人下班的时候你换台设备继续精进业务。',
    '通讯录短得像俳句,衣柜里永远同款同色,但论干活,在场所有人加一起是你的背景板。',
    '你不藏想法 —— 说完顺手把活干了,然后消失。',
  ],
}

/**
 * Build the 3–4 reason bullets for the result card.
 *
 * If the matched archetype has F1TI lore-based reasons, we use those
 * verbatim — the card then reads as character analysis instead of stat
 * commentary. Otherwise we fall back to the older generic pipeline:
 * top player stats + one archetype flavour line.
 */
export function generateReasons(player: PlayerStats, profile: DriverProfile): string[] {
  const lore = F1TI_REASONS[profile.typeCode]
  if (lore && lore.length > 0) return lore.slice(0, 4)

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
