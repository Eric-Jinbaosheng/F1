/**
 * Weather / time-of-day presets. One is picked at random each session and
 * applied to: scene background, fog, sun, hemi light, tone-mapping exposure,
 * cloud tint, and horizon haze. Purely visual — no physics impact.
 */

export interface WeatherPreset {
  id: string
  label: string
  /** Scene background colour. */
  sky: string
  /** Linear fog colour + near/far distance. */
  fogColor: string
  fogNear: number
  fogFar: number
  /** Direct sunlight. */
  sunColor: string
  sunIntensity: number
  /** Hemi (sky/ground) fill light. */
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  /** Tone-mapping exposure. */
  exposure: number
  /** Drifting clouds tint + alpha. */
  cloudColor: string
  cloudOpacity: number
  /** Horizon haze plane colour. */
  hazeColor: string
  /** When true, the moon + stars are shown and night-only tweaks kick in. */
  nightMode?: boolean
}

export const WEATHER_PRESETS: WeatherPreset[] = [
  {
    id: 'noon',
    label: '☀️ 正午晴天',
    sky: '#87ceeb',
    fogColor: '#cfe6f5', fogNear: 400, fogFar: 2500,
    sunColor: '#fff2d4', sunIntensity: 3.2,
    hemiSky: '#bfdfff', hemiGround: '#556a32', hemiIntensity: 0.7,
    exposure: 1.15,
    cloudColor: '#ffffff', cloudOpacity: 0.85,
    hazeColor: '#b8c6d8',
  },
  {
    id: 'dawn',
    label: '🌅 清晨',
    sky: '#f3b27a',
    fogColor: '#f4ceb0', fogNear: 200, fogFar: 2200,
    sunColor: '#ffd0a0', sunIntensity: 2.0,
    hemiSky: '#e6a880', hemiGround: '#5a4a30', hemiIntensity: 0.55,
    exposure: 1.05,
    cloudColor: '#ffd6b0', cloudOpacity: 0.8,
    hazeColor: '#e8b890',
  },
  {
    id: 'sunset',
    label: '🌇 黄昏',
    sky: '#ec7949',
    fogColor: '#cf7050', fogNear: 200, fogFar: 2000,
    sunColor: '#ff7040', sunIntensity: 1.8,
    hemiSky: '#cc6644', hemiGround: '#3a2820', hemiIntensity: 0.5,
    exposure: 1.0,
    cloudColor: '#ff9a70', cloudOpacity: 0.78,
    hazeColor: '#d27050',
  },
  {
    id: 'overcast',
    label: '☁️ 阴天',
    sky: '#a8b4be',
    fogColor: '#b6bec6', fogNear: 250, fogFar: 1800,
    sunColor: '#cfd5dc', sunIntensity: 1.4,
    hemiSky: '#9aa6b0', hemiGround: '#4a5258', hemiIntensity: 0.85,
    exposure: 0.95,
    cloudColor: '#9aa3ad', cloudOpacity: 0.95,
    hazeColor: '#a8b4be',
  },
  {
    id: 'night',
    label: '🌙 夜晚',
    sky: '#0d1426',
    fogColor: '#0f1828', fogNear: 200, fogFar: 1600,
    // "Sun" stands in as moonlight at night — cool blue, brighter than a
    // realistic moon so the track stays readable from a racing camera.
    sunColor: '#aabad8', sunIntensity: 1.4,
    hemiSky: '#2a3858', hemiGround: '#0c1422', hemiIntensity: 0.55,
    exposure: 1.0,
    cloudColor: '#5a6478', cloudOpacity: 0.65,
    hazeColor: '#1c2a40',
    nightMode: true,
  },
]

export function pickRandomWeather(): WeatherPreset {
  const i = Math.floor(Math.random() * WEATHER_PRESETS.length)
  return WEATHER_PRESETS[i]
}
