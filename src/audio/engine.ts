import engineUrl from '../assets/audio/engine.mp3?url'
import bgmUrl from '../assets/audio/bgm.mp3?url'

/** Looping engine sample whose volume + playback rate scale with throttle/speed,
 *  plus a constant-volume BGM track. Both decoded once at boot, no streaming. */
export interface AudioRig {
  start: () => void
  setEngine: (throttle01: number, speed01: number) => void
  setBgmVolume: (v: number) => void
  destroy: () => void
}

export async function createAudioRig(): Promise<AudioRig> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()

  const fetchBuffer = async (url: string): Promise<AudioBuffer | null> => {
    try {
      const res = await fetch(url)
      const buf = await res.arrayBuffer()
      return await ctx.decodeAudioData(buf)
    } catch (e) {
      console.warn('[F1S] audio decode failed for', url, e)
      return null
    }
  }

  const [engineBuf, bgmBuf] = await Promise.all([fetchBuffer(engineUrl), fetchBuffer(bgmUrl)])

  // ---- Engine: looping AudioBufferSourceNode + dedicated gain.
  const engineGain = ctx.createGain()
  engineGain.gain.value = 0
  engineGain.connect(ctx.destination)

  let engineSource: AudioBufferSourceNode | null = null

  const startEngine = (): void => {
    if (!engineBuf || engineSource) return
    engineSource = ctx.createBufferSource()
    engineSource.buffer = engineBuf
    engineSource.loop = true
    engineSource.connect(engineGain)
    try {
      engineSource.start()
    } catch (e) {
      console.warn('[F1S] engine start failed', e)
    }
  }

  // ---- BGM: separate loop, lower default volume.
  const bgmGain = ctx.createGain()
  bgmGain.gain.value = 0.8
  bgmGain.connect(ctx.destination)
  let bgmSource: AudioBufferSourceNode | null = null

  const startBgm = (): void => {
    if (!bgmBuf || bgmSource) return
    bgmSource = ctx.createBufferSource()
    bgmSource.buffer = bgmBuf
    bgmSource.loop = true
    bgmSource.connect(bgmGain)
    try {
      bgmSource.start()
    } catch (e) {
      console.warn('[F1S] bgm start failed', e)
    }
  }

  const start = (): void => {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    startEngine()
    startBgm()
  }

  const setEngine = (throttle01: number, speed01: number): void => {
    if (!engineSource) return
    // Volume swells with throttle: idle ≈ 0.25, full throttle = 1.0.
    // Pressing the accelerator (throttle > 0.7) snaps to a louder mix.
    const accel = throttle01 > 0.7
    const targetVol = accel ? 1.0 : 0.25 + speed01 * 0.4
    engineGain.gain.setTargetAtTime(targetVol, ctx.currentTime, 0.05)
    // Pitch with speed (0.7× idle → 1.6× redline)
    const targetRate = 0.7 + speed01 * 0.9
    engineSource.playbackRate.setTargetAtTime(targetRate, ctx.currentTime, 0.05)
  }

  const setBgmVolume = (v: number): void => {
    bgmGain.gain.setTargetAtTime(v, ctx.currentTime, 0.1)
  }

  const destroy = (): void => {
    try {
      engineSource?.stop()
      bgmSource?.stop()
    } catch {
      /* noop */
    }
    void ctx.close().catch(() => {})
  }

  return { start, setEngine, setBgmVolume, destroy }
}
