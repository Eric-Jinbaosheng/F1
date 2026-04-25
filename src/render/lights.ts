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
  group.position.y = 7
  group.rotation.y = yaw
  group.name = 'lights'

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

  const lamps: { mesh: THREE.Mesh; light: THREE.PointLight }[] = []
  const sphere = new THREE.SphereGeometry(0.4, 16, 12)

  for (let i = 0; i < 5; i++) {
    const mesh = new THREE.Mesh(sphere, offMat)
    mesh.position.set(-2 + i * 1, 0, 0)
    group.add(mesh)
    const light = new THREE.PointLight('#ff2200', 0, 10)
    light.position.copy(mesh.position)
    group.add(light)
    lamps.push({ mesh, light })
  }

  // Mount bar
  const barGeo = new THREE.BoxGeometry(6, 0.2, 0.5)
  const barMat = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.6 })
  const bar = new THREE.Mesh(barGeo, barMat)
  bar.position.y = 0.5
  group.add(bar)

  const setLitCount = (n: number): void => {
    for (let i = 0; i < 5; i++) {
      const lit = i < n
      lamps[i].mesh.material = lit ? onMat : offMat
      lamps[i].light.intensity = lit ? 3 : 0
    }
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
      barGeo.dispose()
      barMat.dispose()
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

const LAMP_INTERVAL_MS = 800
const HOLD_MIN_MS = 500
const HOLD_MAX_MS = 1500

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
      throttlePressed  // referenced for ts noUnused
    },
    isFinished: () => phase === 'done',
    hasJumpStart: () => jumpStarted,
    destroy: () => {
      /* noop */
    },
  }
}
