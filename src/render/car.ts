import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { TeamId } from '../utils/storage'
import { showToast } from '../utils/error'
import carGlbUrl from '../assets/models/RB19_REDBULL.opt.glb?url'

export const TEAM_COLORS: Record<TeamId, { primary: string; secondary: string; spark: string }> = {
  merc: { primary: '#00d2be', secondary: '#181818', spark: '#a8fff5' },
  ferrari: { primary: '#dc0000', secondary: '#ffee00', spark: '#ffd870' },
  redbull: { primary: '#1e41ff', secondary: '#ffeb00', spark: '#ffe770' },
  mclaren: { primary: '#ff8000', secondary: '#0090d0', spark: '#ffd0a0' },
}

export interface CarBundle {
  group: THREE.Group
  /** World-space particle layer; add to the scene next to `group`. */
  particles: THREE.Group
  setLivery: (team: TeamId) => void
  emitSpeedTrail: (intensity: number) => void
  emitSparks: (worldPos: THREE.Vector3, count: number) => void
  update: (dt: number, speed01: number) => void
  dispose: () => void
}

const PARTICLE_MAX = 256
const PARTICLE_LIFE = 1.0
const TARGET_LENGTH_M = 5.0 // real F1 ≈ 5.5 m; pick 5 to feel right against 16 m wide road

interface PlaceholderRefs {
  group: THREE.Group
  wheels: THREE.Mesh[]
  bodyMat: THREE.MeshPhysicalMaterial
  accentMat: THREE.MeshPhysicalMaterial
  tireMat: THREE.MeshStandardMaterial
  geos: THREE.BufferGeometry[]
}

function buildPlaceholder(): PlaceholderRefs {
  const group = new THREE.Group()
  group.name = 'car-placeholder'

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: '#dc0000',
    metalness: 0.9,
    roughness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  })
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: '#181818',
    metalness: 0.6,
    roughness: 0.4,
  })
  const tireMat = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.95 })

  const geos: THREE.BufferGeometry[] = []
  const addMesh = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot?: [number, number, number],
  ): THREE.Mesh => {
    geos.push(geo)
    const m = new THREE.Mesh(geo, mat)
    m.position.set(...pos)
    if (rot) m.rotation.set(...rot)
    m.castShadow = true
    group.add(m)
    return m
  }

  addMesh(new THREE.BoxGeometry(1.6, 0.35, 4.4), bodyMat, [0, 0.35, 0])
  addMesh(new THREE.TorusGeometry(0.55, 0.05, 8, 24, Math.PI), accentMat, [0, 0.85, 0], [Math.PI / 2, 0, 0])
  addMesh(new THREE.SphereGeometry(0.28, 12, 10), accentMat, [0, 0.85, 0.1])
  addMesh(new THREE.ConeGeometry(0.4, 1.4, 8), bodyMat, [0, 0.4, 2.6], [Math.PI / 2, 0, 0])
  addMesh(new THREE.BoxGeometry(2.0, 0.06, 0.4), bodyMat, [0, 0.18, 2.4])
  addMesh(new THREE.BoxGeometry(1.6, 0.6, 0.08), bodyMat, [0, 0.95, -2.0])
  addMesh(new THREE.BoxGeometry(0.05, 0.5, 0.4), accentMat, [0, 0.6, -1.85])

  const wheels: THREE.Mesh[] = []
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 16)
  geos.push(wheelGeo)
  for (const [x, z] of [
    [-0.95, 1.6],
    [0.95, 1.6],
    [-0.95, -1.6],
    [0.95, -1.6],
  ] as [number, number][]) {
    const w = new THREE.Mesh(wheelGeo, tireMat)
    w.rotation.z = Math.PI / 2
    w.position.set(x, 0.45, z)
    w.castShadow = true
    wheels.push(w)
    group.add(w)
  }

  return { group, wheels, bodyMat, accentMat, tireMat, geos }
}

function disposePlaceholder(refs: PlaceholderRefs): void {
  for (const g of refs.geos) g.dispose()
  refs.bodyMat.dispose()
  refs.accentMat.dispose()
  refs.tireMat.dispose()
}

/** Auto-orient & scale a freshly loaded GLB so wheels touch y=0 and nose points +Z. */
function fitGltfToTrack(model: THREE.Object3D): void {
  // Initial bbox at native scale & orientation.
  let bbox = new THREE.Box3().setFromObject(model)
  let size = bbox.getSize(new THREE.Vector3())

  // Scale by planar (x,z) length to 5 m. Using max(x,y,z) lets a tall rear
  // wing inflate the bbox and shrink the actual on-track footprint, which
  // makes some packs (e.g. McLaren MCL35M) visibly smaller than others.
  const planarLongest = Math.max(size.x, size.z)
  if (planarLongest > 0) {
    const s = TARGET_LENGTH_M / planarLongest
    model.scale.setScalar(s)
  }

  // Recompute after scale.
  bbox = new THREE.Box3().setFromObject(model)
  size = bbox.getSize(new THREE.Vector3())
  const center = bbox.getCenter(new THREE.Vector3())

  // Center horizontally; bottom on y=0.
  model.position.x -= center.x
  model.position.y -= bbox.min.y
  model.position.z -= center.z

  // Game forward = +Z (camera sits at -Z behind the car). If the longest
  // axis is X (model exported with nose along ±X), rotate -90° around Y.
  if (size.x > size.z * 1.1) {
    model.rotation.y = -Math.PI / 2
    // Re-center after rotation so bbox-min/max reflects the final pose.
    bbox = new THREE.Box3().setFromObject(model)
    const c2 = bbox.getCenter(new THREE.Vector3())
    model.position.x -= c2.x
    model.position.z -= c2.z
    model.position.y -= bbox.min.y
  }
}

export function createCar(): CarBundle {
  const group = new THREE.Group()
  group.name = 'car'

  // ---- Placeholder shown immediately, replaced when GLB resolves.
  const placeholder = buildPlaceholder()
  group.add(placeholder.group)
  let placeholderActive = true
  let activeModel: THREE.Object3D = placeholder.group
  let activeWheels: THREE.Mesh[] = placeholder.wheels

  // ---- Particle effects in WORLD space (parented to `particles`, not the
  // car group, so they don't drag along when the car moves/turns).
  const particles = new THREE.Group()
  particles.name = 'car-particles'
  // Sentinel: dead particles are parked far below the world so they're
  // invisible without needing a custom shader.
  const SENTINEL_Y = -10000

  const initBuffer = (buf: Float32Array): void => {
    for (let i = 0; i < buf.length; i += 3) buf[i + 1] = SENTINEL_Y
  }

  const trailGeo = new THREE.BufferGeometry()
  const trailPos = new Float32Array(PARTICLE_MAX * 3)
  const trailLife = new Float32Array(PARTICLE_MAX)
  initBuffer(trailPos)
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3))
  const trailMat = new THREE.PointsMaterial({
    color: '#ffffff',
    size: 0.5,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const trail = new THREE.Points(trailGeo, trailMat)
  trail.frustumCulled = false
  particles.add(trail)
  let trailCursor = 0

  const sparkGeo = new THREE.BufferGeometry()
  const sparkPos = new Float32Array(PARTICLE_MAX * 3)
  const sparkVel = new Float32Array(PARTICLE_MAX * 3)
  const sparkLife = new Float32Array(PARTICLE_MAX)
  initBuffer(sparkPos)
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  const sparkMat = new THREE.PointsMaterial({
    color: '#ffd870',
    size: 0.6,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  sparks.frustumCulled = false
  particles.add(sparks)
  let sparkCursor = 0

  // GLB loader: log to console only (no on-screen panel — HUD lives at the
  // same screen edge and the panel was hiding it).
  const log = (msg: string, _color = '#0f0'): void => {
    console.log('[F1S][GLB]', msg)
  }

  // ---- Async GLB load via fetch + parse (data: URL safe across file://).
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  ;(async () => {
    try {
      log(`fetching:\n${carGlbUrl.slice(0, 120)}${carGlbUrl.length > 120 ? '…' : ''}`)
      const res = await fetch(carGlbUrl)
      if (!res.ok) throw new Error(`fetch ${res.status}`)
      const buf = await res.arrayBuffer()
      log(`fetched ${buf.byteLength} bytes, parsing…`)

      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        loader.parse(
          buf,
          '',
          (g) => resolve(g as unknown as { scene: THREE.Group }),
          (e) => reject(e),
        )
      })

      const model = gltf.scene
      let meshCount = 0
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshCount++
      })
      log(`parsed OK, meshes=${meshCount}, fitting…`)

      fitGltfToTrack(model)
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh) {
          mesh.castShadow = true
          mesh.receiveShadow = false
          mesh.frustumCulled = true
        }
      })

      // Swap placeholder out.
      group.remove(placeholder.group)
      disposePlaceholder(placeholder)
      placeholderActive = false
      group.add(model)
      activeModel = model
      activeWheels = []
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        const name = mesh.name.toLowerCase()
        if (name.includes('wheel') || name.includes('tire') || name.includes('tyre')) {
          activeWheels.push(mesh)
        }
      })
      const bbox = new THREE.Box3().setFromObject(model)
      const sz = bbox.getSize(new THREE.Vector3())
      log(
        `LOADED ✓\nmeshes=${meshCount} wheels=${activeWheels.length}\nsize ${sz.x.toFixed(1)}×${sz.y.toFixed(1)}×${sz.z.toFixed(1)}m`,
        '#0f0',
      )
      // (debug panel removed)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const stack = e instanceof Error && e.stack ? `\n${e.stack.split('\n').slice(0, 3).join('\n')}` : ''
      console.warn('[F1S] GLB load failed:', e)
      log(`FAILED ✗\n${msg}${stack}`, '#f55')
      // keep panel visible; user reports back
    }
  })()

  const setLivery = (team: TeamId): void => {
    const c = TEAM_COLORS[team]
    sparkMat.color.set(c.spark)
    if (placeholderActive) {
      placeholder.bodyMat.color.set(c.primary)
      placeholder.accentMat.color.set(c.secondary)
    }
    // GLB livery override skipped: real model has named decals/paints we don't
    // want to overwrite blindly. Spark color still differentiates teams.
  }

  const tmpVec = new THREE.Vector3()

  const emitSpeedTrail = (intensity: number): void => {
    const n = Math.max(1, Math.floor(intensity * 4))
    // Emit BEHIND the car in world space.
    const yaw = group.rotation.y
    const back = tmpVec.set(-Math.sin(yaw), 0, -Math.cos(yaw))
    for (let i = 0; i < n; i++) {
      const idx = trailCursor % PARTICLE_MAX
      trailCursor++
      const baseX = group.position.x + back.x * 2.4
      const baseZ = group.position.z + back.z * 2.4
      trailPos[idx * 3 + 0] = baseX + (Math.random() - 0.5) * 1.6
      trailPos[idx * 3 + 1] = 0.4 + Math.random() * 0.3
      trailPos[idx * 3 + 2] = baseZ + (Math.random() - 0.5) * 1.6
      trailLife[idx] = PARTICLE_LIFE
    }
    trailGeo.attributes.position.needsUpdate = true
  }

  const emitSparks = (worldPos: THREE.Vector3, count: number): void => {
    for (let i = 0; i < count; i++) {
      const idx = sparkCursor % PARTICLE_MAX
      sparkCursor++
      sparkPos[idx * 3 + 0] = worldPos.x + (Math.random() - 0.5) * 0.5
      sparkPos[idx * 3 + 1] = worldPos.y + Math.random() * 0.3
      sparkPos[idx * 3 + 2] = worldPos.z + (Math.random() - 0.5) * 0.5
      sparkVel[idx * 3 + 0] = (Math.random() - 0.5) * 6
      sparkVel[idx * 3 + 1] = 2 + Math.random() * 4
      sparkVel[idx * 3 + 2] = (Math.random() - 0.5) * 6
      sparkLife[idx] = 1.5
    }
    sparkGeo.attributes.position.needsUpdate = true
  }

  const update = (dt: number, speed01: number): void => {
    const spin = speed01 * 30 * dt
    for (const w of activeWheels) w.rotation.x += spin

    // Trails: tick down life; on death move to sentinel so they vanish.
    for (let i = 0; i < PARTICLE_MAX; i++) {
      if (trailLife[i] <= 0) continue
      trailLife[i] -= dt
      // Slight upward drift so particles don't sink into the road.
      trailPos[i * 3 + 1] += dt * 0.3
      if (trailLife[i] <= 0) {
        trailPos[i * 3 + 0] = 0
        trailPos[i * 3 + 1] = SENTINEL_Y
        trailPos[i * 3 + 2] = 0
      }
    }
    trailGeo.attributes.position.needsUpdate = true

    // Sparks: gravity + drag in world space; bury when life ends.
    for (let i = 0; i < PARTICLE_MAX; i++) {
      if (sparkLife[i] <= 0) continue
      sparkLife[i] -= dt
      sparkVel[i * 3 + 1] -= 9.8 * dt
      sparkPos[i * 3 + 0] += sparkVel[i * 3 + 0] * dt
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt
      if (sparkPos[i * 3 + 1] < 0 || sparkLife[i] <= 0) {
        sparkLife[i] = 0
        sparkPos[i * 3 + 0] = 0
        sparkPos[i * 3 + 1] = SENTINEL_Y
        sparkPos[i * 3 + 2] = 0
      }
    }
    sparkGeo.attributes.position.needsUpdate = true
  }

  const dispose = (): void => {
    if (placeholderActive) disposePlaceholder(placeholder)
    activeModel.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
      }
    })
    trailGeo.dispose()
    trailMat.dispose()
    sparkGeo.dispose()
    sparkMat.dispose()
  }

  return { group, particles, setLivery, emitSpeedTrail, emitSparks, update, dispose }
}
