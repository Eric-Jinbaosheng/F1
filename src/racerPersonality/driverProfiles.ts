/**
 * 20 F1TI personality archetypes, mapped from the reference profiles in
 * `结果文案/*.md` (F1TI 8-dim grading: D1 表达直度 / D2 准备强度 /
 * D3 抗挫韧性 / D4 社交倾向 / D5 规则态度 / D6 情绪透明度 / D7 进取
 * 程度 / D8 自主程度) → our game's 12-dim driving-stat profile.
 *
 * The 8-dim grades are the source of truth; deriveProfile() is the
 * deterministic adapter that turns personality levels into the driving
 * stats the matcher already uses. Edit a `dims` cell here and the matcher
 * re-tunes — no other file needs to change.
 *
 * Three archetypes (GASL / MASI / MILK) are special-case in the original
 * F1TI deck (their 8-dim row is `null`) so they get hand-crafted profiles
 * rooted in the lore instead of the formula.
 */

export const STAT_KEYS = [
  'pace',
  'consistency',
  'clean',
  'cornering',
  'braking',
  'racingLine',
  'attack',
  'defense',
  'risk',
  'comeback',
  'pressure',
  'management',
] as const

export type StatKey = (typeof STAT_KEYS)[number]
export type PlayerStats = Record<StatKey, number>

export interface DriverProfile {
  typeCode: string
  typeName: string
  matchedDriver: string
  summary: string
  /** Poster slogan from the F1TI card (海报标语). Optional — used by the
   *  result UI when present. */
  tagline?: string
  profile: PlayerStats
}

// ---------------------------------------------------------------------------
// 8-dim → 12-dim adapter
// ---------------------------------------------------------------------------

type Lvl = 'L' | 'M' | 'H'
const lvl = (x: Lvl): number => (x === 'L' ? 0.3 : x === 'M' ? 0.6 : 0.9)

interface F1tiDims {
  D1: Lvl // 表达直度
  D2: Lvl // 准备强度
  D3: Lvl // 抗挫韧性
  D4: Lvl // 社交倾向
  D5: Lvl // 规则态度
  D6: Lvl // 情绪透明度
  D7: Lvl // 进取程度
  D8: Lvl // 自主程度
}

const clamp = (x: number): number => Math.max(25, Math.min(95, Math.round(x)))

function deriveProfile(d: F1tiDims): PlayerStats {
  const D = (k: keyof F1tiDims): number => lvl(d[k])
  // Each formula encodes a small piece of game-design intuition:
  //   pace          ← raw ambition (D7) — wants to push the car
  //   consistency   ← prep (D2) + composed (low D6) + autonomous (D8)
  //   clean         ← rule-abiding (D5) + prep (D2), penalised by ambition
  //   cornering     ← ambition (D7) + prep (D2)
  //   braking       ← prep (D2) + control over rules (D5) + decisiveness (D7)
  //   racingLine    ← studied lines (D2) + obeys racecraft (D5)
  //   attack        ← ambition (D7) + directness (D1) + social engagement (D4)
  //   defense       ← rules (D5) + autonomy (D8) + resilience (D3)
  //   risk          ← rule-bender (1-D5) + ambition (D7) + speak-up (D1)
  //   comeback      ← resilience (D3) + ambition (D7)
  //   pressure      ← prep (D2) + composed (low D6) + resilience (D3)
  //   management    ← prep (D2) + autonomy (D8) + rule-discipline (D5)
  return {
    pace: clamp(50 + 50 * D('D7')),
    consistency: clamp(35 + 30 * D('D2') + 25 * (1 - D('D6')) + 10 * D('D8')),
    clean: clamp(40 + 35 * D('D5') + 15 * D('D2') - 10 * D('D7')),
    cornering: clamp(50 + 25 * D('D7') + 25 * D('D2')),
    braking: clamp(50 + 25 * D('D2') + 20 * D('D5') + 10 * D('D7')),
    racingLine: clamp(45 + 30 * D('D2') + 25 * D('D5')),
    attack: clamp(30 + 35 * D('D7') + 25 * D('D1') + 15 * D('D4')),
    defense: clamp(30 + 25 * D('D5') + 25 * D('D8') + 20 * D('D3')),
    risk: clamp(30 + 35 * (1 - D('D5')) + 25 * D('D7') + 15 * D('D1')),
    comeback: clamp(30 + 50 * D('D3') + 20 * D('D7')),
    pressure: clamp(30 + 30 * D('D2') + 25 * (1 - D('D6')) + 25 * D('D3')),
    management: clamp(35 + 30 * D('D2') + 25 * D('D8') + 15 * D('D5')),
  }
}

// ---------------------------------------------------------------------------
// Archetype roster — 8-dim levels copied from `结果文案/*.md`.
// `dims === null` means the F1TI card itself is special-case (intentional
// blank row); we hand-craft a profile for those.
// ---------------------------------------------------------------------------

interface F1tiArchetype {
  typeCode: string
  typeName: string
  matchedDriver: string
  summary: string
  tagline: string
  dims: F1tiDims | null
  /** Required when dims is null. */
  customProfile?: PlayerStats
}

const F1TI_ARCHETYPES: F1tiArchetype[] = [
  {
    typeCode: 'ALON',
    typeName: '头哥',
    matchedDriver: 'Fernando Alonso',
    summary: '老兵全能模板:经验、抗压、韧性都拉满,新人花十年悟的东西你直觉就能做。',
    tagline: '44岁,还在呢。',
    dims: { D1: 'M', D2: 'H', D3: 'H', D4: 'M', D5: 'H', D6: 'M', D7: 'H', D8: 'H' },
  },
  {
    typeCode: 'ANTO',
    typeName: '小孩',
    matchedDriver: 'Andrea Kimi Antonelli',
    summary: '还没学会戴面具的天才新生,直觉先于经验,情绪写在脸上,赢了哭输了也哭。',
    tagline: '不好意思,我还不能喝香槟。',
    dims: { D1: 'M', D2: 'L', D3: 'M', D4: 'M', D5: 'M', D6: 'H', D7: 'H', D8: 'L' },
  },
  {
    typeCode: 'BOTT',
    typeName: '工具人',
    matchedDriver: 'Valtteri Bottas',
    summary: '完赛工具型副驾:抢戏不行,稳定输出在线,关键时刻让位毫不犹豫。',
    tagline: 'Valtteri,轮到你了。',
    dims: { D1: 'M', D2: 'M', D3: 'L', D4: 'M', D5: 'L', D6: 'L', D7: 'L', D8: 'L' },
  },
  {
    typeCode: 'GASL',
    typeName: '加大师',
    matchedDriver: 'Pierre Gasly',
    summary: '跌到谷底反而盖了座庙,越被低估反弹越狠,后半程是你的舞台。',
    tagline: '小庙怎么了,我照样成佛。',
    dims: null,
    // Comeback specialist; mid-pack on raw stats but elite on resilience.
    customProfile: {
      pace: 76, consistency: 78, clean: 78, cornering: 78, braking: 80,
      racingLine: 78, attack: 72, defense: 72, risk: 60, comeback: 95,
      pressure: 84, management: 78,
    },
  },
  {
    typeCode: 'HMLT',
    typeName: '老汉',
    matchedDriver: 'Lewis Hamilton',
    summary: '七冠王的全能模板,准备 + 抗压 + 经验三栏拉满,任何条件下都跑得动。',
    tagline: '轮胎没了,但我还在。',
    dims: { D1: 'M', D2: 'H', D3: 'H', D4: 'L', D5: 'M', D6: 'L', D7: 'H', D8: 'M' },
  },
  {
    typeCode: 'KIMI',
    typeName: '冰人',
    matchedDriver: 'Kimi Räikkönen',
    summary: '极简天赋派:不预热、不解释、不社交,凭原始速度直接交成绩。',
    tagline: '少管我。',
    dims: { D1: 'L', D2: 'L', D3: 'L', D4: 'L', D5: 'M', D6: 'L', D7: 'M', D8: 'H' },
  },
  {
    typeCode: 'LNDO',
    typeName: '急性子',
    matchedDriver: 'Lando Norris',
    summary: '直爽 + 情绪外放 + 攻击性十足的新生代,等不及变冷静就要赢。',
    tagline: '急什么急,我已经是冠军了。',
    dims: { D1: 'H', D2: 'M', D3: 'H', D4: 'M', D5: 'M', D6: 'H', D7: 'H', D8: 'M' },
  },
  {
    typeCode: 'LOCK',
    typeName: '老四',
    matchedDriver: 'Nico Hülkenberg',
    summary: '年年有戏年年差一点,跑得动但缺机会,中游战神挠破头不上头部。',
    tagline: '差一点,永远差那么一点。',
    dims: { D1: 'M', D2: 'M', D3: 'H', D4: 'M', D5: 'L', D6: 'H', D7: 'H', D8: 'L' },
  },
  {
    typeCode: 'MASI',
    typeName: '马戏',
    matchedDriver: 'Michael Masi',
    summary: '薛定谔的判罚:你不知道你犯没犯规,直到他打开那个信封。混乱即风格。',
    tagline: '这就是赛车。',
    dims: null,
    // Off-chart fallback profile — chaotic, unpredictable, no fixed strength.
    customProfile: {
      pace: 60, consistency: 35, clean: 30, cornering: 60, braking: 55,
      racingLine: 50, attack: 50, defense: 55, risk: 80, comeback: 50,
      pressure: 35, management: 30,
    },
  },
  {
    typeCode: 'MILK',
    typeName: '毒奶',
    matchedDriver: 'The Cursed Pundit',
    summary: '看好谁谁翻车的玄学气场,自己稳得不冒险,反而难踩出节奏。',
    tagline: '我觉得他能赢,完了。',
    dims: null,
    // Soft-but-jinxed; everything mediocre, low risk, low pace.
    customProfile: {
      pace: 50, consistency: 60, clean: 70, cornering: 55, braking: 60,
      racingLine: 60, attack: 45, defense: 55, risk: 35, comeback: 40,
      pressure: 50, management: 60,
    },
  },
  {
    typeCode: 'PIAS',
    typeName: '淡人',
    matchedDriver: 'Oscar Piastri',
    summary: '冷静自洽,不悲不喜,几圈下来用一致性慢慢咬住对手再一击致命。',
    tagline: '哦,行。',
    dims: { D1: 'L', D2: 'M', D3: 'M', D4: 'L', D5: 'M', D6: 'L', D7: 'H', D8: 'H' },
  },
  {
    typeCode: 'RICO',
    typeName: '大牙',
    matchedDriver: 'Daniel Ricciardo',
    summary: '笑着上车的进攻派,刹车点比谁都晚,赢不赢先看气氛。',
    tagline: '人生苦短,先笑为敬。',
    dims: { D1: 'H', D2: 'L', D3: 'L', D4: 'H', D5: 'L', D6: 'H', D7: 'L', D8: 'L' },
  },
  {
    typeCode: 'RUSS',
    typeName: '优等生',
    matchedDriver: 'George Russell',
    summary: '所有规则、所有数据、所有 PPT 都背好了,凭准备度压制天赋型。',
    tagline: '请看PPT第7页。',
    dims: { D1: 'M', D2: 'H', D3: 'M', D4: 'M', D5: 'L', D6: 'M', D7: 'H', D8: 'M' },
  },
  {
    typeCode: 'STEI',
    typeName: '教官',
    matchedDriver: 'Guenther Steiner',
    summary: '团队大嗓门 + 执行力满格,带着队伍即使撞墙也能撞出节奏。',
    tagline: '今天的英语课开始了。',
    dims: { D1: 'H', D2: 'L', D3: 'H', D4: 'H', D5: 'H', D6: 'H', D7: 'M', D8: 'H' },
  },
  {
    typeCode: 'STRL',
    typeName: '少爷',
    matchedDriver: 'Lance Stroll',
    summary: '不需要拼命也能上位,稳到底,不冒险也不出错。',
    tagline: '我爸说今天会下雨。',
    dims: { D1: 'L', D2: 'L', D3: 'L', D4: 'M', D5: 'H', D6: 'L', D7: 'L', D8: 'M' },
  },
  {
    typeCode: 'TIFS',
    typeName: '受苦人',
    matchedDriver: 'Tifosi',
    summary: '永远在等"明年",韧性是被现实磨出来的,不靠天赋靠死撑。',
    tagline: '明年,明年一定行。',
    dims: { D1: 'M', D2: 'L', D3: 'H', D4: 'H', D5: 'L', D6: 'H', D7: 'M', D8: 'L' },
  },
  {
    typeCode: 'TOTO',
    typeName: '马桶',
    matchedDriver: 'Toto Wolff',
    summary: '准备 + 表达 + 自主三爆,场外指挥的能量比场内车手还高。',
    tagline: '耳机是消耗品。',
    dims: { D1: 'H', D2: 'H', D3: 'H', D4: 'M', D5: 'H', D6: 'H', D7: 'H', D8: 'M' },
  },
  {
    typeCode: 'VETL',
    typeName: '歪头',
    matchedDriver: 'Sebastian Vettel',
    summary: '老冠军余韵,稳但不再抢,擅长用经验讲道理给后辈听。',
    tagline: '转了,但没关系。',
    dims: { D1: 'M', D2: 'M', D3: 'L', D4: 'M', D5: 'M', D6: 'M', D7: 'L', D8: 'M' },
  },
  {
    typeCode: 'VSTP',
    typeName: '汽车人',
    matchedDriver: 'Max Verstappen',
    summary: '顶级速度 + 顶级执行 + 顶级压制力,把"你太慢了"变成行业标准。',
    tagline: '你们太慢了。',
    dims: { D1: 'H', D2: 'M', D3: 'H', D4: 'L', D5: 'H', D6: 'L', D7: 'H', D8: 'H' },
  },
  {
    typeCode: 'ZHOU',
    typeName: '先行者',
    matchedDriver: 'Zhou Guanyu',
    summary: '不一定最快,但每一步都在为后来者趟路,稳中带韧。',
    tagline: '总要有人先走这一步。',
    dims: { D1: 'L', D2: 'M', D3: 'M', D4: 'M', D5: 'L', D6: 'M', D7: 'M', D8: 'L' },
  },
]

// ---------------------------------------------------------------------------
// Public roster the matcher consumes.
//
// Only archetypes whose typeCode is in `ACTIVE_CODES` are eligible match
// outcomes. The full F1TI deck stays defined above so we can flip the
// switch as more anime portraits ship — drop a `public/drivers/<slug>.png`
// + add a code here, no other change needed.
// ---------------------------------------------------------------------------

const ACTIVE_CODES = new Set(['HMLT', 'ANTO', 'VSTP'])

export const DRIVER_PROFILES: DriverProfile[] = F1TI_ARCHETYPES
  .filter((a) => ACTIVE_CODES.has(a.typeCode))
  .map((a) => ({
    typeCode: a.typeCode,
    typeName: a.typeName,
    matchedDriver: a.matchedDriver,
    summary: a.summary,
    tagline: a.tagline,
    profile: a.dims ? deriveProfile(a.dims) : (a.customProfile as PlayerStats),
  }))
