const PREFIX = 'f1s_'

export type TeamId = 'merc' | 'ferrari' | 'redbull' | 'mclaren'

export interface F1SStorage {
  bestLap: number | null
  runs: number
  team: TeamId | null
  nickname: string
  unlocks: string[]
  lastFaceImg: string | null
}

const DEFAULTS: F1SStorage = {
  bestLap: null,
  runs: 0,
  team: null,
  nickname: '',
  unlocks: [],
  lastFaceImg: null,
}

function readKey<K extends keyof F1SStorage>(key: K): F1SStorage[K] {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return DEFAULTS[key]
    return JSON.parse(raw) as F1SStorage[K]
  } catch (e) {
    console.warn(`[F1S] storage read ${key} failed:`, e)
    return DEFAULTS[key]
  }
}

function writeKey<K extends keyof F1SStorage>(key: K, value: F1SStorage[K]): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch (e) {
    console.warn(`[F1S] storage write ${key} failed:`, e)
  }
}

export const storage = {
  getBestLap: () => readKey('bestLap'),
  setBestLap: (ms: number) => writeKey('bestLap', ms),

  getRuns: () => readKey('runs'),
  incRuns: () => writeKey('runs', (readKey('runs') ?? 0) + 1),

  getTeam: () => readKey('team'),
  setTeam: (t: TeamId) => writeKey('team', t),

  getNickname: () => readKey('nickname'),
  setNickname: (n: string) => writeKey('nickname', n),

  getUnlocks: () => readKey('unlocks'),
  addUnlock: (badge: string) => {
    const cur = readKey('unlocks') ?? []
    if (!cur.includes(badge)) writeKey('unlocks', [...cur, badge])
  },

  getLastFaceImg: () => readKey('lastFaceImg'),
  setLastFaceImg: (b64: string) => writeKey('lastFaceImg', b64),
}
