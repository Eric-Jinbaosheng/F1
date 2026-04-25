/**
 * 14 fixed racer personality archetypes. Each one has a 12-dimension
 * "ideal driving profile" the player gets matched against.
 *
 * Modify a profile here = the matcher immediately re-tunes; nothing else
 * needs to change.
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
  profile: PlayerStats
}

export const DRIVER_PROFILES: DriverProfile[] = [
  {
    typeCode: 'FAST-BORN',
    typeName: '天才爆发型',
    matchedDriver: 'Kimi Antonelli',
    summary: '你拥有年轻天才式的爆发力,能在高速和压力中迅速建立优势。',
    profile: { pace: 94, consistency: 82, clean: 76, cornering: 90, braking: 88, racingLine: 82, attack: 80, defense: 68, risk: 72, comeback: 65, pressure: 88, management: 72 },
  },
  {
    typeCode: 'CLEAN-CTRL',
    typeName: '精密控制型',
    matchedDriver: 'George Russell',
    summary: '你的驾驶方式冷静、精确、稳定,擅长用低失误率赢下比赛。',
    profile: { pace: 86, consistency: 92, clean: 90, cornering: 84, braking: 90, racingLine: 92, attack: 60, defense: 75, risk: 30, comeback: 45, pressure: 84, management: 85 },
  },
  {
    typeCode: 'ALL-ROUND',
    typeName: '全能大师型',
    matchedDriver: 'Lewis Hamilton',
    summary: '你的驾驶风格全面成熟,能攻能守,也能在压力下保持竞争力。',
    profile: { pace: 88, consistency: 86, clean: 85, cornering: 86, braking: 88, racingLine: 85, attack: 82, defense: 82, risk: 55, comeback: 65, pressure: 92, management: 82 },
  },
  {
    typeCode: 'PURE-PACE',
    typeName: '单圈天赋型',
    matchedDriver: 'Charles Leclerc',
    summary: '你的单圈速度和弯道天赋非常突出,擅长用极限速度打出高光。',
    profile: { pace: 96, consistency: 76, clean: 72, cornering: 94, braking: 90, racingLine: 84, attack: 72, defense: 58, risk: 70, comeback: 45, pressure: 80, management: 68 },
  },
  {
    typeCode: 'COMEBACK',
    typeName: '黑马逆袭型',
    matchedDriver: 'Oliver Bearman',
    summary: '你不是一开始最耀眼的人,但你擅长在比赛中段和后段不断追回位置。',
    profile: { pace: 80, consistency: 76, clean: 78, cornering: 78, braking: 80, racingLine: 76, attack: 76, defense: 60, risk: 62, comeback: 88, pressure: 76, management: 70 },
  },
  {
    typeCode: 'OPPORTUNE',
    typeName: '机会猎手型',
    matchedDriver: 'Pierre Gasly',
    summary: '你擅长观察局势,在混乱中保持冷静,并抓住每一个上升名次的机会。',
    profile: { pace: 78, consistency: 82, clean: 86, cornering: 80, braking: 82, racingLine: 80, attack: 72, defense: 70, risk: 50, comeback: 72, pressure: 82, management: 80 },
  },
  {
    typeCode: 'HARD-ATTACK',
    typeName: '强攻斗士型',
    matchedDriver: 'Liam Lawson',
    summary: '你的比赛风格充满攻击性,喜欢主动出击,用强硬动作打开局面。',
    profile: { pace: 82, consistency: 70, clean: 62, cornering: 82, braking: 86, racingLine: 70, attack: 92, defense: 74, risk: 82, comeback: 70, pressure: 76, management: 62 },
  },
  {
    typeCode: 'WILD-ROOKIE',
    typeName: '激进新星型',
    matchedDriver: 'Isack Hadjar',
    summary: '你有明显的速度天赋和弯道攻击性,但你的表现更像一颗正在燃烧的新星。',
    profile: { pace: 84, consistency: 65, clean: 60, cornering: 90, braking: 84, racingLine: 72, attack: 78, defense: 58, risk: 88, comeback: 62, pressure: 70, management: 58 },
  },
  {
    typeCode: 'STRATEGIST',
    typeName: '稳健策略型',
    matchedDriver: 'Carlos Sainz',
    summary: '你开得聪明、稳健,懂得管理节奏和资源,不靠鲁莽取胜。',
    profile: { pace: 82, consistency: 90, clean: 90, cornering: 80, braking: 86, racingLine: 88, attack: 68, defense: 76, risk: 35, comeback: 55, pressure: 82, management: 92 },
  },
  {
    typeCode: 'WILD-BREAK',
    typeName: '野性突破型',
    matchedDriver: 'Yuki Tsunoda',
    summary: '你的驾驶极具冲击力,敢于冒险,也经常能打出意想不到的突破。',
    profile: { pace: 82, consistency: 66, clean: 58, cornering: 84, braking: 80, racingLine: 68, attack: 82, defense: 60, risk: 90, comeback: 82, pressure: 66, management: 55 },
  },
  {
    typeCode: 'RELIABLE',
    typeName: '可靠老将型',
    matchedDriver: 'Nico Hulkenberg',
    summary: '你的驾驶不浮夸,但非常可靠,擅长用稳定和低失误完成比赛。',
    profile: { pace: 74, consistency: 86, clean: 92, cornering: 76, braking: 80, racingLine: 84, attack: 50, defense: 66, risk: 28, comeback: 35, pressure: 78, management: 82 },
  },
  {
    typeCode: 'RAW-TALENT',
    typeName: '高潜力波动型',
    matchedDriver: 'Gabriel Bortoleto',
    summary: '你的驾驶中有明显高光,某些瞬间非常快,但还需要把整场比赛串起来。',
    profile: { pace: 78, consistency: 62, clean: 62, cornering: 86, braking: 78, racingLine: 70, attack: 74, defense: 52, risk: 78, comeback: 60, pressure: 62, management: 55 },
  },
  {
    typeCode: 'TIME-TRIAL',
    typeName: '冷静计时型',
    matchedDriver: 'Alex Albon',
    summary: '你的驾驶像精准计时赛一样干净稳定,几乎不做多余冒险。',
    profile: { pace: 80, consistency: 94, clean: 96, cornering: 78, braking: 86, racingLine: 94, attack: 35, defense: 60, risk: 20, comeback: 30, pressure: 76, management: 86 },
  },
  {
    typeCode: 'HARD-DEFEND',
    typeName: '强硬防守型',
    matchedDriver: 'Esteban Ocon',
    summary: '你的防守非常强硬,别人想超过你会很困难。',
    profile: { pace: 78, consistency: 76, clean: 68, cornering: 76, braking: 80, racingLine: 74, attack: 70, defense: 92, risk: 65, comeback: 55, pressure: 80, management: 68 },
  },
]
