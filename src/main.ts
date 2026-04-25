import * as THREE from 'three'
import { installGlobalErrorHandlers, showToast } from './utils/error'
import { storage } from './utils/storage'
import { createScene } from './render/scene'
import { createTrack, type TrackBundle } from './render/track'
import { pickRandomWeather } from './render/weather'
import { createCar, type CarBundle } from './render/car'
import { createLightsRig, createCountdown } from './render/lights'
import { createPhysics, PHYS_MAX_SPEED, type PhysicsBundle } from './game/physics'
import { initInput, type InputController } from './input'
import { GameLoop } from './game/loop'
import { StateMachine, GameState, createInitialContext } from './game/state'
import { createMenu } from './ui/menu'
import { createHud } from './ui/hud'
import { createResult } from './ui/result'
import { SFX, unlockAudio } from './audio/zzfx'
import { createAudioRig, type AudioRig } from './audio/engine'
import { CommentarySystem } from './audio/commentary'
import {
  createOpponents,
  updateOpponent,
  progress as raceProgress,
  type OpponentState,
} from './game/opponents'
import { createOpponentCars, type OpponentCarBundle } from './render/opponentCars'

interface World {
  bundle: ReturnType<typeof createScene>
  track: TrackBundle
  car: CarBundle
  physics: PhysicsBundle
  input: InputController | null
  lightsRig: ReturnType<typeof createLightsRig> | null
  countdown: ReturnType<typeof createCountdown> | null
  audio: AudioRig | null
  commentary: CommentarySystem
  raceStart: number
  shakeT: number
  shakeMag: number
  jumpStartPenaltyMs: number
  opponents: OpponentState[]
  opponentCars: OpponentCarBundle | null
  /** Per-opponent debounce: seconds left before another bump can register. */
  opponentBumpCooldown: number[]
  /** Per-opponent: have they already finished the lap? Used so the win check
   *  doesn't fire repeatedly on the same AI after they cross the line. */
  opponentFinished: boolean[]
  finishedOrder: Array<'player' | number>
}

function bootstrap(): void {
  installGlobalErrorHandlers()

  const container = document.getElementById('app')
  if (!container) {
    console.warn('[F1S] #app missing')
    return
  }

  let bundle: ReturnType<typeof createScene>
  try {
    bundle = createScene(container)
  } catch (e) {
    console.warn('[F1S] scene init failed:', e)
    const detail =
      e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  width:100%;height:100%;color:#fff;font-size:14px;text-align:center;padding:24px;gap:12px;">
        <div style="font-size:18px;font-weight:700;">无法初始化 3D 引擎</div>
        <div style="color:#aaa;max-width:80%;word-break:break-word;">${detail}</div>
        <div style="color:#888;font-size:12px;margin-top:12px;">
          建议:用 <b>Chrome / Safari</b> 通过 <code>npm run dev</code> 或本地 http 打开,<br/>
          某些浏览器禁止 file:// 加载 WebGL。
        </div>
      </div>`
    return
  }

  // Build static world (track + car) once.
  const track = createTrack()
  bundle.scene.add(track.group)
  const car = createCar()
  bundle.scene.add(car.group)
  bundle.scene.add(car.particles)
  const physics = createPhysics(track)

  // Pick a random weather/time-of-day preset for this session and tint
  // sky / sun / hemi / clouds / haze accordingly.
  const weather = pickRandomWeather()
  bundle.applyWeather(weather)
  track.applyWeather(weather)
  console.log('[F1S] weather:', weather.id)
  setTimeout(() => showToast(`今日天气:${weather.label}`, 2400), 200)

  const world: World = {
    bundle,
    track,
    car,
    physics,
    input: null,
    lightsRig: null,
    countdown: null,
    audio: null,
    commentary: new CommentarySystem({ volume: 0.9 }),
    raceStart: 0,
    shakeT: 0,
    shakeMag: 0,
    jumpStartPenaltyMs: 0,
    opponents: [],
    opponentCars: null,
    opponentBumpCooldown: [],
    opponentFinished: [],
    finishedOrder: [],
  }

  // --- Commentary: preload clips eagerly, unlock on first user gesture.
  void world.commentary.preload()
  const unlockCommentary = (): void => world.commentary.unlock()
  window.addEventListener('pointerdown', unlockCommentary, { once: true })
  window.addEventListener('keydown', unlockCommentary, { once: true })
  window.addEventListener('touchstart', unlockCommentary, { once: true })

  // --- Corner detector. Samples the curve's tangent at the player's
  // projected t and t+ε to estimate local curvature κ ≈ Δheading / Δs;
  // a state machine fires first_corner / clean_corner / wide_corner.
  const CORNER_KAPPA_ENTER = 0.005 // ~R 200 m: anything tighter counts as cornering
  const CORNER_KAPPA_EXIT = 0.0025
  const CORNER_LOOKAHEAD = 12 // metres
  const cornerState = {
    inCorner: false,
    firstCornerPlayed: false,
    crashedThisCorner: false,
    wideThisCorner: false,
  }
  const sampleCurvature = (t: number): number => {
    const tg1 = track.getTangentAt(((t % 1) + 1) % 1)
    const ds = CORNER_LOOKAHEAD / track.length
    const tg2 = track.getTangentAt((((t + ds) % 1) + 1) % 1)
    const dot = Math.max(-1, Math.min(1, tg1.x * tg2.x + tg1.z * tg2.z))
    const ang = Math.acos(dot)
    return ang / CORNER_LOOKAHEAD
  }
  const updateCorner = (
    t: number,
    offset: number,
    crashed: boolean,
  ): void => {
    const kappa = sampleCurvature(t)
    if (!cornerState.inCorner) {
      if (kappa > CORNER_KAPPA_ENTER) {
        cornerState.inCorner = true
        cornerState.crashedThisCorner = crashed
        cornerState.wideThisCorner = false
        if (!cornerState.firstCornerPlayed) {
          world.commentary.trigger('first_corner', true)
          cornerState.firstCornerPlayed = true
        }
      }
    } else {
      // While in the corner, watch for "running wide" or a crash.
      if (offset > 7.0) cornerState.wideThisCorner = true
      if (crashed) cornerState.crashedThisCorner = true
      if (kappa < CORNER_KAPPA_EXIT) {
        // Corner exit — emit one of two outcome clips.
        if (cornerState.wideThisCorner) {
          world.commentary.trigger('wide_corner')
        } else if (!cornerState.crashedThisCorner) {
          world.commentary.trigger('clean_corner')
        }
        cornerState.inCorner = false
        cornerState.crashedThisCorner = false
        cornerState.wideThisCorner = false
      }
    }
  }
  const resetCornerState = (): void => {
    cornerState.inCorner = false
    cornerState.firstCornerPlayed = false
    cornerState.crashedThisCorner = false
    cornerState.wideThisCorner = false
  }

  const ctx = createInitialContext()
  const sm = new StateMachine(ctx)
  const menu = createMenu()
  const hud = createHud()
  hud.show() // visible from boot (kept on through MENU/RACE; only RESULT hides it)
  hud.update({ speedKmh: 0, lapMs: 0, mode: 'keyboard' })
  const result = createResult()

  // Helper: position car/camera at start.
  const placeCarAtStart = (): void => {
    physics.reset(track)
    car.group.position.copy(physics.state.pos)
    car.group.rotation.y = physics.state.heading
  }

  // Helper: tear down any existing opponent rig (cars + state).
  const teardownOpponents = (): void => {
    if (world.opponentCars) {
      bundle.scene.remove(world.opponentCars.group)
      world.opponentCars.dispose()
      world.opponentCars = null
    }
    world.opponents = []
    world.opponentBumpCooldown = []
    world.opponentFinished = []
    world.finishedOrder = []
  }

  // Helper: build 3 AIs at the chosen difficulty and add them to the scene.
  const spawnOpponents = (): void => {
    teardownOpponents()
    world.opponents = createOpponents(track, ctx.difficulty)
    world.opponentCars = createOpponentCars(world.opponents)
    bundle.scene.add(world.opponentCars.group)
    world.opponentCars.update(world.opponents)
    world.opponentBumpCooldown = world.opponents.map(() => 0)
    world.opponentFinished = world.opponents.map(() => false)
    world.finishedOrder = []
  }

  /** Compute current ranking — total race progress (lap + t). */
  const computePosition = (): { position: number; fieldSize: number } => {
    const playerProg = physics.state.lapsCompleted + physics.state.lapProgress
    let ahead = 0
    for (const opp of world.opponents) {
      if (raceProgress(opp) > playerProg) ahead++
    }
    return {
      position: ahead + 1,
      fieldSize: world.opponents.length + 1,
    }
  }

  // Press M to toggle overview camera (top-down, full track visible).
  let overviewMode = false
  let accelLerp = 0 // 0 = normal cruise distance, 1 = close-in accelerating distance
  let savedFog: THREE.Fog | THREE.FogExp2 | null = null
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'm' || ev.key === 'M') {
      overviewMode = !overviewMode
      if (overviewMode) {
        savedFog = bundle.scene.fog
        bundle.scene.fog = null // fog would solid-color the whole bird's-eye view
        bundle.camera.fov = 50
      } else {
        bundle.scene.fog = savedFog
      }
    }
  })

  // Compute track bbox once (excluding the giant ground plane).
  const trackBbox = new THREE.Box3()
  // Sample the curve directly so the ground plane doesn't blow up the bbox.
  for (let i = 0; i < 200; i++) {
    trackBbox.expandByPoint(track.getPositionAt(i / 200))
  }

  const updateCamera = (): void => {
    if (overviewMode) {
      const size = trackBbox.getSize(new THREE.Vector3())
      const center = trackBbox.getCenter(new THREE.Vector3())
      const half = Math.max(size.x, size.z) * 0.65
      const dist = half / Math.tan(((bundle.camera.fov / 2) * Math.PI) / 180)
      bundle.camera.position.set(center.x, dist, center.z + 1)
      bundle.camera.lookAt(center.x, 0, center.z)
      bundle.camera.updateProjectionMatrix()
      return
    }

    const { pos, heading, speed } = physics.state
    // Camera rig: normal cruise sits 4.5 m back at 2.2 m height. While the
    // player is actively accelerating (throttle > cruise baseline), shrink
    // both to 1/3 so the car doesn't visibly run away forward.
    const inp = world.input?.getInput()
    const accelTarget = inp && inp.throttle > 0.7 ? 1 : 0
    accelLerp += (accelTarget - accelLerp) * 0.08 // smooth blend
    // Cruise / countdown sits at 4 m; accelerating pulls the camera back to 5 m.
    const backDist = 4 + accelLerp * (5 - 4)
    const upDist = 2.2

    const back = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading))
    const camPos = pos.clone().addScaledVector(back, backDist).add(new THREE.Vector3(0, upDist, 0))
    bundle.camera.position.lerp(camPos, 0.2)
    // Hard clamp: lerp lag at high speed would otherwise drag the camera
    // many metres beyond the intended `backDist`. Keep the horizontal
    // distance to the car at backDist max.
    const dx = bundle.camera.position.x - pos.x
    const dz = bundle.camera.position.z - pos.z
    const horiz = Math.sqrt(dx * dx + dz * dz)
    if (horiz > backDist) {
      const k = backDist / horiz
      bundle.camera.position.x = pos.x + dx * k
      bundle.camera.position.z = pos.z + dz * k
    }
    const look = pos.clone().addScaledVector(back.negate(), 6)
    look.y += 0.6
    bundle.camera.lookAt(look)
    const targetFov = 60 + (speed / PHYS_MAX_SPEED) * 20
    bundle.camera.fov += (targetFov - bundle.camera.fov) * 0.1
    if (world.shakeT > 0) {
      bundle.camera.position.x += (Math.random() - 0.5) * world.shakeMag
      bundle.camera.position.y += (Math.random() - 0.5) * world.shakeMag
      world.shakeT -= 1 / 60
      world.shakeMag *= 0.85
    }
    bundle.camera.updateProjectionMatrix()
  }

  const triggerShake = (mag: number, durationS: number): void => {
    world.shakeMag = mag
    world.shakeT = durationS
  }

  // ---------------- States ----------------
  sm.register(GameState.MENU, {
    enter: () => {
      placeCarAtStart()
      // Showcase camera: orbit-style 3/4 view of the car at the start grid.
      const carP = car.group.position
      const tg = track.getTangentAt(0)
      const lat = new THREE.Vector3(-tg.z, 0, tg.x).normalize()
      const back = new THREE.Vector3(-tg.x, 0, -tg.z).normalize()
      bundle.camera.position
        .copy(carP)
        .addScaledVector(back, 6)
        .addScaledVector(lat, 4)
        .add(new THREE.Vector3(0, 3.5, 0))
      bundle.camera.lookAt(carP.x, carP.y + 0.6, carP.z)
      menu.show(async ({ difficulty, inputMode }) => {
        ctx.difficulty = difficulty
        SFX.uiClick()
        unlockAudio()
        // Boot the engine + BGM rig from inside the click handler so iOS
        // unlocks AudioContext on the same gesture.
        try {
          if (!world.audio) {
            world.audio = await createAudioRig()
            world.audio.start()
          }
        } catch (e) {
          console.warn('[F1S] audio rig init failed:', e)
        }
        try {
          world.input = await initInput(inputMode)
          ctx.inputMode = world.input.mode
          if (world.input.mode === 'keyboard') {
            showToast('键盘控制:↑/W 油门,↓/S 刹车,←→/A D 转向,Shift = DRS')
          } else if (world.input.mode === 'touch') {
            showToast('触屏模式:左右半屏转向 + 油门')
          } else if (world.input.mode === 'gyro') {
            if (world.input.gyroSource === 'mouse') {
              showToast('鼠标摇杆:鼠标偏屏幕中心 = 推摇杆。上=加速,下=刹车,左右=转向')
            } else {
              showToast('体感模式:左右倾 = 转向,前倾 = 加速,后倾 = 刹车')
            }
          }
          if (inputMode === 'gyro' && world.input.mode !== 'gyro') {
            showToast('体感不可用,已回退到默认控制')
          }
        } catch (e) {
          console.warn('[F1S] input init failed:', e)
          ctx.inputMode = 'touch'
        }
        // Skip SCAN/PICK_TEAM for MVP wiring; jump straight to countdown.
        // (Those are P1 prompts to land in the next pass.)
        ctx.playerData.team = ctx.playerData.team ?? storage.getTeam() ?? 'ferrari'
        car.setLivery(ctx.playerData.team)
        await sm.transition(GameState.SCAN)
      })
    },
    exit: () => menu.hide(),
  })

  sm.register(GameState.SCAN, {
    enter: async () => {
      // P1 placeholder: brief beat then advance.
      showToast('扫脸阶段(占位,P1 接入)')
      await new Promise<void>((res) => setTimeout(res, 600))
      await sm.transition(GameState.PICK_TEAM)
    },
  })

  sm.register(GameState.PICK_TEAM, {
    enter: async () => {
      // P1 placeholder: keep team from storage / default; ensure livery is applied.
      if (ctx.playerData.team) car.setLivery(ctx.playerData.team)
      await new Promise<void>((res) => setTimeout(res, 200))
      await sm.transition(GameState.COUNTDOWN)
    },
  })

  sm.register(GameState.COUNTDOWN, {
    enter: async () => {
      placeCarAtStart()
      spawnOpponents()
      // Commentator kicks off the build-up.
      world.commentary.unlock()
      world.commentary.trigger('countdown', true)
      // Snap camera to chase position (4 m back, 2.2 m up) so the
      // countdown view doesn't lerp in from the MENU 3/4 orbit shot.
      accelLerp = 0
      const carP = car.group.position
      const heading = physics.state.heading
      const back = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading))
      bundle.camera.position
        .copy(carP)
        .addScaledVector(back, 4)
        .add(new THREE.Vector3(0, 2.2, 0))
      const look = carP.clone().addScaledVector(back.negate(), 6)
      look.y += 0.6
      bundle.camera.lookAt(look)

      hud.show()
      hud.update({
        speedKmh: 0,
        lapMs: 0,
        mode: ctx.inputMode,
      })
      // Build lights rig at start gantry
      const startPos = track.getPositionAt(0).clone()
      const tg = track.getTangentAt(0)
      const yaw = Math.atan2(tg.x, tg.z)
      // Place lights slightly ahead of start so player sees them
      startPos.addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 12)
      world.lightsRig = createLightsRig(startPos, yaw)
      bundle.scene.add(world.lightsRig.group)

      world.countdown = createCountdown(
        world.lightsRig,
        (n) => {
          SFX.countdownBeep()
          if (navigator.vibrate) navigator.vibrate(60 + n * 20)
          hud.flash(`${n}`, '#ff3b30', 400)
        },
        () => {
          SFX.lightsOut()
          // engineStart ZzFX removed — real engine sample handles startup
          if (navigator.vibrate) navigator.vibrate([0, 200, 50, 100, 30, 150])
          triggerShake(0.4, 0.4)
          hud.flash('GO!', '#00d2be', 800)
          world.raceStart = performance.now() + world.jumpStartPenaltyMs
          void sm.transition(GameState.RACE)
        },
        () => {
          // Jump start
          SFX.jumpStart()
          hud.flash('JUMP START -2.0s', '#ff1801', 1200)
          world.jumpStartPenaltyMs += 2000
          // Restart countdown sequence by recreating it
          if (world.lightsRig) world.lightsRig.setLitCount(0)
          // simple restart: discard current countdown; new one created on next tick
          if (world.countdown) world.countdown.destroy()
          world.countdown = null
          setTimeout(() => {
            if (sm.context().state !== GameState.COUNTDOWN) return
            if (!world.lightsRig) return
            world.countdown = createCountdown(
              world.lightsRig,
              (n) => SFX.countdownBeep() ?? hud.flash(`${n}`, '#ff3b30', 400),
              () => {
                SFX.lightsOut()
                triggerShake(0.4, 0.4)
                hud.flash('GO!', '#00d2be', 800)
                world.raceStart = performance.now() + world.jumpStartPenaltyMs
                void sm.transition(GameState.RACE)
              },
              () => {
                /* nested jump-start ignored for MVP */
              },
            )
          }, 800)
        },
      )
    },
    update: (_, dt) => {
      world.countdown?.update(dt)
      if (world.input) {
        const inp = world.input.getInput()
        world.countdown?.setThrottlePressed(inp.throttle > 0.7 || inp.drs)
      }
      updateCamera()
    },
    exit: () => {
      // Lights rig stays visible briefly; remove on RACE entry instead.
    },
  })

  sm.register(GameState.RACE, {
    enter: () => {
      if (world.lightsRig) {
        bundle.scene.remove(world.lightsRig.group)
        world.lightsRig.dispose()
        world.lightsRig = null
      }
      ctx.raceData.startTime = world.raceStart
      ctx.raceData.crashes = 0
      ctx.raceData.topSpeed = 0
      ctx.raceData.opponentHits = 0
      ctx.raceData.finalPosition = 0
      world.commentary.resetRace()
      world.commentary.unlock() // countdown click already happened
      world.commentary.trigger('race_start', true)
      resetCornerState()
    },
    update: (_, dt) => {
      if (!world.input) return
      const inp = world.input.getInput()
      const wasCrashed = physics.state.crashed
      physics.update(dt, inp, track)
      if (!wasCrashed && physics.state.crashed) {
        SFX.crash()
        triggerShake(0.6, 0.5)
        if (navigator.vibrate) navigator.vibrate(150)
        ctx.raceData.crashes++
        car.emitSparks(physics.state.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 32)
      }
      car.group.position.copy(physics.state.pos)
      car.group.rotation.y = physics.state.heading
      const speed01 = physics.state.speed / PHYS_MAX_SPEED
      car.update(dt, speed01)

      // --- Opponents: drive around the track and detect AI body bumps.
      const COLLIDE_DIST = 3.5 // metres: car length / 2 + buffer
      const COLLIDE_DIST_SQ = COLLIDE_DIST * COLLIDE_DIST
      const BUMP_COOLDOWN_S = 0.8
      const playerProgress = physics.state.lapsCompleted + physics.state.lapProgress
      for (let i = 0; i < world.opponents.length; i++) {
        const opp = world.opponents[i]
        // Stop AIs from running past the line indefinitely so the field
        // settles at the finish — they decelerate after their first lap.
        if (world.opponentFinished[i]) {
          opp.speed *= 0.97
          const tg = track.getTangentAt(opp.t)
          opp.pos.x += tg.x * opp.speed * dt
          opp.pos.z += tg.z * opp.speed * dt
        } else {
          updateOpponent(opp, dt, track, playerProgress)
          // Visual + audio feedback when an AI fumbles a corner.
          if (opp.mistakeJustTriggered) {
            SFX.crash()
            car.emitSparks(opp.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 16)
          }
          if (opp.lap >= 1) {
            world.opponentFinished[i] = true
            world.finishedOrder.push(i)
          }
        }
        // Physical body collision: separate cars every frame they overlap,
        // count it as one bump per cooldown window, slow both cars.
        if (world.opponentBumpCooldown[i] > 0) {
          world.opponentBumpCooldown[i] -= dt
        }
        const dx = physics.state.pos.x - opp.pos.x
        const dz = physics.state.pos.z - opp.pos.z
        const distSq = dx * dx + dz * dz
        if (distSq < COLLIDE_DIST_SQ && !physics.state.crashed) {
          const dist = Math.max(Math.sqrt(distSq), 0.01)
          const nx = dx / dist
          const nz = dz / dist

          // Hard separation — push player out so cars never interpenetrate.
          physics.state.pos.x = opp.pos.x + nx * COLLIDE_DIST
          physics.state.pos.z = opp.pos.z + nz * COLLIDE_DIST

          if (world.opponentBumpCooldown[i] <= 0) {
            ctx.raceData.opponentHits++
            world.opponentBumpCooldown[i] = BUMP_COOLDOWN_S
            SFX.crash()
            triggerShake(0.55, 0.45)
            if (navigator.vibrate) navigator.vibrate(120)
            car.emitSparks(
              physics.state.pos.clone().add(new THREE.Vector3(0, 0.3, 0)),
              28,
            )
            // Player loses momentum on contact.
            physics.state.speed *= 0.55
            // Bounce heading slightly away from contact normal.
            const fx = Math.sin(physics.state.heading)
            const fz = Math.cos(physics.state.heading)
            const cross = fx * nz - fz * nx
            physics.state.heading += Math.sign(cross) * 0.10
            // AI also takes a hit: brief slowdown + wobble.
            opp.speed *= 0.65
            if (opp.mistakeRemaining < 0.5) opp.mistakeRemaining = 0.5
          }
        }
      }
      if (world.opponentCars) world.opponentCars.update(world.opponents)

      // --- Commentary feed: build a snapshot for the auto-detector.
      const _rank = computePosition()
      const _proj = track.projectToTrack(physics.state.pos)
      updateCorner(_proj.t, _proj.offset, physics.state.crashed)
      world.commentary.update({
        time: performance.now(),
        raceState: 'running',
        speed: physics.state.speed,
        steeringAbs: Math.abs(inp.steer),
        trackOffset: _proj.offset,
        offTrack: physics.state.crashed,
        crashCount: ctx.raceData.crashes + ctx.raceData.opponentHits,
        lapProgress: physics.state.lapProgress,
        lapCount: physics.state.lapsCompleted,
        position: _rank.position,
        fieldSize: _rank.fieldSize,
      })

      // HUD
      const lapMs = performance.now() - ctx.raceData.startTime
      const rank = computePosition()
      hud.update({
        speedKmh: physics.state.speed * 3.6,
        lapMs: Math.max(0, lapMs),
        mode: ctx.inputMode,
        gyroSource: world.input?.gyroSource ?? null,
        position: rank.position,
        fieldSize: rank.fieldSize,
      })
      ctx.raceData.topSpeed = physics.state.topSpeed * 3.6
      updateCamera()

      // Finish: first car (player or AI) to complete one lap ends the race.
      if (physics.state.lapsCompleted >= 1) {
        ctx.raceData.bestLap = lapMs
        ctx.raceData.finalPosition = rank.position
        void sm.transition(GameState.FINISH)
      } else if (world.opponentFinished.every((f) => f)) {
        // All AIs have finished and player is still going — player is last.
        ctx.raceData.bestLap = lapMs
        ctx.raceData.finalPosition = world.opponents.length + 1
        void sm.transition(GameState.FINISH)
      }
    },
  })

  sm.register(GameState.FINISH, {
    enter: async () => {
      SFX.finishHorn()
      world.commentary.trigger('finish_line', true)
      // Tail-end commentary depends on outcome (P1, podium, messy, etc.).
      world.commentary.triggerFinishOutcome({
        position: ctx.raceData.finalPosition || world.opponents.length + 1,
        fieldSize: world.opponents.length + 1,
        crashes: ctx.raceData.crashes + ctx.raceData.opponentHits,
      })
      triggerShake(0.3, 0.6)
      hud.flash('FINISH!', '#00d2be', 1200)
      await new Promise<void>((res) => setTimeout(res, 1500))
      await sm.transition(GameState.RESULT)
    },
    update: (_, dt) => {
      // Keep the car drifting forward visually
      physics.state.speed *= 0.97
      const tg = track.getTangentAt(physics.state.lapProgress)
      physics.state.pos.x += tg.x * physics.state.speed * dt
      physics.state.pos.z += tg.z * physics.state.speed * dt
      car.group.position.copy(physics.state.pos)
      const speed01 = physics.state.speed / PHYS_MAX_SPEED
      car.update(dt, speed01)
      // Coast opponent cars too so the field doesn't visibly freeze.
      for (let i = 0; i < world.opponents.length; i++) {
        const opp = world.opponents[i]
        if (world.opponentFinished[i]) {
          opp.speed *= 0.97
        } else {
          updateOpponent(opp, dt, track)
        }
        const tgo = track.getTangentAt(opp.t)
        opp.pos.x += tgo.x * opp.speed * dt * 0.2
        opp.pos.z += tgo.z * opp.speed * dt * 0.2
      }
      if (world.opponentCars) world.opponentCars.update(world.opponents)
      updateCamera()
    },
  })

  sm.register(GameState.RESULT, {
    enter: () => {
      hud.hide()
      const lap = ctx.raceData.bestLap ?? 0
      const prev = storage.getBestLap()
      // Only count it as a PB if the player actually won the race.
      const wonRace = ctx.raceData.finalPosition === 1
      const isPB = wonRace && (prev === null || lap < prev)
      if (isPB && lap > 0) storage.setBestLap(lap)
      storage.incRuns()
      if (ctx.playerData.team) storage.setTeam(ctx.playerData.team)
      result.show({
        lapMs: lap,
        topSpeedKmh: ctx.raceData.topSpeed,
        crashes: ctx.raceData.crashes,
        opponentHits: ctx.raceData.opponentHits,
        position: ctx.raceData.finalPosition || world.opponents.length + 1,
        fieldSize: world.opponents.length + 1,
        isPB,
        onRestart: () => {
          result.hide()
          world.jumpStartPenaltyMs = 0
          void sm.transition(GameState.COUNTDOWN)
        },
        onMenu: () => {
          result.hide()
          world.jumpStartPenaltyMs = 0
          ctx.raceData.bestLap = null
          teardownOpponents()
          void sm.transition(GameState.MENU)
        },
      })
    },
    exit: () => result.hide(),
  })

  // ---------------- Loop ----------------
  const loop = new GameLoop((dt) => {
    sm.update(dt)
    track.updateAtmosphere(dt)
    bundle.updateShadowFollow(physics.state.pos)
    if (world.audio) {
      const inp = world.input?.getInput()
      const throttle = inp?.throttle ?? 0
      const speed01 = physics.state.speed / PHYS_MAX_SPEED
      world.audio.setEngine(throttle, speed01)
    }
    bundle.render()
  })
  loop.start()

  void sm.transition(GameState.MENU)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true })
} else {
  bootstrap()
}
