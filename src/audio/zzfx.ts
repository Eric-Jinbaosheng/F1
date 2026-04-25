// Minimal ZzFX implementation (MIT, Frank Force) — embedded to avoid CDN.
// https://github.com/KilledByAPixel/ZzFX

let zzfxCtx: AudioContext | null = null
const zzfxV = 0.3

function ctx(): AudioContext | null {
  if (zzfxCtx) return zzfxCtx
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    zzfxCtx = new AC()
    return zzfxCtx
  } catch (e) {
    console.warn('[F1S] AudioContext failed:', e)
    return null
  }
}

export function unlockAudio(): void {
  const c = ctx()
  if (c && c.state === 'suspended') {
    void c.resume().catch(() => {})
  }
}

function buildSamples(
  volume = 1,
  randomness = 0.05,
  frequency = 220,
  attack = 0,
  sustain = 0,
  release = 0.1,
  shape = 0,
  shapeCurve = 1,
  slide = 0,
  deltaSlide = 0,
  pitchJump = 0,
  pitchJumpTime = 0,
  repeatTime = 0,
  noise = 0,
  modulation = 0,
  bitCrush = 0,
  delay = 0,
  sustainVolume = 1,
  decay = 0,
  tremolo = 0,
): number[] {
  const sampleRate = 44100
  const PI2 = Math.PI * 2
  let sign = 1
  let s = 0
  let f = frequency * (1 + randomness * (Math.random() * 2 - 1)) * PI2 / sampleRate
  let t = 0
  const buffer: number[] = []
  attack = attack * sampleRate + 9
  decay *= sampleRate
  sustain *= sampleRate
  release *= sampleRate
  delay *= sampleRate
  pitchJumpTime *= sampleRate
  slide *= 500 * PI2 / sampleRate ** 3
  pitchJump *= PI2 / sampleRate
  modulation *= PI2 / sampleRate
  shape = shape | 0
  const length = attack + decay + sustain + release + delay
  for (let i = 0; i < length; i++) {
    s = i / sampleRate
    let sample = 0
    const phase = t * f * (1 + modulation * Math.sin(s * 5))
    if (shape === 0) sample = Math.sin(phase + Math.sin(phase * 2) * noise)
    else if (shape === 1) sample = phase % PI2 > Math.PI ? -1 : 1
    else if (shape === 2) sample = (((phase % PI2) / PI2) * 4 - 2) * sign
    else sample = Math.sin((phase / PI2) ** 3 * PI2)
    sample = (shapeCurve < 0 ? -1 : 1) * Math.abs(sample) ** Math.abs(shapeCurve) * (sample < 0 ? -1 : 1)
    let env = 1
    if (i < attack) env = i / attack
    else if (i < attack + decay) env = 1 - ((i - attack) / decay) * (1 - sustainVolume)
    else if (i < attack + decay + sustain) env = sustainVolume
    else if (i < length - delay) env = ((length - delay - i) / release) * sustainVolume
    else env = 0
    if (tremolo) env *= 1 - tremolo + tremolo * Math.sin(PI2 * s * 4)
    sample *= env * volume * zzfxV
    if (bitCrush) sample = Math.round(sample * bitCrush) / bitCrush
    buffer.push(sample)
    t++
    f += slide
    f *= 1 + deltaSlide / 1e5
    if (pitchJumpTime && i === (pitchJumpTime | 0)) {
      f += pitchJump
    }
    if (repeatTime && t > ((repeatTime * sampleRate) | 0)) {
      t = 0
      f = frequency * PI2 / sampleRate
    }
    sign = -sign
  }
  return buffer
}

export function zzfx(...params: number[]): void {
  try {
    const c = ctx()
    if (!c) return
    const samples = buildSamples(...params)
    const buf = c.createBuffer(1, samples.length, 44100)
    buf.getChannelData(0).set(samples)
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.start()
  } catch (e) {
    console.warn('[F1S] zzfx failed:', e)
  }
}

export const SFX = {
  countdownBeep: () => zzfx(1.05, 0, 800, 0, 0.05, 0.1, 1, 2),
  lightsOut: () => zzfx(1.5, 0, 200, 0.05, 0.3, 0.5, 2, 3, 0, 0, 0, 0, 0, 5, 0, 0.5),
  engineStart: () => zzfx(2, 0, 80, 0.5, 1, 1, 3, 5),
  tireScreech: () => zzfx(1, 0, 2000, 0, 0.3, 0.5, 3, 2),
  crash: () => zzfx(2.5, 0, 150, 0.05, 0.2, 0.6, 4, 4, 0, -50),
  drsOpen: () => zzfx(1.2, 0, 800, 0.1, 0.4, 0.5, 2, 1.5),
  shakeOff: () => zzfx(1.5, 0, 400, 0.05, 0.3, 0.4, 1, 1.5),
  finishHorn: () => zzfx(2, 0, 500, 0.5, 2, 0.8, 2, 3),
  jumpStart: () => zzfx(2, 0, 100, 0, 0.5, 1, 4, 5, 0, -20),
  uiClick: () => zzfx(0.5, 0, 800, 0, 0.05, 0.05, 1, 1.5),
}
