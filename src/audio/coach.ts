/**
 * Driving-coach voice system. Looks ahead on the track curve, decides
 * whether the player is approaching a corner / a long straight / a sharp
 * brake-zone, and speaks short Chinese cues using the browser's built-in
 * SpeechSynthesis API. No external TTS service, no audio files, no fetch.
 *
 * Coexists cleanly with `CommentarySystem` (different audio pipeline) but
 * the menu only enables one of them at a time.
 */

import type { TrackBundle } from '../render/track'

const COACH_DEBUG = false

export type CoachCue = 'brake' | 'turn_left' | 'turn_right' | 'push' | 'recover'

interface CueConfig {
  text: string
  priority: number
  cooldownMs: number
}

const CUES: Record<CoachCue, CueConfig> = {
  brake:      { text: '前方急弯,准备刹车', priority: 90, cooldownMs: 4500 },
  turn_left:  { text: '左弯', priority: 60, cooldownMs: 4000 },
  turn_right: { text: '右弯', priority: 60, cooldownMs: 4000 },
  push:       { text: '直道,全力加速', priority: 40, cooldownMs: 9000 },
  recover:    { text: '回到赛道', priority: 80, cooldownMs: 6000 },
}

const LOOKAHEAD_M = 80
const SAMPLES = 8
// Above these radians of cumulative bend within LOOKAHEAD_M we classify as
// a corner; above the higher threshold AND fast = "brake".
const CORNER_ANGLE_RAD = 0.42 // ~24°
const SHARP_ANGLE_RAD = 0.85 // ~49°
const BRAKE_SPEED_MIN = 28 // m/s ≈ 100 km/h
const PUSH_SPEED_MIN = 25
const PUSH_STRAIGHT_HOLD_MS = 1800

export interface CoachOptions {
  enabled: boolean
  volume: number
  rate: number
  pitch: number
}

export interface CoachSnapshot {
  time: number
  raceState?: 'waiting' | 'countdown' | 'running' | 'finished'
  speed?: number
  lapProgress?: number
  offTrack?: boolean
  finished?: boolean
}

const log = (...args: unknown[]): void => {
  if (COACH_DEBUG) console.log('[coach]', ...args)
}

export class CoachSystem {
  private track: TrackBundle
  private opts: CoachOptions
  private unlocked = false
  private lastCueAt = new Map<CoachCue, number>()
  private lastAnyAt = 0
  private wasOffTrack = false
  private straightSince = 0
  private currentCorner: 'L' | 'R' | null = null
  private finishedAck = false
  /** Reuse a single utterance helper so iOS Safari (which has a tight
   *  speak-queue) doesn't pile up zombies. */
  private synth: SpeechSynthesis | null = null

  constructor(track: TrackBundle, options: Partial<CoachOptions> = {}) {
    this.track = track
    this.opts = {
      enabled: options.enabled ?? false,
      volume: options.volume ?? 0.95,
      rate: options.rate ?? 1.05,
      pitch: options.pitch ?? 1.0,
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis
    }
  }

  setEnabled(enabled: boolean): void {
    this.opts.enabled = enabled
    if (!enabled) this.synth?.cancel()
  }

  setVolume(volume: number): void {
    this.opts.volume = Math.max(0, Math.min(1, volume))
  }

  /** Browser TTS doesn't strictly need a gesture, but Safari iOS sometimes
   *  silently no-ops the first utterance until one has been triggered
   *  inside a user-gesture handler. Call this from a click. */
  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    if (!this.synth) return
    try {
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      u.rate = 2.0
      this.synth.speak(u)
    } catch {
      /* noop */
    }
    log('unlocked')
  }

  /** Reset per-race state on a fresh start. */
  resetRace(): void {
    this.lastCueAt.clear()
    this.lastAnyAt = 0
    this.wasOffTrack = false
    this.straightSince = 0
    this.currentCorner = null
    this.finishedAck = false
    this.synth?.cancel()
  }

  /** Manually fire a cue. Respects priority + cooldown unless force=true. */
  trigger(cue: CoachCue, force = false): void {
    if (!this.opts.enabled || !this.synth) return
    const cfg = CUES[cue]
    const now = performance.now()
    if (!force) {
      const last = this.lastCueAt.get(cue) ?? -Infinity
      if (now - last < cfg.cooldownMs) {
        log('suppress', cue, 'cooldown')
        return
      }
      // Global gap: don't barrage the player with cues. Higher-priority
      // cues are allowed to break the gap (brake / off-track recovery).
      if (now - this.lastAnyAt < 1500 && cfg.priority < 80) {
        log('suppress', cue, 'global gap')
        return
      }
    }
    try {
      this.synth.cancel() // interrupt anything mid-utterance
      const u = new SpeechSynthesisUtterance(cfg.text)
      u.lang = 'zh-CN'
      u.rate = this.opts.rate
      u.pitch = this.opts.pitch
      u.volume = this.opts.volume
      this.synth.speak(u)
      this.lastCueAt.set(cue, now)
      this.lastAnyAt = now
      log('speak', cue, cfg.text)
    } catch (e) {
      console.warn('[coach] speak failed:', e)
    }
  }

  /** Looks ahead at the track curve and decides which cue to fire (if
   *  any). Call every frame from the game loop with the current player
   *  state. */
  update(snapshot: CoachSnapshot): void {
    if (!this.opts.enabled || !this.synth) return
    const now = snapshot.time
    if (this.finishedAck) return

    // --- Off-track recovery cue.
    const off = snapshot.offTrack ?? false
    if (off && !this.wasOffTrack) {
      this.trigger('recover')
    }
    this.wasOffTrack = off

    if (snapshot.finished) {
      this.finishedAck = true
      return
    }

    // Need lapProgress + speed to do corner lookahead.
    if (snapshot.lapProgress === undefined || snapshot.speed === undefined) return
    if (snapshot.raceState && snapshot.raceState !== 'running') return

    // --- Lookahead: integrate curvature for the next LOOKAHEAD_M metres.
    // Returns a signed cumulative angle: + = right (CW from above),
    // − = left (CCW). Magnitude = how sharply the road bends.
    const t0 = snapshot.lapProgress
    const len = this.track.length
    const baseT = this.track.getTangentAt(((t0 % 1) + 1) % 1)
    const stepM = LOOKAHEAD_M / SAMPLES
    let maxAbs = 0
    let signed = 0
    for (let i = 1; i <= SAMPLES; i++) {
      const dt = (i * stepM) / len
      const tg = this.track.getTangentAt((((t0 + dt) % 1) + 1) % 1)
      const dotV = Math.max(-1, Math.min(1, baseT.x * tg.x + baseT.z * tg.z))
      const ang = Math.acos(dotV)
      if (ang > maxAbs) {
        maxAbs = ang
        // Cross-product Y (right-handed, Y up) sign: + = right turn,
        // − = left turn.
        const crossY = baseT.x * tg.z - baseT.z * tg.x
        signed = ang * Math.sign(crossY || 1)
      }
    }

    // --- Corner cue: fire once per corner (track which side we last
    // announced; refire when we've passed it / changed direction).
    if (maxAbs > CORNER_ANGLE_RAD) {
      const dir: 'L' | 'R' = signed < 0 ? 'L' : 'R'
      const sharp = maxAbs > SHARP_ANGLE_RAD && snapshot.speed > BRAKE_SPEED_MIN
      if (this.currentCorner !== dir) {
        this.currentCorner = dir
        if (sharp) {
          this.trigger('brake')
        } else {
          this.trigger(dir === 'L' ? 'turn_left' : 'turn_right')
        }
      } else if (sharp && snapshot.speed > BRAKE_SPEED_MIN + 5) {
        // Already announced this side, but if we're still flying into a
        // sharp one, repeat the brake call (subject to cooldown).
        this.trigger('brake')
      }
      // Reset straight-hold counter while in / approaching a corner.
      this.straightSince = 0
    } else {
      // --- Push cue: long straight + good speed sustained.
      this.currentCorner = null
      if (snapshot.speed > PUSH_SPEED_MIN) {
        if (this.straightSince === 0) this.straightSince = now
        else if (now - this.straightSince > PUSH_STRAIGHT_HOLD_MS) {
          this.trigger('push')
          this.straightSince = 0
        }
      } else {
        this.straightSince = 0
      }
    }
  }

  dispose(): void {
    this.synth?.cancel()
  }
}
