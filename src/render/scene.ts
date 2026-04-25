import * as THREE from 'three'
import type { WeatherPreset } from './weather'

export interface SceneBundle {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  sun: THREE.DirectionalLight
  /** Call each frame with the player car's world position so the shadow
   *  camera frustum stays centred on it for crisp local shadows. */
  updateShadowFollow: (worldPos: THREE.Vector3) => void
  /** Re-tint sky / fog / sun / hemi from a weather preset. */
  applyWeather: (preset: WeatherPreset) => void
  resize: () => void
  render: () => void
  dispose: () => void
}

/** Procedurally builds a sky/ground equirect texture (256×128) we can run
 *  through PMREMGenerator. Cheap, ~3 ms at boot, no asset bytes. */
function buildSkyEquirect(): THREE.CanvasTexture {
  const w = 256
  const h = 128
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  // Vertical gradient: zenith → horizon sky → horizon haze → ground.
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0.0, '#3470b8') // zenith (deeper blue)
  g.addColorStop(0.45, '#a8d2ec') // horizon sky
  g.addColorStop(0.5, '#dcdab0') // sun-haze band
  g.addColorStop(0.55, '#7c8a55') // ground horizon
  g.addColorStop(1.0, '#3a4b22') // far ground
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // Add a soft sun spot so reflections show a highlight.
  const sunX = w * 0.65
  const sunY = h * 0.3
  const sunGrad = ctx.createRadialGradient(sunX, sunY, 1, sunX, sunY, 18)
  sunGrad.addColorStop(0, '#fff8d8')
  sunGrad.addColorStop(0.5, 'rgba(255,240,180,0.4)')
  sunGrad.addColorStop(1, 'rgba(255,240,180,0)')
  ctx.fillStyle = sunGrad
  ctx.fillRect(0, 0, w, h)

  const tex = new THREE.CanvasTexture(c)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function createScene(container: HTMLElement): SceneBundle {
  const scene = new THREE.Scene()
  // Bright daytime sky.
  scene.background = new THREE.Color('#87ceeb')
  scene.fog = new THREE.Fog('#cfe6f5', 400, 2500)

  const camera = new THREE.PerspectiveCamera(
    75,
    container.clientWidth / container.clientHeight,
    1.0, // bumped from 0.1 → 1.0 to give the depth buffer more precision in the far range
    5000,
  )
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
    // Vastly higher depth precision — eliminates z-fighting between
    // overlapping coplanar road segments (the T13 "shimmer").
    logarithmicDepthBuffer: true,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  // Direct sunlight — strong & warm. High contrast vs. fill light = crisp 3D.
  const sun = new THREE.DirectionalLight(0xfff2d4, 3.2)
  sun.position.set(80, 140, 60)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  // Tight frustum that follows the car (see updateShadowFollow). Default
  // covers ±50 m; higher resolution per texel = sharper car shadow.
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 400
  sun.shadow.camera.left = -50
  sun.shadow.camera.right = 50
  sun.shadow.camera.top = 50
  sun.shadow.camera.bottom = -50
  sun.shadow.bias = -0.0002
  sun.shadow.normalBias = 0.02
  scene.add(sun)
  scene.add(sun.target)

  // Sky/ground hemisphere fill — softer than before so direct sun owns the
  // contrast. Bluish from above, warm-green from below.
  const hemi = new THREE.HemisphereLight(0xbfdfff, 0x556a32, 0.7)
  scene.add(hemi)

  const ambient = new THREE.AmbientLight(0xffffff, 0.12)
  scene.add(ambient)
  renderer.toneMappingExposure = 1.15

  // --- Procedural sky env map: gives PBR materials proper reflections.
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const skyTex = buildSkyEquirect()
  const envRT = pmrem.fromEquirectangular(skyTex)
  scene.environment = envRT.texture
  skyTex.dispose()
  pmrem.dispose()

  const applyWeather = (preset: WeatherPreset): void => {
    if (scene.background instanceof THREE.Color) {
      scene.background.set(preset.sky)
    } else {
      scene.background = new THREE.Color(preset.sky)
    }
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.set(preset.fogColor)
      scene.fog.near = preset.fogNear
      scene.fog.far = preset.fogFar
    } else {
      scene.fog = new THREE.Fog(preset.fogColor, preset.fogNear, preset.fogFar)
    }
    sun.color.set(preset.sunColor)
    sun.intensity = preset.sunIntensity
    hemi.color.set(preset.hemiSky)
    hemi.groundColor.set(preset.hemiGround)
    hemi.intensity = preset.hemiIntensity
    renderer.toneMappingExposure = preset.exposure
  }

  const updateShadowFollow = (worldPos: THREE.Vector3): void => {
    // Re-centre the shadow camera frustum on the player so its 100×100 m
    // window of high-res shadow always contains the car + nearby road.
    sun.target.position.copy(worldPos)
    sun.position.set(worldPos.x + 80, 140, worldPos.z + 60)
    sun.target.updateMatrixWorld()
    sun.shadow.camera.updateProjectionMatrix()
  }

  const resize = (): void => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }

  const render = (): void => {
    renderer.render(scene, camera)
  }

  const dispose = (): void => {
    renderer.dispose()
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement)
    }
  }

  window.addEventListener('resize', resize)
  window.addEventListener('orientationchange', resize)

  return { scene, camera, renderer, sun, applyWeather, updateShadowFollow, resize, render, dispose }
}
