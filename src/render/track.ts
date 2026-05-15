import * as THREE from 'three'
// Inlined as a base64 data URL by Vite (assetsInlineLimit = 100 MB) so the
// final bundle is fully offline — no fetch / XHR at runtime. WebP at 1024×
// halves the size vs the original 1600×1000 PNG with no perceivable
// difference at game camera ranges.
import shanghaiEnvUrl from '../assets/textures/shanghai_environment.webp?url'
import type { WeatherPreset } from './weather'

const ROAD_HALF_WIDTH = 7 // 14 m total = SIC spec
const KERB_WIDTH = 2.0
const TRACK_SEGMENTS = 2000 // dense sampling: avoids kerb-into-road overlap on tight corners

// --- Environment ground (satellite-style backdrop). Tunable so the
// texture can be re-aligned without touching geometry.
const ENV_TEXTURE_PATH = shanghaiEnvUrl
const ENV_WIDTH = 1600
const ENV_DEPTH = 1000
const ENV_ALIGNMENT = {
  x: 0,
  z: 0,
  y: -0.06,
  yaw: 0,
  scale: 1,
  flipY: false,
}

// --- Distant skyline / landmark cluster ----------------------------------
// Tunable knobs for the far-background "Shanghai-inspired" horizon. These
// drive PART 4–7 helpers below; tweak rather than touching the helpers.

const SKYLINE_ENABLED = true

const SKYLINE_CONFIG = {
  northZ: -880,
  southZ: 900,
  eastX: 1000,
  westX: -1000,
  baseY: 0,
  hazeColor: '#b8c6d8',
  hazeOpacity: 0.18,
}

const LANDMARK_CONFIG = {
  enabled: true,
  x: 180,
  y: 0,
  z: -900,
  scale: 1.0,
  yaw: 0,
}

const SKYLINE_COLORS = {
  farDark: '#111820',
  farMid: '#18212b',
  farLight: '#222d38',
  landmark: '#101720',
  landmarkAccent: '#172230',
  glassDark: '#182635',
  warmWindow: '#ffd36a',
  redBeacon: '#ff3b30',
  haze: '#b8c6d8',
}

// Hand-placed SIC silhouette traced from the official Wikipedia track-map
// SVG, scaled ×2 to ~1200 × 740 m. Some local kerb-into-road overlap
// remains in the very tight T11/T13/T14 corners but the overall shape is
// recognisable and the rest of the lap renders cleanly.
const RAW_POINTS: [number, number, number][] = [
  [  -140.0, 0,   -52.8], //  0  start/finish
  [   -23.4, 0,  -347.4], //  1
  [     5.8, 0,  -376.4], //  2
  [    48.0, 0,  -385.0], //  3  T1
  [    92.0, 0,  -373.6], //  4
  [   117.2, 0,  -344.6], //  5
  [   121.2, 0,  -311.4], //  6  T2
  [   104.0, 0,  -282.2], //  7
  [    77.4, 0,  -272.8], //  8
  [    52.2, 0,  -297.8], //  9
  [    27.4, 0,  -317.4], // 10
  [     6.4, 0,  -310.0], // 11
  [    -4.8, 0,  -286.8], // 12  T3
  [     5.8, 0,  -258.4], // 13
  [    29.6, 0,  -232.2], // 14  T4
  [    66.8, 0,  -219.8], // 15
  [   138.4, 0,  -229.8], // 16
  [   296.2, 0,  -251.6], // 17  T5
  [   336.4, 0,  -251.6], // 18
  [   504.8, 0,  -208.0], // 19
  [   534.4, 0,  -196.0], // 20  T6
  [   537.6, 0,  -177.4], // 21
  [   524.4, 0,  -166.8], // 22
  [   474.0, 0,  -150.8], // 23
  [   419.2, 0,  -147.8], // 24  T7
  [   285.6, 0,  -156.2], // 25
  [   232.6, 0,  -156.2], // 26
  [   184.8, 0,  -138.0], // 27
  [   159.6, 0,  -111.0], // 28  T8
  [   145.0, 0,   -70.0], // 29
  [   144.8, 0,   -23.6], // 30
  [   161.0, 0,    19.0], // 31
  [   196.8, 0,    74.6], // 32  T9
  [   210.0, 0,   106.4], // 33
  [   206.0, 0,   145.0], // 34
  [   179.6, 0,   174.0], // 35
  [   137.2, 0,   192.6], // 36  T10
  [    68.2, 0,   179.4], // 37
  [    39.6, 0,   182.4], // 38
  [    29.6, 0,   203.0], // 39
  [    43.0, 0,   247.0], // 40
  [    57.6, 0,   279.8], // 41
  [    80.0, 0,   286.8], // 42
  [   137.4, 0,   287.2], // 43  T10 exit
  // T11 entry transition: bridges the long east straight into the loop with
  // a gentle south-easterly curve (otherwise tangent jumps east → north in
  // one segment and the road kinks).
  [   280.0, 0,   293.0], // 43a
  [   400.0, 0,   305.0], // 43b
  // T11-T13 area replaced by a single mathematically-clean wide arc:
  // centre (473, 474.5), R = 172.5 m, sweep 38.7° CW.
  // Entry tangent EAST (matches incoming straight from 43b → 44).
  // 6 evenly-spaced points on the arc — guaranteed constant curvature,
  // no Catmull-Rom self-intersection, no kerb-into-road folds.
  // Inner-loop visual is lost; in exchange, no more T13 cross artefact.
  [   473.0, 0,   301.8], // 44  arc start (east-tangent)
  [   494.6, 0,   303.7], // 45  arc 7.7° CW
  [   515.9, 0,   309.0], // 46  arc 15.5° CW
  [   536.5, 0,   317.7], // 47  arc 23.2° CW
  [   556.6, 0,   329.8], // 48  arc 31.0° CW
  [   590.0, 0,   341.0], // 49  arc end (pushed slightly outward to widen T13)
  [   598.0, 0,   355.0], // 53  T13 exit  (further east-south for bigger radius)
  [   585.0, 0,   373.0], // 54  smoothed transition to back straight
  [   512.4, 0,   383.6], // 55
  [   405.6, 0,   385.0], // 56  back straight east end
  [  -583.0, 0,   379.6], // 57  back straight west end
  [  -625.0, 0,   376.0], // 58  T14
  [  -660.0, 0,   362.0], // 59
  [  -660.0, 0,   338.0], // 60  west apex
  [  -625.0, 0,   324.0], // 61
  [  -595.0, 0,   325.0], // 62  exit
  [  -437.6, 0,   329.0], // 63  T15
  [  -294.2, 0,   322.6], // 64
  [  -272.8, 0,   313.0], // 65  T16
  [  -263.4, 0,   283.8], // 66
]


export interface TrackBundle {
  group: THREE.Group
  curve: THREE.Curve<THREE.Vector3>
  length: number
  getPositionAt: (t: number) => THREE.Vector3
  getTangentAt: (t: number) => THREE.Vector3
  /** Returns shortest arc-length parameter (0..1) on track for a world point. */
  projectToTrack: (worldPos: THREE.Vector3) => { t: number; offset: number; closest: THREE.Vector3 }
  /** Drives time-based environment animation (drifting clouds, etc.). Call
   *  every frame from the main loop with dt in seconds. */
  updateAtmosphere: (dt: number) => void
  /** Re-tint clouds + horizon haze from a weather preset. */
  applyWeather: (preset: WeatherPreset) => void
  dispose: () => void
}

interface Disposables {
  geometries: THREE.BufferGeometry[]
  materials: THREE.Material[]
  textures: THREE.Texture[]
}

/**
 * Build a closed CurvePath of cubic Beziers. Each waypoint gets an explicit
 * tangent (computed from neighbours), and the Bezier control handles for
 * each segment are built from those tangents — so the curve has true C1
 * continuity at every joint and CANNOT overshoot like Catmull-Rom does on
 * sharp tangent changes. Handle length is 1/3 of segment chord (standard
 * "G1 cardinal" Hermite-to-Bezier conversion).
 */
function buildBezierPath(points: THREE.Vector3[]): THREE.CurvePath<THREE.Vector3> {
  const N = points.length
  // Per-point tangent DIRECTION (unit vector) computed from neighbours.
  // Magnitude is decoupled from spacing here — each Bezier handle below
  // is sized per-segment, which prevents the asymmetric-spacing overshoot
  // that Catmull-Rom and naïve cardinal Bezier both suffer from.
  const tangentDirs: THREE.Vector3[] = []
  for (let i = 0; i < N; i++) {
    const prev = points[(i - 1 + N) % N]
    const next = points[(i + 1) % N]
    const dir = next.clone().sub(prev)
    if (dir.lengthSq() > 1e-9) dir.normalize()
    tangentDirs.push(dir)
  }
  // Per-point chord lengths with adjacent neighbours (used to size handles).
  const chordsTo: number[] = []
  for (let i = 0; i < N; i++) {
    chordsTo.push(points[i].distanceTo(points[(i + 1) % N]))
  }
  // Handle length AT POINT i (going OUT toward i+1) is bounded by the
  // smaller of (chord-to-prev, chord-to-next). This balances handles on
  // either side of every joint → no abrupt 2nd-derivative jumps, no
  // local curvature spikes at junctions of long-and-short segments.
  const HANDLE_K = 0.42
  const handleOut: number[] = []
  for (let i = 0; i < N; i++) {
    const prevChord = chordsTo[(i - 1 + N) % N]
    const nextChord = chordsTo[i]
    handleOut.push(Math.min(prevChord, nextChord) * HANDLE_K)
  }
  const path = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < N; i++) {
    const a = points[i]
    const b = points[(i + 1) % N]
    const ta = tangentDirs[i]
    const tb = tangentDirs[(i + 1) % N]
    const c1 = a.clone().addScaledVector(ta, handleOut[i])
    const c2 = b.clone().addScaledVector(tb, -handleOut[(i + 1) % N])
    path.add(new THREE.CubicBezierCurve3(a, c1, c2, b))
  }
  return path
}

// --- Helpers -------------------------------------------------------------

function lateralAtForCurve(
  curve: THREE.Curve<THREE.Vector3>,
  t: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const tg = curve.getTangentAt(((t % 1) + 1) % 1)
  out.set(-tg.z, 0, tg.x)
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0)
  else out.normalize()
  return out
}

function yawFromTangent(tangent: THREE.Vector3): number {
  return Math.atan2(tangent.x, tangent.z)
}

function makeBox(
  name: string,
  size: THREE.Vector3,
  position: THREE.Vector3,
  yaw: number,
  material: THREE.Material,
  d: Disposables,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z)
  d.geometries.push(geo)
  const mesh = new THREE.Mesh(geo, material)
  mesh.name = name
  mesh.position.copy(position)
  mesh.rotation.y = yaw
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// --- Environment ground --------------------------------------------------

function createEnvironmentGround(d: Disposables): THREE.Group {
  const envGroup = new THREE.Group()
  envGroup.name = 'environment-ground'
  envGroup.position.set(ENV_ALIGNMENT.x, 0, ENV_ALIGNMENT.z)
  envGroup.rotation.y = ENV_ALIGNMENT.yaw
  envGroup.scale.setScalar(ENV_ALIGNMENT.scale)

  const groundGeo = new THREE.PlaneGeometry(ENV_WIDTH, ENV_DEPTH)
  d.geometries.push(groundGeo)

  // Fallback grey/green so the world is not pure black if the texture 404s.
  const groundMat = new THREE.MeshStandardMaterial({
    color: '#4a5a3a',
    roughness: 1,
    metalness: 0,
  })
  d.materials.push(groundMat)

  const texLoader = new THREE.TextureLoader()
  texLoader.load(
    ENV_TEXTURE_PATH,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.ClampToEdgeWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      tex.flipY = ENV_ALIGNMENT.flipY
      tex.anisotropy = 8
      groundMat.map = tex
      groundMat.color.setHex(0xffffff)
      groundMat.needsUpdate = true
      d.textures.push(tex)
    },
    undefined,
    (err) => {
      // Keep fallback colour — game must still run offline / on missing asset.
      console.warn('[track] environment texture failed to load:', err)
    },
  )

  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = ENV_ALIGNMENT.y
  ground.receiveShadow = true
  envGroup.add(ground)

  return envGroup
}

// --- Trackside barriers (concrete + red accents) -------------------------

function addBarriers(
  group: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  d: Disposables,
): void {
  const SAMPLES = 160
  const BARRIER_OFFSET = ROAD_HALF_WIDTH + KERB_WIDTH + 2.0
  // Local +X = lateral (perpendicular to track), local +Z = along tangent
  // (gantry beam convention). So the 6 m length goes on Z, thin 0.35 m on X.
  const barrierGeo = new THREE.BoxGeometry(0.35, 1.1, 6)
  d.geometries.push(barrierGeo)

  const concreteMat = new THREE.MeshStandardMaterial({
    color: '#d8d8d8',
    roughness: 0.85,
    metalness: 0,
  })
  const redMat = new THREE.MeshStandardMaterial({
    color: '#d11',
    roughness: 0.7,
    metalness: 0,
  })
  d.materials.push(concreteMat, redMat)

  const total = SAMPLES * 2
  const half = Math.ceil(total / 2)
  const concrete = new THREE.InstancedMesh(barrierGeo, concreteMat, half)
  const red = new THREE.InstancedMesh(barrierGeo, redMat, total - half)
  concrete.castShadow = false
  red.castShadow = false
  concrete.receiveShadow = true
  red.receiveShadow = true

  const dummy = new THREE.Object3D()
  const lat = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const pos = new THREE.Vector3()
  let cI = 0
  let rI = 0
  let n = 0

  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES
    const p = curve.getPointAt(t)
    tan.copy(curve.getTangentAt(t))
    lateralAtForCurve(curve, t, lat)
    const yaw = yawFromTangent(tan)

    for (const side of [-1, 1]) {
      pos.copy(p).addScaledVector(lat, side * BARRIER_OFFSET)
      pos.y = 0.55
      dummy.position.copy(pos)
      dummy.rotation.set(0, yaw, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      const useRed = n % 2 === 0
      if (useRed && rI < red.count) {
        red.setMatrixAt(rI++, dummy.matrix)
      } else if (cI < concrete.count) {
        concrete.setMatrixAt(cI++, dummy.matrix)
      } else if (rI < red.count) {
        red.setMatrixAt(rI++, dummy.matrix)
      }
      n++
    }
  }
  concrete.instanceMatrix.needsUpdate = true
  red.instanceMatrix.needsUpdate = true
  concrete.name = 'barriers-concrete'
  red.name = 'barriers-red'
  group.add(concrete)
  group.add(red)
}

// --- Safety fences (posts + dark panels) ---------------------------------

function addFences(
  group: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  d: Disposables,
): void {
  const SAMPLES = 110
  const FENCE_OFFSET = ROAD_HALF_WIDTH + KERB_WIDTH + 5.0

  const postGeo = new THREE.BoxGeometry(0.18, 3.0, 0.18)
  // 6 m panel runs ALONG the tangent (local +Z), thin 0.05 m on the lateral X.
  const panelGeo = new THREE.BoxGeometry(0.05, 2.0, 6)
  d.geometries.push(postGeo, panelGeo)

  const postMat = new THREE.MeshStandardMaterial({
    color: '#252a30',
    roughness: 0.6,
    metalness: 0.3,
  })
  // Opaque dark panel — transparent InstancedMesh sorts poorly; opaque reads
  // as a fence silhouette from racing-camera distance.
  const panelMat = new THREE.MeshStandardMaterial({
    color: '#3a4750',
    roughness: 0.7,
    metalness: 0.1,
  })
  d.materials.push(postMat, panelMat)

  const total = SAMPLES * 2
  const posts = new THREE.InstancedMesh(postGeo, postMat, total)
  const panels = new THREE.InstancedMesh(panelGeo, panelMat, total)
  posts.castShadow = false
  panels.castShadow = false
  posts.receiveShadow = false
  panels.receiveShadow = false

  const dummy = new THREE.Object3D()
  const lat = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const pos = new THREE.Vector3()
  let pi = 0
  let qi = 0

  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES
    const p = curve.getPointAt(t)
    tan.copy(curve.getTangentAt(t))
    lateralAtForCurve(curve, t, lat)
    const yaw = yawFromTangent(tan)

    for (const side of [-1, 1]) {
      pos.copy(p).addScaledVector(lat, side * FENCE_OFFSET)

      pos.y = 1.5
      dummy.position.copy(pos)
      dummy.rotation.set(0, yaw, 0)
      dummy.updateMatrix()
      posts.setMatrixAt(pi++, dummy.matrix)

      pos.y = 1.3
      dummy.position.copy(pos)
      dummy.updateMatrix()
      panels.setMatrixAt(qi++, dummy.matrix)
    }
  }

  posts.instanceMatrix.needsUpdate = true
  panels.instanceMatrix.needsUpdate = true
  posts.name = 'fence-posts'
  panels.name = 'fence-panels'
  group.add(posts)
  group.add(panels)
}

// --- Light poles ---------------------------------------------------------

function addLightPoles(
  group: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  d: Disposables,
): void {
  const COUNT = 32
  const OFFSET = 38

  const poleGeo = new THREE.CylinderGeometry(0.18, 0.28, 18, 8)
  const armGeo = new THREE.BoxGeometry(5, 0.25, 0.25)
  const headGeo = new THREE.BoxGeometry(1.2, 0.4, 0.8)
  d.geometries.push(poleGeo, armGeo, headGeo)

  const poleMat = new THREE.MeshStandardMaterial({
    color: '#2b3036',
    roughness: 0.5,
    metalness: 0.6,
  })
  const headMat = new THREE.MeshStandardMaterial({
    color: '#fff3c4',
    emissive: '#ffd36a',
    emissiveIntensity: 0.8,
    roughness: 0.4,
    metalness: 0.1,
  })
  d.materials.push(poleMat, headMat)

  const poles = new THREE.InstancedMesh(poleGeo, poleMat, COUNT)
  const arms = new THREE.InstancedMesh(armGeo, poleMat, COUNT)
  const heads = new THREE.InstancedMesh(headGeo, headMat, COUNT)
  poles.castShadow = false
  arms.castShadow = false
  heads.castShadow = false

  const dummy = new THREE.Object3D()
  const lat = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const base = new THREE.Vector3()

  for (let i = 0; i < COUNT; i++) {
    const t = i / COUNT
    const p = curve.getPointAt(t)
    tan.copy(curve.getTangentAt(t))
    lateralAtForCurve(curve, t, lat)
    const yaw = yawFromTangent(tan)
    const side = i % 2 === 0 ? 1 : -1

    base.copy(p).addScaledVector(lat, side * OFFSET)

    dummy.position.set(base.x, 9, base.z)
    dummy.rotation.set(0, yaw, 0)
    dummy.updateMatrix()
    poles.setMatrixAt(i, dummy.matrix)

    const armX = base.x + lat.x * -side * 2.5
    const armZ = base.z + lat.z * -side * 2.5
    dummy.position.set(armX, 17.6, armZ)
    dummy.rotation.set(0, yaw, 0)
    dummy.updateMatrix()
    arms.setMatrixAt(i, dummy.matrix)

    const headX = base.x + lat.x * -side * 4.5
    const headZ = base.z + lat.z * -side * 4.5
    dummy.position.set(headX, 17.8, headZ)
    dummy.rotation.set(0, yaw, 0)
    dummy.updateMatrix()
    heads.setMatrixAt(i, dummy.matrix)
  }

  poles.instanceMatrix.needsUpdate = true
  arms.instanceMatrix.needsUpdate = true
  heads.instanceMatrix.needsUpdate = true
  poles.name = 'light-poles'
  arms.name = 'light-arms'
  heads.name = 'light-heads'
  group.add(poles, arms, heads)

  // A handful of low-intensity actual lights near the start straight, so
  // the player area gets some warm spill in the racing camera.
  const litCount = 4
  for (let i = 0; i < litCount; i++) {
    const t = (i / litCount) * 0.06
    const p = curve.getPointAt(t)
    tan.copy(curve.getTangentAt(t))
    lateralAtForCurve(curve, t, lat)
    const side = i % 2 === 0 ? 1 : -1
    const lightPos = p.clone().addScaledVector(lat, side * (OFFSET - 4))
    const pl = new THREE.PointLight('#ffd9a0', 0.6, 60, 2)
    pl.position.set(lightPos.x, 16, lightPos.z)
    group.add(pl)
  }
}

// --- Pit building + main grandstand --------------------------------------

function addPitAndGrandstand(
  group: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  d: Disposables,
): void {
  const startP = curve.getPointAt(0)
  const startT = curve.getTangentAt(0)
  const startLat = lateralAtForCurve(curve, 0, new THREE.Vector3())
  const yaw = yawFromTangent(startT)

  const PIT_SIDE = 1

  const baseMat = new THREE.MeshStandardMaterial({
    color: '#c8c8c8',
    roughness: 0.7,
    metalness: 0.05,
  })
  const roofMat = new THREE.MeshStandardMaterial({
    color: '#3a3d42',
    roughness: 0.6,
    metalness: 0.2,
  })
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#1e3542',
    roughness: 0.3,
    metalness: 0.1,
  })
  const doorMat = new THREE.MeshStandardMaterial({
    color: '#2f343a',
    roughness: 0.7,
    metalness: 0.05,
  })
  d.materials.push(baseMat, roofMat, glassMat, doorMat)

  const pitLen = 260
  const pitWid = 26
  const pitHeight = 14
  const pitCenter = startP.clone()
    .addScaledVector(startT, -40)
    .addScaledVector(startLat, PIT_SIDE * 60)
  pitCenter.y = pitHeight / 2
  // size = (lateral, height, along-tangent). pit "length" runs along the
  // start straight, so it goes on the Z dimension after the yaw rotation.
  group.add(makeBox('pit-base', new THREE.Vector3(pitWid, pitHeight, pitLen), pitCenter, yaw, baseMat, d))

  const roofPos = pitCenter.clone()
  roofPos.y = pitHeight + 0.6
  group.add(makeBox('pit-roof', new THREE.Vector3(pitWid + 4, 1.2, pitLen + 4), roofPos, yaw, roofMat, d))

  const glassOffset = -PIT_SIDE * (pitWid / 2 + 0.05)
  const glassPos = startP.clone()
    .addScaledVector(startT, -40)
    .addScaledVector(startLat, PIT_SIDE * 60 + glassOffset)
  glassPos.y = pitHeight - 3
  group.add(makeBox('pit-glass', new THREE.Vector3(0.3, 3, pitLen - 8), glassPos, yaw, glassMat, d))

  const doorCount = 12
  const doorSpacing = (pitLen - 20) / doorCount
  const doorOffset = -PIT_SIDE * (pitWid / 2 + 0.1)
  for (let i = 0; i < doorCount; i++) {
    const along = -pitLen / 2 + 10 + i * doorSpacing + doorSpacing / 2
    const doorPos = startP.clone()
      .addScaledVector(startT, -40 + along)
      .addScaledVector(startLat, PIT_SIDE * 60 + doorOffset)
    doorPos.y = 2.5
    // Door panel: thin laterally, 8 m wide along the track.
    group.add(makeBox(`pit-door-${i}`, new THREE.Vector3(0.25, 4, 8), doorPos, yaw, doorMat, d))
  }

  const grandLen = 300
  const grandWid = 45
  const seatMat = new THREE.MeshStandardMaterial({
    color: '#6a6f76',
    roughness: 0.9,
    metalness: 0,
  })
  const accentMat = new THREE.MeshStandardMaterial({
    color: '#aa1f1f',
    roughness: 0.7,
    metalness: 0,
  })
  const canopyMat = new THREE.MeshStandardMaterial({
    color: '#aeb3b7',
    roughness: 0.6,
    metalness: 0.3,
  })
  d.materials.push(seatMat, accentMat, canopyMat)

  const STEPS = 6
  const grandSide = -PIT_SIDE
  const grandBaseOffset = grandSide * 50
  for (let s = 0; s < STEPS; s++) {
    const stepHeight = 3 + s * 3
    const stepDepth = grandWid - s * 5
    const lateralPush = grandSide * (s * 3)
    const stepCenter = startP.clone()
      .addScaledVector(startT, -40)
      .addScaledVector(startLat, grandBaseOffset + lateralPush)
    stepCenter.y = stepHeight / 2
    const useAccent = s === 1 || s === 4
    // Lateral × height × along-tangent.
    group.add(makeBox(
      `grandstand-step-${s}`,
      new THREE.Vector3(stepDepth, stepHeight, grandLen - s * 10),
      stepCenter,
      yaw,
      useAccent ? accentMat : seatMat,
      d,
    ))
  }

  const canopyCenter = startP.clone()
    .addScaledVector(startT, -40)
    .addScaledVector(startLat, grandBaseOffset + grandSide * (STEPS * 3))
  canopyCenter.y = 3 + (STEPS - 1) * 3 + 4
  group.add(makeBox(
    'grandstand-canopy',
    new THREE.Vector3(grandWid + 10, 2, grandLen + 20),
    canopyCenter,
    yaw,
    canopyMat,
    d,
  ))
}

// --- Distant skyline ------------------------------------------------------
// Far-background city silhouette. Uses MeshBasicMaterial so it stays
// readable regardless of scene lighting (unlit silhouettes feel "distant"
// against any sky colour). Deterministic seeded layout so every reload
// shows the same horizon.

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 999.123) * 10000
  return x - Math.floor(x)
}

function addProceduralSkyline(group: THREE.Group, d: Disposables): void {
  // White base material + per-instance colour: 460+ buildings collapse to
  // a single draw call regardless of palette variety.
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  d.materials.push(skylineMat)
  const palette = [
    new THREE.Color(SKYLINE_COLORS.farDark),
    new THREE.Color(SKYLINE_COLORS.farMid),
    new THREE.Color(SKYLINE_COLORS.farLight),
  ]

  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  d.geometries.push(unitBox)

  // First pass collects every instance spec from all four cardinal bands;
  // second pass uploads them into a single InstancedMesh.
  const specs: Array<{
    pos: THREE.Vector3
    scale: THREE.Vector3
    color: THREE.Color
  }> = []

  // Place a dense main ribbon along one cardinal edge plus a sparser, taller
  // back layer pushed slightly further outward (depth gradient effect).
  const collectBand = (
    axis: 'x' | 'z',     // axis the buildings spread ALONG
    fixed: number,       // coordinate on the perpendicular axis
    range: [number, number],
    backwardSign: 1 | -1,
    seedBase: number,
  ): void => {
    // --- Main ribbon: dense, varied palette.
    let cursor = range[0]
    let i = 0
    while (cursor < range[1] && i < 80) {
      const r1 = seededRandom(seedBase + i * 3 + 1)
      const r2 = seededRandom(seedBase + i * 3 + 2)
      const r3 = seededRandom(seedBase + i * 3 + 3)
      const w = 18 + r1 * 38
      const h = 22 + r2 * 90
      const dp = 20 + r3 * 28
      const along = cursor + w / 2
      const perp = fixed + (r3 - 0.5) * 22
      const pos = new THREE.Vector3(
        axis === 'x' ? along : perp,
        h / 2,
        axis === 'x' ? perp : along,
      )
      const colour = palette[Math.floor(r1 * palette.length) % palette.length]
      specs.push({ pos, scale: new THREE.Vector3(w, h, dp), color: colour.clone() })
      cursor += w + 4 + r2 * 12
      i++
    }
    // --- Back layer: taller, lighter tone, pushed ~70 m further outward.
    cursor = range[0] + 20
    let j = 0
    const perpBack = fixed + backwardSign * 70
    while (cursor < range[1] && j < 35) {
      const r1 = seededRandom(seedBase + j * 7 + 211)
      const r2 = seededRandom(seedBase + j * 7 + 213)
      const w = 32 + r1 * 50
      const h = 35 + r2 * 80
      const along = cursor + w / 2
      const pos = new THREE.Vector3(
        axis === 'x' ? along : perpBack,
        h / 2,
        axis === 'x' ? perpBack : along,
      )
      specs.push({ pos, scale: new THREE.Vector3(w, h, 28), color: palette[2].clone() })
      cursor += w + 18 + r1 * 14
      j++
    }
  }

  // Four cardinal bands — same density everywhere so the horizon never
  // goes bare regardless of which way the player faces.
  collectBand('x', SKYLINE_CONFIG.northZ, [-900, 900], -1, 0)
  collectBand('x', SKYLINE_CONFIG.southZ, [-900, 900], 1, 1000)
  collectBand('z', SKYLINE_CONFIG.eastX, [-540, 540], 1, 2000)
  collectBand('z', SKYLINE_CONFIG.westX, [-540, 540], -1, 3000)

  const im = new THREE.InstancedMesh(unitBox, skylineMat, specs.length)
  im.name = 'skyline-instanced'
  const dummy = new THREE.Object3D()
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]
    dummy.position.copy(s.pos)
    dummy.scale.copy(s.scale)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    im.setMatrixAt(i, dummy.matrix)
    im.setColorAt(i, s.color)
  }
  im.instanceMatrix.needsUpdate = true
  if (im.instanceColor) im.instanceColor.needsUpdate = true
  group.add(im)
}

// --- Shanghai-inspired landmark cluster ----------------------------------

function buildOrientalPearlInspired(d: Disposables, mat: THREE.Material, beaconMat: THREE.Material): THREE.Group {
  const grp = new THREE.Group()
  grp.name = 'pearl-inspired'
  // Vertical layout chosen so each segment hands off cleanly to the next:
  //   base   y [  0,  28]  (radius 4 → 2.2)
  //   lo-sph y [ 27,  53]  (r 13)        — passes through the shaft, intentional
  //   mid    y [ 52,  85]
  //   mi-sph y [ 85,  99]  (r 7)
  //   upper  y [ 98, 145]
  //   top-sp y [144, 152]  (r 4)
  //   antenna y[152, 200]
  //   beacon y [200, 203]
  // Total ≈ 203 m, no double-stacked cylinders.
  const baseGeo = new THREE.CylinderGeometry(2.2, 4.0, 28, 8)
  const midShaft = new THREE.CylinderGeometry(1.5, 1.5, 33, 8)
  const upperShaft = new THREE.CylinderGeometry(1.0, 1.2, 47, 8)
  const lowerSphere = new THREE.SphereGeometry(13, 16, 12)
  const midSphere = new THREE.SphereGeometry(7, 14, 10)
  const topSphere = new THREE.SphereGeometry(4, 12, 8)
  const antenna = new THREE.CylinderGeometry(0.15, 0.8, 48, 6)
  const beacon = new THREE.SphereGeometry(1.5, 8, 6)
  d.geometries.push(baseGeo, midShaft, upperShaft, lowerSphere, midSphere, topSphere, antenna, beacon)

  const base = new THREE.Mesh(baseGeo, mat); base.position.y = 14; grp.add(base)
  const lo = new THREE.Mesh(lowerSphere, mat); lo.position.y = 40; grp.add(lo)
  const mid = new THREE.Mesh(midShaft, mat); mid.position.y = 68.5; grp.add(mid)
  const ms = new THREE.Mesh(midSphere, mat); ms.position.y = 92; grp.add(ms)
  const up = new THREE.Mesh(upperShaft, mat); up.position.y = 121.5; grp.add(up)
  const top = new THREE.Mesh(topSphere, mat); top.position.y = 148; grp.add(top)
  const ant = new THREE.Mesh(antenna, mat); ant.position.y = 176; grp.add(ant)
  const bcn = new THREE.Mesh(beacon, beaconMat); bcn.position.y = 201.5; grp.add(bcn)
  return grp
}

function buildShanghaiTowerInspired(d: Disposables, mat: THREE.Material, unitBox: THREE.BoxGeometry): THREE.Group {
  const grp = new THREE.Group()
  grp.name = 'shanghai-tower-inspired'
  // 8 stacked boxes, each slightly narrower and rotated a touch — fakes
  // the famous twist silhouette without expensive geometry.
  void d // shared unitBox is already in disposables
  const segH = 26
  for (let s = 0; s < 8; s++) {
    const w = 32 - s * 1.7
    const dp = 28 - s * 1.3
    const m = new THREE.Mesh(unitBox, mat)
    m.scale.set(w, segH, dp)
    m.position.y = segH / 2 + s * segH
    m.rotation.y = s * 0.05
    grp.add(m)
  }
  // Top cap.
  const cap = new THREE.Mesh(unitBox, mat)
  cap.scale.set(8, 8, 8)
  cap.position.y = 8 * 26 + 4
  grp.add(cap)
  return grp
}

function buildSWFCInspired(mat: THREE.Material, glassMat: THREE.Material, unitBox: THREE.BoxGeometry): THREE.Group {
  const grp = new THREE.Group()
  grp.name = 'swfc-inspired'
  // Tall slab + a thin sky-tone strip near the top to suggest the famous
  // trapezoidal aperture without actually cutting geometry.
  const slab = new THREE.Mesh(unitBox, mat)
  slab.scale.set(30, 185, 22)
  slab.position.y = 92.5
  grp.add(slab)
  const ap = new THREE.Mesh(unitBox, glassMat)
  ap.scale.set(18, 8, 23)
  ap.position.set(0, 168, 0)
  grp.add(ap)
  return grp
}

function buildJinMaoInspired(mat: THREE.Material, unitBox: THREE.BoxGeometry): THREE.Group {
  const grp = new THREE.Group()
  grp.name = 'jin-mao-inspired'
  // 7 stepped tiers: stepped pagoda silhouette.
  const totalH = 170
  const tiers = 7
  const tierH = totalH / tiers
  let yCursor = 0
  for (let s = 0; s < tiers; s++) {
    const w = 28 - s * 2.8
    const dp = 28 - s * 2.8
    const m = new THREE.Mesh(unitBox, mat)
    m.scale.set(w, tierH, dp)
    m.position.y = yCursor + tierH / 2
    grp.add(m)
    yCursor += tierH
  }
  // Antenna spire on top.
  const spireGeo = new THREE.ConeGeometry(0.6, 22, 6)
  const spire = new THREE.Mesh(spireGeo, mat)
  spire.position.y = totalH + 11
  grp.add(spire)
  return grp
}

function addShanghaiLandmarkCluster(group: THREE.Group, d: Disposables): void {
  const landmarkMat = new THREE.MeshBasicMaterial({ color: SKYLINE_COLORS.landmark })
  const accentMat = new THREE.MeshBasicMaterial({ color: SKYLINE_COLORS.landmarkAccent })
  const glassMat = new THREE.MeshBasicMaterial({ color: SKYLINE_COLORS.glassDark })
  const beaconMat = new THREE.MeshStandardMaterial({
    color: SKYLINE_COLORS.redBeacon,
    emissive: SKYLINE_COLORS.redBeacon,
    emissiveIntensity: 1.5,
    roughness: 1,
    metalness: 0,
  })
  d.materials.push(landmarkMat, accentMat, glassMat, beaconMat)

  const sharedUnit = new THREE.BoxGeometry(1, 1, 1)
  d.geometries.push(sharedUnit)

  const cluster = new THREE.Group()
  cluster.name = 'shanghai-landmark-cluster'
  cluster.position.set(LANDMARK_CONFIG.x, LANDMARK_CONFIG.y, LANDMARK_CONFIG.z)
  cluster.rotation.y = LANDMARK_CONFIG.yaw
  cluster.scale.setScalar(LANDMARK_CONFIG.scale)

  const pearl = buildOrientalPearlInspired(d, landmarkMat, beaconMat)
  pearl.position.set(-90, 0, 0)
  cluster.add(pearl)

  const tower = buildShanghaiTowerInspired(d, accentMat, sharedUnit)
  tower.position.set(0, 0, -10)
  cluster.add(tower)

  const swfc = buildSWFCInspired(landmarkMat, glassMat, sharedUnit)
  swfc.position.set(60, 0, 5)
  cluster.add(swfc)

  const jin = buildJinMaoInspired(landmarkMat, sharedUnit)
  jin.position.set(105, 0, 8)
  cluster.add(jin)

  // A handful of generic supporting blocks fanned around the icons so the
  // cluster reads as a downtown massing, not 4 isolated towers.
  const fillerCount = 14
  for (let i = 0; i < fillerCount; i++) {
    const r1 = seededRandom(i * 11 + 7)
    const r2 = seededRandom(i * 11 + 9)
    const r3 = seededRandom(i * 11 + 13)
    const fx = -180 + r1 * 360
    // Keep filler buildings clear of the marquee landmarks (skip an x band
    // where the icons live).
    if (fx > -25 && fx < 130) continue
    const fz = -30 + (r2 - 0.5) * 50
    const fw = 18 + r3 * 22
    const fdp = 18 + r1 * 22
    const fh = 60 + r2 * 90
    const m = new THREE.Mesh(sharedUnit, i % 2 === 0 ? landmarkMat : accentMat)
    m.scale.set(fw, fh, fdp)
    m.position.set(fx, fh / 2, fz)
    cluster.add(m)
  }

  group.add(cluster)
}

// --- Bridge / harbor / industrial silhouettes ----------------------------

function addHarborAndBridgeSilhouettes(group: THREE.Group, d: Disposables): void {
  const craneMat = new THREE.MeshBasicMaterial({ color: '#151b22' })
  const beaconMat = new THREE.MeshStandardMaterial({
    color: SKYLINE_COLORS.redBeacon,
    emissive: SKYLINE_COLORS.redBeacon,
    emissiveIntensity: 1.5,
    roughness: 1,
    metalness: 0,
  })
  d.materials.push(craneMat, beaconMat)

  const unit = new THREE.BoxGeometry(1, 1, 1)
  d.geometries.push(unit)

  // --- Long bridge silhouette across the south horizon.
  const bridgeZ = SKYLINE_CONFIG.southZ - 30
  const deck = new THREE.Mesh(unit, craneMat)
  deck.scale.set(700, 3, 4)
  deck.position.set(0, 35, bridgeZ)
  group.add(deck)
  // Two main pylons.
  for (const px of [-220, 220]) {
    const pylon = new THREE.Mesh(unit, craneMat)
    pylon.scale.set(5, 90, 5)
    pylon.position.set(px, 45, bridgeZ)
    group.add(pylon)
    const top = new THREE.Mesh(unit, craneMat)
    top.scale.set(8, 4, 8)
    top.position.set(px, 92, bridgeZ)
    group.add(top)
  }
  // Stepping pillars under the deck.
  for (let i = -5; i <= 5; i++) {
    if (i === -2 || i === 2) continue // skip where the pylons live
    const piece = new THREE.Mesh(unit, craneMat)
    piece.scale.set(3, 30, 3)
    piece.position.set(i * 70, 17.5, bridgeZ)
    group.add(piece)
  }

  // --- 5 harbor cranes along the east edge.
  const craneCount = 5
  for (let i = 0; i < craneCount; i++) {
    const z = -260 + i * 130
    const baseX = SKYLINE_CONFIG.eastX - 60

    const tower = new THREE.Mesh(unit, craneMat)
    tower.scale.set(3, 45, 3)
    tower.position.set(baseX, 22.5, z)
    group.add(tower)

    const boom = new THREE.Mesh(unit, craneMat)
    boom.scale.set(55, 3, 3)
    boom.position.set(baseX - 18, 44, z)
    group.add(boom)

    const counter = new THREE.Mesh(unit, craneMat)
    counter.scale.set(18, 5, 5)
    counter.position.set(baseX + 12, 44, z)
    group.add(counter)

    const support = new THREE.Mesh(unit, craneMat)
    support.scale.set(45, 2, 2)
    support.position.set(baseX - 14, 36, z)
    support.rotation.z = Math.PI / 7
    group.add(support)

    const dot = new THREE.Mesh(unit, beaconMat)
    dot.scale.set(1.4, 1.4, 1.4)
    dot.position.set(baseX, 47, z)
    group.add(dot)
  }

  // --- A few low industrial warehouse blocks along the same edge.
  for (let i = 0; i < 8; i++) {
    const r1 = seededRandom(i * 17 + 5)
    const r2 = seededRandom(i * 17 + 11)
    const z = -380 + i * 95 + (r1 - 0.5) * 30
    const w = 38 + r2 * 30
    const h = 9 + r1 * 8
    const block = new THREE.Mesh(unit, craneMat)
    block.scale.set(w, h, 22)
    block.position.set(SKYLINE_CONFIG.eastX - 130, h / 2, z)
    group.add(block)
  }
}

// --- Moon + stars (night only) -------------------------------------------

interface CelestialController {
  setVisible: (visible: boolean) => void
}

function addCelestialBodies(group: THREE.Group, d: Disposables): CelestialController {
  const root = new THREE.Group()
  root.name = 'celestial'
  root.visible = false // weather.applyWeather() flips this on at night

  // --- Moon: bright sphere parked far above the western horizon.
  const moonGeo = new THREE.SphereGeometry(40, 24, 18)
  d.geometries.push(moonGeo)
  const moonMat = new THREE.MeshBasicMaterial({ color: '#f5f0d8' })
  d.materials.push(moonMat)
  const moon = new THREE.Mesh(moonGeo, moonMat)
  moon.position.set(-450, 700, -780)
  root.add(moon)

  // Soft halo behind it — back-side sphere with low opacity.
  const haloGeo = new THREE.SphereGeometry(70, 16, 12)
  d.geometries.push(haloGeo)
  const haloMat = new THREE.MeshBasicMaterial({
    color: '#cfdcf4',
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.BackSide,
  })
  d.materials.push(haloMat)
  const halo = new THREE.Mesh(haloGeo, haloMat)
  halo.position.copy(moon.position)
  root.add(halo)

  // --- Stars: 800 points scattered across a 1100-radius dome above the
  // horizon. Single Points draw call.
  const STAR_COUNT = 800
  const positions = new Float32Array(STAR_COUNT * 3)
  for (let i = 0; i < STAR_COUNT; i++) {
    const r1 = seededRandom(i * 31 + 1)
    const r2 = seededRandom(i * 31 + 2)
    const theta = r1 * Math.PI * 2
    // phi ∈ [acos(0.9), acos(0.05)] keeps stars in the upper sky band.
    const phi = Math.acos(0.05 + r2 * 0.85)
    const radius = 1100
    positions[i * 3 + 0] = radius * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = radius * Math.cos(phi)
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  d.geometries.push(starGeo)
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
  d.materials.push(starMat)
  const stars = new THREE.Points(starGeo, starMat)
  root.add(stars)

  group.add(root)
  return {
    setVisible: (v) => {
      root.visible = v
    },
  }
}

// --- Drifting clouds -----------------------------------------------------

interface CloudController {
  update: (dt: number) => void
  setTint: (color: string, opacity: number) => void
}

function addClouds(group: THREE.Group, d: Disposables): CloudController {
  // Low-poly sphere reused for every "puff". 8×6 = 48 tris, plenty for
  // sky-distance.
  const sphereGeo = new THREE.SphereGeometry(1, 8, 6)
  d.geometries.push(sphereGeo)

  // Soft white, slightly translucent so clouds blend with the sky and
  // never read as hard chalk.
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  d.materials.push(cloudMat)

  const CLOUD_COUNT = 40
  const PUFFS_PER_CLOUD = 6
  const TOTAL = CLOUD_COUNT * PUFFS_PER_CLOUD

  const im = new THREE.InstancedMesh(sphereGeo, cloudMat, TOTAL)
  im.name = 'clouds'
  im.renderOrder = 5 // after skyline so haze blends correctly
  group.add(im)

  // Per-cloud anchor — drifts with wind. Per-puff offsets fluff out the
  // anchor into a multi-lobe shape.
  interface Cloud { baseX: number; baseY: number; baseZ: number }
  interface Puff { cloudIdx: number; offX: number; offY: number; offZ: number; scale: number }

  const clouds: Cloud[] = []
  const puffs: Puff[] = []

  for (let c = 0; c < CLOUD_COUNT; c++) {
    const r1 = seededRandom(c * 13 + 1)
    const r2 = seededRandom(c * 13 + 2)
    const r3 = seededRandom(c * 13 + 3)
    clouds.push({
      baseX: -1000 + r1 * 2000, // -1000..+1000
      baseY: 220 + r2 * 180,    // 220..400 m up
      baseZ: -1000 + r3 * 2000,
    })
    for (let p = 0; p < PUFFS_PER_CLOUD; p++) {
      const pr1 = seededRandom(c * 100 + p * 7 + 1)
      const pr2 = seededRandom(c * 100 + p * 7 + 2)
      const pr3 = seededRandom(c * 100 + p * 7 + 3)
      const pr4 = seededRandom(c * 100 + p * 7 + 4)
      puffs.push({
        cloudIdx: c,
        offX: (pr1 - 0.5) * 80,
        offY: (pr2 - 0.5) * 14,
        offZ: (pr3 - 0.5) * 50,
        scale: 14 + pr4 * 16, // 14..30 m radius
      })
    }
  }

  const WIND_SPEED = 6 // m/s along +X
  const WRAP_X = 1100  // teleport back when drifting beyond this
  const span = WRAP_X * 2

  const dummy = new THREE.Object3D()
  let totalTime = 0

  const recompute = (): void => {
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i]
      const c = clouds[p.cloudIdx]
      // Wrapped x position so clouds loop instead of disappearing.
      let cx = c.baseX + WIND_SPEED * totalTime
      cx = ((cx + WRAP_X) % span + span) % span - WRAP_X

      dummy.position.set(cx + p.offX, c.baseY + p.offY, c.baseZ + p.offZ)
      dummy.scale.setScalar(p.scale)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      im.setMatrixAt(i, dummy.matrix)
    }
    im.instanceMatrix.needsUpdate = true
  }
  recompute()

  return {
    update: (dt: number) => {
      totalTime += dt
      recompute()
    },
    setTint: (color: string, opacity: number) => {
      cloudMat.color.set(color)
      cloudMat.opacity = opacity
      cloudMat.needsUpdate = true
    },
  }
}

// --- Horizon haze / atmospheric blending ---------------------------------

interface HazeController {
  setColor: (color: string) => void
}

function addHorizonHaze(group: THREE.Group, d: Disposables): HazeController {
  // Big translucent planes parallel to the four edges, sitting just behind
  // the skyline. Cheap fog impression that doesn't depend on scene.fog.
  const hazeMat = new THREE.MeshBasicMaterial({
    color: SKYLINE_CONFIG.hazeColor,
    transparent: true,
    opacity: SKYLINE_CONFIG.hazeOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  d.materials.push(hazeMat)

  const planeGeo = new THREE.PlaneGeometry(2400, 280)
  d.geometries.push(planeGeo)

  // North haze (most visible from the start straight).
  const north = new THREE.Mesh(planeGeo, hazeMat)
  north.position.set(0, 110, SKYLINE_CONFIG.northZ - 80)
  north.renderOrder = -1
  group.add(north)

  const south = new THREE.Mesh(planeGeo, hazeMat)
  south.position.set(0, 110, SKYLINE_CONFIG.southZ + 80)
  south.rotation.y = Math.PI
  south.renderOrder = -1
  group.add(south)

  const east = new THREE.Mesh(planeGeo, hazeMat)
  east.position.set(SKYLINE_CONFIG.eastX + 80, 110, 0)
  east.rotation.y = -Math.PI / 2
  east.renderOrder = -1
  group.add(east)

  const west = new THREE.Mesh(planeGeo, hazeMat)
  west.position.set(SKYLINE_CONFIG.westX - 80, 110, 0)
  west.rotation.y = Math.PI / 2
  west.renderOrder = -1
  group.add(west)

  return {
    setColor: (color: string) => {
      hazeMat.color.set(color)
      hazeMat.needsUpdate = true
    },
  }
}

// --- Service buildings + marshal posts -----------------------------------

function addServiceBuildings(
  group: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  d: Disposables,
): void {
  const serviceMat = new THREE.MeshStandardMaterial({
    color: '#bdbdbd',
    roughness: 0.85,
    metalness: 0,
  })
  const serviceRoofMat = new THREE.MeshStandardMaterial({
    color: '#4a4f55',
    roughness: 0.6,
    metalness: 0.2,
  })
  const marshalMat = new THREE.MeshStandardMaterial({
    color: '#e8e4d6',
    roughness: 0.9,
    metalness: 0,
  })
  const marshalRoofMat = new THREE.MeshStandardMaterial({
    color: '#d04a1a',
    roughness: 0.7,
    metalness: 0,
  })
  d.materials.push(serviceMat, serviceRoofMat, marshalMat, marshalRoofMat)

  const ts = [0.10, 0.22, 0.35, 0.55, 0.72, 0.88]
  const lat = new THREE.Vector3()
  const tan = new THREE.Vector3()

  ts.forEach((t, i) => {
    const p = curve.getPointAt(t)
    tan.copy(curve.getTangentAt(t))
    lateralAtForCurve(curve, t, lat)
    const yaw = yawFromTangent(tan)
    const side = i % 2 === 0 ? 1 : -1
    const offset = 40 + (i % 3) * 12

    const blockPos = p.clone().addScaledVector(lat, side * offset)
    blockPos.y = 4
    // 12 m lateral × 20 m along the track.
    group.add(makeBox(`service-${i}`, new THREE.Vector3(12, 8, 20), blockPos, yaw, serviceMat, d))
    const roofPos = blockPos.clone()
    roofPos.y = 8 + 0.4
    group.add(makeBox(`service-roof-${i}`, new THREE.Vector3(14, 0.8, 22), roofPos, yaw, serviceRoofMat, d))

    const marshalPos = p.clone().addScaledVector(lat, -side * (ROAD_HALF_WIDTH + KERB_WIDTH + 9))
    marshalPos.y = 1.5
    group.add(makeBox(`marshal-${i}`, new THREE.Vector3(4, 3, 4), marshalPos, yaw, marshalMat, d))
    const marshalRoofPos = marshalPos.clone()
    marshalRoofPos.y = 3 + 0.3
    group.add(makeBox(`marshal-roof-${i}`, new THREE.Vector3(4.6, 0.6, 4.6), marshalRoofPos, yaw, marshalRoofMat, d))
  })
}

// --- Master compositor: every trackside layer ----------------------------

function addTracksideEnvironment(
  group: THREE.Group,
  curve: THREE.Curve<THREE.Vector3>,
  d: Disposables,
): {
  clouds: CloudController
  haze: HazeController | null
  celestial: CelestialController
} {
  addBarriers(group, curve, d)
  addFences(group, curve, d)
  addLightPoles(group, curve, d)
  addPitAndGrandstand(group, curve, d)
  addServiceBuildings(group, curve, d)
  let haze: HazeController | null = null
  if (SKYLINE_ENABLED) {
    addProceduralSkyline(group, d)
    if (LANDMARK_CONFIG.enabled) addShanghaiLandmarkCluster(group, d)
    addHarborAndBridgeSilhouettes(group, d)
    haze = addHorizonHaze(group, d)
  }
  const clouds = addClouds(group, d)
  const celestial = addCelestialBodies(group, d)
  return { clouds, haze, celestial }
}

// --- Main entry point ----------------------------------------------------

export function createTrack(): TrackBundle {
  const points = RAW_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  const curve = buildBezierPath(points)
  const length = curve.getLength()

  const group = new THREE.Group()
  group.name = 'track'

  const disposables: Disposables = {
    geometries: [],
    materials: [],
    textures: [],
  }

  // --- Road surface as ribbon: build geometry from sampled points.
  // Use tangent × Y_UP for the lateral axis everywhere (road AND walls), so
  // they share one basis. Frenet frames degenerate on planar curves and
  // would put the road on a different side than the walls in tight corners.
  const samples = TRACK_SEGMENTS
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const uvs: number[] = []

  // Mid-gray asphalt — dark grays read as black under strong daylight + ACES.
  const asphaltCol = new THREE.Color('#5a5a60')
  const kerbRed = new THREE.Color('#d11')
  const kerbWhite = new THREE.Color('#f5f5f5')

  const lateralAt = (t: number, out: THREE.Vector3): THREE.Vector3 =>
    lateralAtForCurve(curve, t, out)

  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const p = curve.getPointAt(t % 1)
    const lateral = lateralAt(t, new THREE.Vector3())

    const left = p.clone().addScaledVector(lateral, -ROAD_HALF_WIDTH)
    const right = p.clone().addScaledVector(lateral, ROAD_HALF_WIDTH)
    const leftKerb = p.clone().addScaledVector(lateral, -(ROAD_HALF_WIDTH + KERB_WIDTH))
    const rightKerb = p.clone().addScaledVector(lateral, ROAD_HALF_WIDTH + KERB_WIDTH)

    // 4 vertices per ring: leftKerb, left, right, rightKerb
    // Sub-mm per-ring elevation bias (max ~0.05 m over the whole lap).
    // Invisible to the eye, but breaks coplanar z-fighting where the
    // road geometry self-overlaps in tight corners.
    const yBias = i * 0.000025
    positions.push(leftKerb.x, yBias, leftKerb.z)
    positions.push(left.x, yBias, left.z)
    positions.push(right.x, yBias, right.z)
    positions.push(rightKerb.x, yBias, rightKerb.z)

    // Kerb red/white alternating every ~4 segments. The thin painted
    // start/finish line is drawn separately as its own mesh (see below)
    // so it doesn't bleed across multiple road segments and cover the
    // grid-box outlines.
    const stripe = Math.floor(i / 4) % 2 === 0 ? kerbRed : kerbWhite
    colors.push(stripe.r, stripe.g, stripe.b)
    colors.push(asphaltCol.r, asphaltCol.g, asphaltCol.b)
    colors.push(asphaltCol.r, asphaltCol.g, asphaltCol.b)
    colors.push(stripe.r, stripe.g, stripe.b)

    const v = t * 80
    uvs.push(0, v, 0.1, v, 0.9, v, 1, v)
  }

  // Triangle-cull helper: only emit triangles whose face normal points
  // mostly upward (+Y). On Catmull-Rom self-intersections (T13 area), some
  // quads end up flipped because successive rings cross — those triangles
  // would render as a visible "perpendicular crossing" of the road.
  // Discarding them removes the visual artifact.
  const tryEmit = (i0: number, i1: number, i2: number): void => {
    const ax = positions[i0 * 3], az = positions[i0 * 3 + 2]
    const bx = positions[i1 * 3], bz = positions[i1 * 3 + 2]
    const cx = positions[i2 * 3], cz = positions[i2 * 3 + 2]
    // Cross product Z component (since geometry is in XZ plane with y≈0).
    // For winding (i0,i1,i2) with face normal +Y, the 2D signed area must be > 0.
    const signed2A = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
    // Note: signed2A > 0 ⇒ normal points -Y in right-handed (Y up); we
    // chose winding earlier so face normal is +Y, which means signed2A < 0.
    if (signed2A < -0.01) {
      indices.push(i0, i1, i2)
    }
  }

  for (let i = 0; i < samples; i++) {
    const a = i * 4
    const b = (i + 1) * 4
    for (let q = 0; q < 3; q++) {
      tryEmit(a + q, a + q + 1, b + q)
      tryEmit(a + q + 1, b + q + 1, b + q)
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geom.setIndex(indices)
  geom.computeVertexNormals()

  const roadMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
  })
  const road = new THREE.Mesh(geom, roadMat)
  road.receiveShadow = true
  group.add(road)

  // (Walls removed — kerbs in the road geometry are the only edge marker,
  // matching the look of the SIC reference photo. Smart Steering still pulls
  // the car back if it strays beyond HARD_OFFSET in physics.ts.)

  // --- Environment ground (satellite-style backdrop) + 2.5D scenery.
  const envGroup = createEnvironmentGround(disposables)
  group.add(envGroup)
  const { clouds, haze, celestial } = addTracksideEnvironment(group, curve, disposables)

  console.log('[track] environment texture:', ENV_TEXTURE_PATH)
  console.log('[track] ENV_ALIGNMENT:', ENV_ALIGNMENT)

  // --- Start/finish gantry: thin arch at t=0 above road.
  const gantryMat = new THREE.MeshStandardMaterial({ color: '#ff1801', roughness: 0.5 })
  const post = new THREE.BoxGeometry(0.5, 6, 0.5)
  const beam = new THREE.BoxGeometry(ROAD_HALF_WIDTH * 2 + 2, 0.5, 0.5)
  const startP = curve.getPointAt(0)
  const startT = curve.getTangentAt(0)
  const lat = new THREE.Vector3(-startT.z, 0, startT.x).normalize()
  const yaw = Math.atan2(startT.x, startT.z)

  // --- F1 starting-grid boxes painted on the asphalt.
  // No separate start/finish line — the gantry above already marks t=0
  // and a painted strip at the same elevation as the grid-box outlines
  // would visually merge with them.
  // Layout matches src/game/opponents.ts: 5 slots, 8 m staggered, ±3 m lat,
  // odd slots on pole side, even slots on off side. Box size is sized to a
  // real F1 grid box (≈3 m wide × 6 m long with a thin white outline). The
  // boxes sit a hair above road y to avoid z-fighting with the asphalt.
  {
    const GRID_SLOT_M = 8
    const POLE_LAT_M = 3
    const PLAYER_SLOT = 5
    const TOTAL_SLOTS = 5
    const BOX_W = 3.0
    const BOX_L = 6.0
    const BOX_THICK = 0.18
    const BOX_Y = 0.04

    const gridMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#ffffff',
      emissiveIntensity: 0.18,
      roughness: 1.0,
      metalness: 0,
    })
    disposables.materials.push(gridMat)
    // Two shared geometries: cross-track edge (front/back) and along-track
    // edge (left/right). 3 outline pieces per slot.
    const edgeCross = new THREE.BoxGeometry(BOX_W, 0.04, BOX_THICK)
    const edgeAlong = new THREE.BoxGeometry(BOX_THICK, 0.04, BOX_L)
    disposables.geometries.push(edgeCross, edgeAlong)

    for (let slot = 1; slot <= TOTAL_SLOTS; slot++) {
      const metresAhead = (PLAYER_SLOT - slot) * GRID_SLOT_M
      const sideSign = slot % 2 === 1 ? 1 : -1
      const center = startP
        .clone()
        .addScaledVector(startT, metresAhead)
        .addScaledVector(lat, sideSign * POLE_LAT_M)

      const placeEdge = (
        geo: THREE.BoxGeometry,
        forwardOffset: number,
        lateralOffset: number,
      ): void => {
        const m = new THREE.Mesh(geo, gridMat)
        m.position
          .copy(center)
          .addScaledVector(startT, forwardOffset)
          .addScaledVector(lat, lateralOffset)
        m.position.y = BOX_Y
        m.rotation.y = yaw
        m.receiveShadow = true
        group.add(m)
      }
      // Real F1 grid markings: a U-shape opening BACKWARDS — front line
      // + two side lines, no rear line. Driver enters the slot from behind
      // and lines the front wing up against the cross stripe. The lateral
      // stripes guide the driver to keep the car straight inside the box.
      placeEdge(edgeCross, BOX_L / 2, 0) // front cross stripe
      placeEdge(edgeAlong, 0, BOX_W / 2) // pole-side stripe
      placeEdge(edgeAlong, 0, -BOX_W / 2) // off-side stripe
    }
  }

  const left = new THREE.Mesh(post, gantryMat)
  left.position.copy(startP).addScaledVector(lat, -(ROAD_HALF_WIDTH + 1))
  left.position.y = 3
  left.rotation.y = yaw
  group.add(left)
  const right = new THREE.Mesh(post, gantryMat)
  right.position.copy(startP).addScaledVector(lat, ROAD_HALF_WIDTH + 1)
  right.position.y = 3
  right.rotation.y = yaw
  group.add(right)
  const top = new THREE.Mesh(beam, gantryMat)
  top.position.copy(startP)
  top.position.y = 6
  top.rotation.y = yaw
  group.add(top)

  // --- Closest-point projection for Smart Steering.
  // Pre-sample track to a high-density polyline for fast lookup.
  const lookupSamples = 800
  const lookup: { p: THREE.Vector3; t: number }[] = []
  for (let i = 0; i < lookupSamples; i++) {
    const t = i / lookupSamples
    lookup.push({ p: curve.getPointAt(t), t })
  }

  const projectToTrack = (
    worldPos: THREE.Vector3,
  ): { t: number; offset: number; closest: THREE.Vector3 } => {
    let bestD = Infinity
    let bestI = 0
    for (let i = 0; i < lookup.length; i++) {
      const dx = lookup[i].p.x - worldPos.x
      const dz = lookup[i].p.z - worldPos.z
      const d = dx * dx + dz * dz
      if (d < bestD) {
        bestD = d
        bestI = i
      }
    }
    const closest = lookup[bestI].p.clone()
    return { t: lookup[bestI].t, offset: Math.sqrt(bestD), closest }
  }

  return {
    group,
    curve,
    length,
    getPositionAt: (t: number) => curve.getPointAt(((t % 1) + 1) % 1),
    getTangentAt: (t: number) => curve.getTangentAt(((t % 1) + 1) % 1),
    projectToTrack,
    updateAtmosphere: clouds.update,
    applyWeather: (preset) => {
      clouds.setTint(preset.cloudColor, preset.cloudOpacity)
      haze?.setColor(preset.hazeColor)
      celestial.setVisible(preset.nightMode === true)
    },
    dispose: () => {
      geom.dispose()
      roadMat.dispose()
      post.dispose()
      beam.dispose()
      gantryMat.dispose()
      for (const g of disposables.geometries) g.dispose()
      for (const m of disposables.materials) m.dispose()
      for (const t of disposables.textures) t.dispose()
    },
  }
}
