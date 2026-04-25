/**
 * Race-commentary audio layer.
 *
 * Listens to per-frame snapshots of the player + track + race-state and
 * picks one of ~19 pre-recorded WAV clips at the right moment.
 *
 * Everything is local — clips live in `public/audio/commentary/*.wav` and
 * are loaded via plain `HTMLAudioElement`. No fetch / network / external
 * libs.
 *
 * Anti-spam guards:
 *   - per-event cooldown
 *   - global minimum gap between any two clips
 *   - priority interrupt (only higher-priority events cut a clip short)
 *   - transition-only triggers (off-track / finish_line fire on edges)
 *   - one-shot flags for events that should only happen once per race
 */

const COMMENTARY_DEBUG = false

export type CommentaryEvent =
  | 'countdown'
  | 'race_start'
  | 'strong_launch'
  | 'slow_launch'
  | 'first_acceleration'
  | 'first_corner'
  | 'clean_corner'
  | 'wide_corner'
  | 'sharp_steering'
  | 'near_miss'
  | 'first_collision'
  | 'repeated_collisions'
  | 'off_track'
  | 'back_on_track'
  | 'high_speed_section'
  | 'overtake_pass'
  | 'low_speed_hesitation'
  | 'halfway_point'
  | 'final_10_seconds'
  | 'final_push'
  | 'finish_line'
  | 'great_finish'
  | 'messy_finish'
  | 'podium_reveal'

interface ClipConfig {
  url: string
  priority: number
  cooldownMs: number
}

const COMMENTARY_CLIPS: Record<CommentaryEvent, ClipConfig> = {
  countdown:           { url: '/audio/commentary/01_countdown.mp3',           priority: 40, cooldownMs: 999_999 },
  race_start:          { url: '/audio/commentary/02_race_start.mp3',          priority: 50, cooldownMs: 999_999 },
  strong_launch:       { url: '/audio/commentary/03_strong_launch.mp3',       priority: 45, cooldownMs: 999_999 },
  slow_launch:         { url: '/audio/commentary/04_slow_launch.mp3',         priority: 45, cooldownMs: 999_999 },
  first_acceleration:  { url: '/audio/commentary/05_first_acceleration.mp3',  priority: 35, cooldownMs: 999_999 },
  first_corner:        { url: '/audio/commentary/06_first_corner.mp3',        priority: 55, cooldownMs: 999_999 },
  clean_corner:        { url: '/audio/commentary/07_clean_corner.mp3',        priority: 50, cooldownMs: 25_000 },
  wide_corner:         { url: '/audio/commentary/08_wide_corner.mp3',         priority: 55, cooldownMs: 22_000 },
  sharp_steering:      { url: '/audio/commentary/09_sharp_steering.mp3',      priority: 55, cooldownMs: 12_000 },
  near_miss:           { url: '/audio/commentary/10_near_miss.mp3',           priority: 70, cooldownMs: 7_000 },
  first_collision:     { url: '/audio/commentary/11_first_collision.mp3',     priority: 75, cooldownMs: 999_999 },
  repeated_collisions: { url: '/audio/commentary/12_repeated_collisions.mp3', priority: 75, cooldownMs: 15_000 },
  off_track:           { url: '/audio/commentary/14_off_track.mp3',           priority: 80, cooldownMs: 9_000 },
  back_on_track:       { url: '/audio/commentary/15_back_on_track.mp3',       priority: 60, cooldownMs: 12_000 },
  high_speed_section:  { url: '/audio/commentary/16_high_speed_section.mp3',  priority: 50, cooldownMs: 20_000 },
  overtake_pass:       { url: '/audio/commentary/20_overtake_pass.mp3',       priority: 65, cooldownMs: 6_000 },
  low_speed_hesitation:{ url: '/audio/commentary/23_low_speed_hesitation.mp3',priority: 40, cooldownMs: 18_000 },
  halfway_point:       { url: '/audio/commentary/25_halfway_point.mp3',       priority: 50, cooldownMs: 999_999 },
  final_10_seconds:    { url: '/audio/commentary/26_final_10_seconds.mp3',    priority: 60, cooldownMs: 999_999 },
  final_push:          { url: '/audio/commentary/27_final_push.mp3',          priority: 65, cooldownMs: 999_999 },
  finish_line:         { url: '/audio/commentary/28_finish_line.mp3',         priority: 100, cooldownMs: 999_999 },
  great_finish:        { url: '/audio/commentary/29_great_finish.mp3',        priority: 90, cooldownMs: 999_999 },
  messy_finish:        { url: '/audio/commentary/30_messy_finish.mp3',        priority: 90, cooldownMs: 999_999 },
  podium_reveal:       { url: '/audio/commentary/31_podium_reveal.mp3',       priority: 95, cooldownMs: 999_999 },
}

// --- Detection thresholds. Tuned for this game's units (m/s, projection
// offset metres, lapProgress 0..1). ROAD_HALF_WIDTH=7, KERB_WIDTH=2,
// physics.HARD_OFFSET=9 triggers off-track crash, so near-miss lives in
// the kerb band [7.2, 8.8].
const STRONG_LAUNCH_WINDOW_MS = 6000
const STRONG_LAUNCH_MIN_DELAY_MS = 1000
const STRONG_LAUNCH_SPEED = 18
const STRONG_LAUNCH_ACCEL = 4

const SLOW_LAUNCH_DELAY_MS = 4000
const SLOW_LAUNCH_SPEED_MAX = 8

const FIRST_ACCEL_SPEED = 10

const SHARP_STEERING_THRESHOLD = 0.85
const SHARP_STEERING_HOLD_MS = 350

const NEAR_MISS_OFFSET_MIN = 7.2
const NEAR_MISS_OFFSET_MAX = 8.8
const NEAR_MISS_SPEED_MIN = 16

const HIGH_SPEED_THRESHOLD = 70 // m/s ≈ 252 km/h
const HIGH_SPEED_HOLD_MS = 2200

const LOW_HESITATION_SPEED = 5
const LOW_HESITATION_HOLD_MS = 3500

const FINISH_MIN_RACE_MS = 20_000

export interface CommentaryOptions {
  enabled: boolean
  volume: number
  globalCooldownMs: number
}

export interface CommentarySnapshot {
  time: number
  raceState?: 'waiting' | 'countdown' | 'running' | 'finished'
  speed?: number
  acceleration?: number
  steeringAbs?: number
  trackOffset?: number
  offTrack?: boolean
  /** Total crash count (monotonic). */
  crashCount?: number
  lapProgress?: number
  lapCount?: number
  /** 1-based current rank in the field (1 = leading). */
  position?: number
  /** Total field size (player + AI). */
  fieldSize?: number
  finished?: boolean
}

const log = (...args: unknown[]): void => {
  if (COMMENTARY_DEBUG) console.log('[commentary]', ...args)
}

export class CommentarySystem {
  private opts: CommentaryOptions
  private clips = new Map<CommentaryEvent, HTMLAudioElement>()
  private lastPlayedAt = new Map<CommentaryEvent, number>()
  private lastAnyPlayedAt = 0
  private currentAudio: HTMLAudioElement | null = null
  private currentEvent: CommentaryEvent | null = null
  private currentPriority = 0
  private unlocked = false
  private prev: CommentarySnapshot | null = null

  // Per-race state
  private raceStartPlayed = false
  private strongLaunchPlayed = false
  private slowLaunchPlayed = false
  private firstAccelPlayed = false
  private firstCollisionPlayed = false
  private halfwayPlayed = false
  private finalTenPlayed = false
  private finalPushPlayed = false
  private finishPlayed = false
  private wasOffTrack = false
  private lastCrashCount = 0
  private lastPosition: number | undefined
  private raceStartTime = 0
  // Held-state timers (rolling) — start tracking when condition first
  // appears, fire when it has held for the configured duration.
  private sharpSteerSince = 0
  private highSpeedSince = 0
  private lowSpeedSince = 0

  constructor(options: Partial<CommentaryOptions> = {}) {
    this.opts = {
      enabled: options.enabled ?? true,
      volume: options.volume ?? 0.85,
      globalCooldownMs: options.globalCooldownMs ?? 2200,
    }
  }

  /** Build an `Audio` per clip and start preloading. Failures here are
   *  non-fatal — the clip just stays missing and `trigger()` will skip. */
  preload(): Promise<void> {
    const tasks: Array<Promise<void>> = []
    for (const key of Object.keys(COMMENTARY_CLIPS) as CommentaryEvent[]) {
      const cfg = COMMENTARY_CLIPS[key]
      try {
        const a = new Audio(cfg.url)
        a.preload = 'auto'
        a.volume = this.opts.volume
        a.addEventListener('error', () => {
          console.warn('[commentary] missing clip:', cfg.url)
          this.clips.delete(key)
        })
        a.addEventListener('canplaythrough', () => log('preloaded', key), { once: true })
        this.clips.set(key, a)
        tasks.push(
          new Promise<void>((res) => {
            const done = (): void => res()
            a.addEventListener('canplaythrough', done, { once: true })
            a.addEventListener('error', done, { once: true })
            setTimeout(done, 4000) // never block longer than this
          }),
        )
      } catch (e) {
        console.warn('[commentary] preload failed for', cfg.url, e)
      }
    }
    return Promise.all(tasks).then(() => undefined)
  }

  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    log('unlocked')
  }

  setEnabled(enabled: boolean): void {
    this.opts.enabled = enabled
    if (!enabled && this.currentAudio) {
      this.currentAudio.pause()
      this.clearCurrent()
    }
  }

  setVolume(volume: number): void {
    this.opts.volume = Math.max(0, Math.min(1, volume))
    for (const a of this.clips.values()) a.volume = this.opts.volume
  }

  trigger(event: CommentaryEvent, force = false): void {
    if (!this.opts.enabled || !this.unlocked) return
    const cfg = COMMENTARY_CLIPS[event]
    if (!cfg) return
    const now = performance.now()
    if (!force) {
      const last = this.lastPlayedAt.get(event) ?? -Infinity
      if (now - last < cfg.cooldownMs) {
        log('suppress', event, 'cooldown')
        return
      }
      if (
        now - this.lastAnyPlayedAt < this.opts.globalCooldownMs &&
        cfg.priority < 80
      ) {
        log('suppress', event, 'global gap')
        return
      }
    }
    if (this.currentAudio && !this.currentAudio.paused) {
      if (cfg.priority <= this.currentPriority) {
        log('suppress', event, 'priority<=current')
        return
      }
      log('interrupt', this.currentEvent, '->', event)
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
    }
    this.playClip(event, now)
  }

  private playClip(event: CommentaryEvent, now: number): void {
    const audio = this.clips.get(event)
    if (!audio) {
      console.warn('[commentary] no audio loaded for', event)
      return
    }
    try {
      audio.currentTime = 0
      audio.volume = this.opts.volume
      const p = audio.play()
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          console.warn('[commentary] play failed for', event, err)
          if (err && err.name === 'NotAllowedError') this.unlocked = false
        })
      }
    } catch (e) {
      console.warn('[commentary] play exception for', event, e)
      return
    }
    this.currentAudio = audio
    this.currentEvent = event
    this.currentPriority = COMMENTARY_CLIPS[event].priority
    this.lastPlayedAt.set(event, now)
    this.lastAnyPlayedAt = now
    log('play', event)
    const onEnd = (): void => {
      audio.removeEventListener('ended', onEnd)
      if (this.currentAudio === audio) this.clearCurrent()
    }
    audio.addEventListener('ended', onEnd)
  }

  private clearCurrent(): void {
    this.currentAudio = null
    this.currentEvent = null
    this.currentPriority = 0
  }

  /** Should be called every frame from the game loop with the latest
   *  player state. Detects all auto-triggered events. */
  update(snapshot: CommentarySnapshot): void {
    if (!this.opts.enabled) return
    const prev = this.prev
    const now = snapshot.time

    // --- race_start: edge into running, OR first movement.
    if (!this.raceStartPlayed) {
      const running = snapshot.raceState === 'running' && prev?.raceState !== 'running'
      const movedFromStill =
        snapshot.raceState === undefined &&
        (snapshot.speed ?? 0) > 1.0 &&
        snapshot.time > 500
      if (running || movedFromStill) {
        this.trigger('race_start', true)
        this.raceStartPlayed = true
        this.raceStartTime = now
        log('detected race_start')
      }
    }

    // --- first_acceleration: speed first crosses 10 m/s after start.
    if (
      this.raceStartPlayed &&
      !this.firstAccelPlayed &&
      !this.strongLaunchPlayed &&
      now - this.raceStartTime > 600 &&
      now - this.raceStartTime < STRONG_LAUNCH_MIN_DELAY_MS &&
      snapshot.speed !== undefined &&
      snapshot.speed > FIRST_ACCEL_SPEED
    ) {
      this.trigger('first_acceleration')
      this.firstAccelPlayed = true
    }

    // --- strong_launch / slow_launch: mutually exclusive.
    if (this.raceStartPlayed && !this.strongLaunchPlayed && !this.slowLaunchPlayed) {
      const elapsed = now - this.raceStartTime
      // strong: fast pickup in the first 1–6 s.
      if (
        elapsed > STRONG_LAUNCH_MIN_DELAY_MS &&
        elapsed < STRONG_LAUNCH_WINDOW_MS &&
        snapshot.speed !== undefined &&
        snapshot.speed > STRONG_LAUNCH_SPEED
      ) {
        let accel = snapshot.acceleration
        if (accel === undefined && prev && prev.speed !== undefined) {
          const dt = (snapshot.time - prev.time) / 1000
          if (dt > 0) accel = (snapshot.speed - prev.speed) / dt
        }
        if (accel === undefined || accel > STRONG_LAUNCH_ACCEL) {
          this.trigger('strong_launch')
          this.strongLaunchPlayed = true
          // Block slow_launch from also firing.
          this.slowLaunchPlayed = true
        }
      }
      // slow: still crawling 4 s in.
      if (
        !this.strongLaunchPlayed &&
        !this.slowLaunchPlayed &&
        elapsed > SLOW_LAUNCH_DELAY_MS &&
        elapsed < STRONG_LAUNCH_WINDOW_MS + 2000 &&
        snapshot.speed !== undefined &&
        snapshot.speed < SLOW_LAUNCH_SPEED_MAX
      ) {
        this.trigger('slow_launch')
        this.slowLaunchPlayed = true
        this.strongLaunchPlayed = true
      }
    }

    // --- sharp_steering: |steer| held high for SHARP_STEERING_HOLD_MS.
    const steerAbs = snapshot.steeringAbs ?? 0
    if (steerAbs > SHARP_STEERING_THRESHOLD) {
      if (this.sharpSteerSince === 0) this.sharpSteerSince = now
      else if (now - this.sharpSteerSince > SHARP_STEERING_HOLD_MS) {
        this.trigger('sharp_steering')
        this.sharpSteerSince = 0 // reset so it can fire again after cooldown
      }
    } else {
      this.sharpSteerSince = 0
    }

    // --- off_track: false → true edge only.
    const offTrackNow = snapshot.offTrack ?? false
    if (offTrackNow && !this.wasOffTrack && !this.finishPlayed) {
      this.trigger('off_track')
    }
    // --- back_on_track: true → false edge.
    if (!offTrackNow && this.wasOffTrack && !this.finishPlayed) {
      this.trigger('back_on_track')
    }
    this.wasOffTrack = offTrackNow

    // --- collisions: first vs repeated. Driven by monotonic crashCount.
    const crashCount = snapshot.crashCount ?? 0
    if (crashCount > this.lastCrashCount) {
      if (!this.firstCollisionPlayed) {
        this.trigger('first_collision')
        this.firstCollisionPlayed = true
      } else if (crashCount >= 3) {
        this.trigger('repeated_collisions')
      }
      this.lastCrashCount = crashCount
    }

    // --- near_miss: kerb-riding fast, NOT off-track or just-collided.
    if (
      !offTrackNow &&
      !this.finishPlayed &&
      snapshot.trackOffset !== undefined &&
      snapshot.speed !== undefined &&
      snapshot.speed > NEAR_MISS_SPEED_MIN &&
      snapshot.trackOffset > NEAR_MISS_OFFSET_MIN &&
      snapshot.trackOffset < NEAR_MISS_OFFSET_MAX
    ) {
      const offsetDelta =
        prev?.trackOffset !== undefined ? snapshot.trackOffset - prev.trackOffset : 0
      const drifty = offsetDelta > 0.5
      const swerving = steerAbs > 0.55
      const veryFast = snapshot.speed > 24
      if (drifty || swerving || veryFast) {
        this.trigger('near_miss')
      }
    }

    // --- high_speed_section: speed above HIGH_SPEED_THRESHOLD held.
    if (snapshot.speed !== undefined && snapshot.speed > HIGH_SPEED_THRESHOLD) {
      if (this.highSpeedSince === 0) this.highSpeedSince = now
      else if (now - this.highSpeedSince > HIGH_SPEED_HOLD_MS) {
        this.trigger('high_speed_section')
        this.highSpeedSince = 0
      }
    } else {
      this.highSpeedSince = 0
    }

    // --- low_speed_hesitation: stuck at very low speed mid-race.
    if (
      this.raceStartPlayed &&
      !this.finishPlayed &&
      snapshot.speed !== undefined &&
      snapshot.speed < LOW_HESITATION_SPEED &&
      now - this.raceStartTime > 5000
    ) {
      if (this.lowSpeedSince === 0) this.lowSpeedSince = now
      else if (now - this.lowSpeedSince > LOW_HESITATION_HOLD_MS) {
        this.trigger('low_speed_hesitation')
        this.lowSpeedSince = 0
      }
    } else {
      this.lowSpeedSince = 0
    }

    // --- overtake_pass: rank value decreased (closer to 1 = leading).
    if (
      snapshot.position !== undefined &&
      this.lastPosition !== undefined &&
      snapshot.position < this.lastPosition
    ) {
      this.trigger('overtake_pass')
    }
    if (snapshot.position !== undefined) this.lastPosition = snapshot.position

    // --- halfway_point / final_10_seconds / final_push: lapProgress gates.
    if (
      this.raceStartPlayed &&
      !this.finishPlayed &&
      snapshot.lapProgress !== undefined
    ) {
      const t = snapshot.lapProgress
      if (!this.halfwayPlayed && t > 0.5 && t < 0.6) {
        this.trigger('halfway_point')
        this.halfwayPlayed = true
      }
      if (!this.finalTenPlayed && t > 0.85) {
        this.trigger('final_10_seconds')
        this.finalTenPlayed = true
      }
      if (!this.finalPushPlayed && t > 0.95) {
        this.trigger('final_push')
        this.finalPushPlayed = true
      }
    }

    // --- finish_line: explicit flag wins; otherwise lap-wrap heuristic.
    if (!this.finishPlayed) {
      if (snapshot.finished || snapshot.raceState === 'finished') {
        this.trigger('finish_line', true)
        this.finishPlayed = true
      } else if (
        this.raceStartPlayed &&
        prev?.lapProgress !== undefined &&
        snapshot.lapProgress !== undefined &&
        prev.lapProgress > 0.92 &&
        snapshot.lapProgress < 0.08 &&
        now - this.raceStartTime > FINISH_MIN_RACE_MS
      ) {
        this.trigger('finish_line', true)
        this.finishPlayed = true
      }
    }

    this.prev = snapshot
  }

  /** Fire the right "finish flavour" clip after the player crosses the
   *  line. Caller decides which once final position + crashes are known. */
  triggerFinishOutcome(opts: { position: number; fieldSize: number; crashes: number }): void {
    const { position, fieldSize, crashes } = opts
    // Highest-tier celebration (overrides others).
    if (position === 1) {
      // Slight stagger so it doesn't tail-gate finish_line.
      window.setTimeout(() => this.trigger('great_finish', true), 1500)
    } else if (crashes >= 3 || position >= Math.max(3, fieldSize - 1)) {
      window.setTimeout(() => this.trigger('messy_finish', true), 1500)
    }
    // Podium reveal for any top-3, except P1 which already has its
    // dedicated victory clip.
    if (position > 1 && position <= 3) {
      window.setTimeout(() => this.trigger('podium_reveal', true), 3500)
    }
  }

  /** Reset all per-race state — call when the user restarts the race. */
  resetRace(): void {
    this.raceStartPlayed = false
    this.strongLaunchPlayed = false
    this.slowLaunchPlayed = false
    this.firstAccelPlayed = false
    this.firstCollisionPlayed = false
    this.halfwayPlayed = false
    this.finalTenPlayed = false
    this.finalPushPlayed = false
    this.finishPlayed = false
    this.wasOffTrack = false
    this.lastCrashCount = 0
    this.lastPosition = undefined
    this.sharpSteerSince = 0
    this.highSpeedSince = 0
    this.lowSpeedSince = 0
    this.raceStartTime = 0
    this.prev = null
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
    }
    this.clearCurrent()
  }

  dispose(): void {
    if (this.currentAudio) this.currentAudio.pause()
    for (const a of this.clips.values()) {
      a.pause()
      a.src = ''
    }
    this.clips.clear()
    this.clearCurrent()
  }
}
