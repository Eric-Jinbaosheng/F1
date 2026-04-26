import * as THREE from 'three'

export interface LightsBundle {
  group: THREE.Group
  setLitCount: (n: number) => void // 0..5
  setAllOff: () => void
  dispose: () => void
}

export function createLightsRig(anchor: THREE.Vector3, yaw: number): LightsBundle {
  const group = new THREE.Group()
  group.position.copy(anchor)
  group.position.y = 0
  group.rotation.y = yaw
  group.name = 'lights'

  // Local frame after group.rotation.y = yaw:
  //   +Z = race-forward, +X = "right" of track
  // Posts straddle the road; the lamp beam spans between them.
  const POST_X = 8 // ROAD_HALF_WIDTH (7) + 1 m clearance
  const LAMP_Y = 9.5 // raised so the taller 4-row block clears the road by a wide margin
  const COL_DX = 1.2 // horizontal spacing between the 5 lamp columns
  const LED_DY = 0.75 // vertical spacing between adjacent rows (more visible separation)
  const LED_R = 0.28
  const ROWS = 4 // F1 spec: 5 columns × 4 rows. Top two rows stay off; bottom
                 // two rows are the ones that animate during the start sequence.
  const ACTIVE_ROWS_FROM_BOTTOM = 2
  // ROWS y-range: rows 0..3, top row at LAMP_Y + 1.5*LED_DY, bottom row at
  // LAMP_Y - 1.5*LED_DY. We index rows top-first (row 0 = top).
  const rowY = (row: number): number => LAMP_Y + (1.5 - row) * LED_DY
  const blockH = (ROWS - 1) * LED_DY + 1.1 // backplate / housing vertical span
  const BEAM_Y = LAMP_Y + blockH / 2 + 0.6 // beam sits above the lamp block
  const POST_TOP_Y = BEAM_Y + 0.4
  const POST_THICK = 0.4

  const offMat = new THREE.MeshStandardMaterial({
    color: '#220000',
    emissive: '#000',
    roughness: 0.4,
  })
  const onMat = new THREE.MeshStandardMaterial({
    color: '#ff0000',
    emissive: '#ff2200',
    emissiveIntensity: 2.0,
    roughness: 0.3,
  })
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.7 })

  // The lights face the cars: cars sit behind the gantry on the local -Z
  // side, so the LEDs go on the front face (slightly negative Z) and the
  // dark housing / backplate sit BEHIND the LEDs (positive Z) where they
  // can't occlude the bulbs.

  // ---- Frame: backplate + per-column housings (rendered first so the
  //      lamps draw on top).
  const plateW = COL_DX * 5 + 0.6
  const plateGeo = new THREE.BoxGeometry(plateW, blockH, 0.25)
  const plate = new THREE.Mesh(plateGeo, frameMat)
  plate.position.set(0, LAMP_Y, 0.25)
  group.add(plate)
  // Per-column housing rectangles framing each column's 4 LEDs.
  const cellGeo = new THREE.BoxGeometry(COL_DX * 0.78, blockH - 0.15, 0.18)
  const firstX = -((5 - 1) * COL_DX) / 2 // centre the 5 columns over the road
  for (let i = 0; i < 5; i++) {
    const x = firstX + i * COL_DX
    const cell = new THREE.Mesh(cellGeo, frameMat)
    cell.position.set(x, LAMP_Y, 0.05)
    group.add(cell)
  }

  // ---- 5 columns × 4 rows = 20 LEDs (matches real F1 starting-lights).
  //      During the start sequence ONLY the bottom 2 rows animate; the top
  //      2 rows stay dark (decorative — they're for the team end of the
  //      track for the warm-up lap and similar uses).
  interface LedRef {
    mesh: THREE.Mesh
    light: THREE.PointLight | null
    active: boolean // bottom-two-row LEDs are the ones we animate
  }
  const sphere = new THREE.SphereGeometry(LED_R, 16, 12)
  const buildLed = (x: number, y: number, active: boolean): LedRef => {
    const mesh = new THREE.Mesh(sphere, offMat)
    // Slightly negative Z = front of the gantry, facing the cars.
    mesh.position.set(x, y, -0.18)
    group.add(mesh)
    let light: THREE.PointLight | null = null
    if (active) {
      light = new THREE.PointLight('#ff2200', 0, 8)
      light.position.copy(mesh.position)
      // Push the point light toward the cars so its illumination falls on
      // the road, not the housing behind.
      light.position.z -= 0.4
      group.add(light)
    }
    return { mesh, light, active }
  }

  // columns[col] = [row0=top, row1, row2, row3=bottom]
  const columns: LedRef[][] = []
  for (let i = 0; i < 5; i++) {
    const x = firstX + i * COL_DX
    const rows: LedRef[] = []
    for (let r = 0; r < ROWS; r++) {
      // Active = bottom ACTIVE_ROWS_FROM_BOTTOM rows (indices ROWS-1 ..
      // ROWS-ACTIVE_ROWS_FROM_BOTTOM).
      const active = r >= ROWS - ACTIVE_ROWS_FROM_BOTTOM
      rows.push(buildLed(x, rowY(r), active))
    }
    columns.push(rows)
  }

  // Horizontal beam spanning the two posts.
  const beamGeo = new THREE.BoxGeometry(POST_X * 2, 0.4, 0.5)
  const beam = new THREE.Mesh(beamGeo, frameMat)
  beam.position.y = BEAM_Y
  beam.castShadow = true
  group.add(beam)

  // Two vertical posts.
  const postGeo = new THREE.BoxGeometry(POST_THICK, POST_TOP_Y, POST_THICK)
  const leftPost = new THREE.Mesh(postGeo, frameMat)
  leftPost.position.set(-POST_X, POST_TOP_Y / 2, 0)
  leftPost.castShadow = true
  group.add(leftPost)
  const rightPost = new THREE.Mesh(postGeo, frameMat)
  rightPost.position.set(POST_X, POST_TOP_Y / 2, 0)
  rightPost.castShadow = true
  group.add(rightPost)

  // Two short hangers from beam down to the backplate.
  const hangerGeo = new THREE.BoxGeometry(0.18, BEAM_Y - (LAMP_Y + blockH / 2), 0.18)
  const hangerY = (BEAM_Y + (LAMP_Y + blockH / 2)) / 2
  for (const x of [-COL_DX * 1.5, COL_DX * 1.5]) {
    const h = new THREE.Mesh(hangerGeo, frameMat)
    h.position.set(x, hangerY, 0)
    group.add(h)
  }

  const setColumnLit = (col: number, lit: boolean): void => {
    // Only the active LEDs (bottom 2 rows) animate; inactive LEDs always
    // stay on offMat so they read as dim glass next to the lit pair.
    for (const led of columns[col]) {
      if (!led.active) continue
      led.mesh.material = lit ? onMat : offMat
      if (led.light) led.light.intensity = lit ? 2 : 0
    }
  }

  const setLitCount = (n: number): void => {
    for (let i = 0; i < 5; i++) setColumnLit(i, i < n)
  }
  const setAllOff = (): void => setLitCount(0)

  return {
    group,
    setLitCount,
    setAllOff,
    dispose: () => {
      sphere.dispose()
      offMat.dispose()
      onMat.dispose()
      frameMat.dispose()
      plateGeo.dispose()
      cellGeo.dispose()
      beamGeo.dispose()
      postGeo.dispose()
      hangerGeo.dispose()
    },
  }
}

export interface CountdownController {
  update: (dt: number) => void
  isFinished: () => boolean
  hasJumpStart: () => boolean
  setThrottlePressed: (pressed: boolean) => void
  destroy: () => void
}

const LAMP_INTERVAL_MS = 1000 // FIA spec: ~1 s between each red light coming on
// FIA spec: random hold 0.2 – 3.0 s after all 5 reds are lit before they go out.
const HOLD_MIN_MS = 200
const HOLD_MAX_MS = 3000

export function createCountdown(
  rig: LightsBundle,
  onLampLit: (n: number) => void,
  onLightsOut: () => void,
  onJumpStart: () => void,
): CountdownController {
  let elapsed = 0
  let phase: 'lighting' | 'hold' | 'done' = 'lighting'
  let lit = 0
  let nextLampAt = LAMP_INTERVAL_MS
  let holdDuration = 0
  let throttlePressed = false
  let jumpStarted = false

  rig.setLitCount(0)

  return {
    setThrottlePressed: (p: boolean) => {
      throttlePressed = p
      // Jump start window: any time during lighting OR hold (i.e., before lights-out)
      if ((phase === 'lighting' || phase === 'hold') && p && lit > 0 && !jumpStarted) {
        jumpStarted = true
        onJumpStart()
      }
    },
    update: (dt: number) => {
      if (phase === 'done') return
      elapsed += dt * 1000
      if (phase === 'lighting') {
        while (lit < 5 && elapsed >= nextLampAt) {
          lit++
          rig.setLitCount(lit)
          onLampLit(lit)
          nextLampAt += LAMP_INTERVAL_MS
        }
        if (lit >= 5) {
          phase = 'hold'
          holdDuration = HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS)
          elapsed = 0
        }
      } else if (phase === 'hold') {
        if (elapsed >= holdDuration) {
          phase = 'done'
          rig.setAllOff()
          onLightsOut()
        }
      }
      throttlePressed // referenced for ts noUnused
    },
    isFinished: () => phase === 'done',
    hasJumpStart: () => jumpStarted,
    destroy: () => {
      /* noop */
    },
  }
}
