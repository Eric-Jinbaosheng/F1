import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { OpponentState } from '../game/opponents'
import mclarenGlbUrl from '../assets/models/McLaren_MCL35M.opt.glb?url'
import ferrariGlbUrl from '../assets/models/Ferrari_26.opt.glb?url'
import mercedesGlbUrl from '../assets/models/Mercedes_W13.glb?url'
import redbullGlbUrl from '../assets/models/RB19_REDBULL.opt.glb?url'
import dracoDecoderJs from 'three/examples/jsm/libs/draco/gltf/draco_decoder.js?raw'

export interface OpponentCarBundle {
  group: THREE.Group
  ready: Promise<void>
  update: (opps: OpponentState[]) => void
  dispose: () => void
}

interface ShellRefs {
  group: THREE.Group
  geos: THREE.BufferGeometry[]
  mats: THREE.Material[]
  wheels: THREE.Mesh[]
  /** When the GLB has resolved for this opponent, the placeholder pieces
   *  below are detached and disposed; the GLB scene becomes the visible
   *  child of `group`. */
  placeholderActive: boolean
}

interface NpcModel {
  url: string
  /** Some GLB packs export the chassis with the nose along -Z; the fit
   *  algorithm aligns the longest axis with +Z but cannot tell which end
   *  is the nose. Set true for those packs to flip 180° around Y. */
  reverse?: boolean
}

/** Map opponent profile name → GLB to swap the placeholder for. The names
 *  must match PROFILES in src/game/opponents.ts. */
const NPC_MODELS: Record<string, NpcModel> = {
  Veteran: { url: mercedesGlbUrl, reverse: true },
  Aggressor: { url: mclarenGlbUrl },
  Rookie: { url: ferrariGlbUrl, reverse: true },
  RedBull: { url: redbullGlbUrl },
}

/** Target on-track HEIGHT for NPC GLBs. RB19 ends up ≈0.88 m tall after
 *  the player car's planar (length-based) fit; the McLaren / Ferrari /
 *  Mercedes packs are slightly narrower at the same length so they look
 *  "thinner" — visibly smaller — than RB19. Scaling NPCs by HEIGHT to a
 *  larger target uniformly bumps them up so they read as full-size F1
 *  cars next to the player. Tweak here if they feel too big/small. */
const NPC_TARGET_HEIGHT_M = 1.15

let dracoLoader: DRACOLoader | null = null

function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderConfig({ type: 'js' })
    dracoLoader.setWorkerLimit(1)
    ;(dracoLoader as unknown as {
      _loadLibrary: (url: string, responseType: string) => Promise<string | ArrayBuffer>
    })._loadLibrary = async (url: string) => {
      if (url.endsWith('draco_decoder.js')) return dracoDecoderJs
      throw new Error(`Unsupported Draco decoder asset: ${url}`)
    }
  }
  return dracoLoader
}

function buildShell(color: string): ShellRefs {
  const group = new THREE.Group()
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const wheels: THREE.Mesh[] = []

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6 })
  const tireMat = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.95 })
  const accentMat = new THREE.MeshStandardMaterial({ color: '#181818', roughness: 0.6, metalness: 0.4 })
  mats.push(bodyMat, tireMat, accentMat)

  const body = new THREE.BoxGeometry(1.6, 0.35, 4.4)
  const nose = new THREE.ConeGeometry(0.4, 1.4, 6)
  const fin = new THREE.BoxGeometry(1.6, 0.6, 0.08)
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 12)
  geos.push(body, nose, fin, wheelGeo)

  const m1 = new THREE.Mesh(body, bodyMat); m1.position.y = 0.35; m1.castShadow = true
  const m2 = new THREE.Mesh(nose, bodyMat); m2.rotation.x = Math.PI / 2; m2.position.set(0, 0.4, 2.6); m2.castShadow = true
  const m3 = new THREE.Mesh(fin, accentMat); m3.position.set(0, 0.95, -2.0); m3.castShadow = true
  group.add(m1, m2, m3)

  for (const [x, z] of [[-0.95, 1.6], [0.95, 1.6], [-0.95, -1.6], [0.95, -1.6]] as [number, number][]) {
    const w = new THREE.Mesh(wheelGeo, tireMat)
    w.rotation.z = Math.PI / 2
    w.position.set(x, 0.45, z)
    w.castShadow = true
    wheels.push(w)
    group.add(w)
  }

  return { group, geos, mats, wheels, placeholderActive: true }
}

function disposePlaceholder(shell: ShellRefs): void {
  for (const g of shell.geos) g.dispose()
  for (const m of shell.mats) m.dispose()
  shell.geos.length = 0
  shell.mats.length = 0
  shell.wheels.length = 0
  while (shell.group.children.length) shell.group.remove(shell.group.children[0])
}

/** Auto-orient & scale an NPC GLB so its HEIGHT matches the player's RB19
 *  (≈0.88 m post-fit). Different model packs ship with very different
 *  length-to-width-to-height ratios — some have tall rear wings, others
 *  have wide front wings. Scaling by HEIGHT (not planar length) makes all
 *  cars visually "as tall as" the player car, which the eye reads as the
 *  same overall size; planar length follows proportionally and the nose
 *  ends up along +Z (the game's forward axis). */
function fitGltfToTrack(model: THREE.Object3D): void {
  // Pass 1: scale by height.
  let bbox = new THREE.Box3().setFromObject(model)
  let size = bbox.getSize(new THREE.Vector3())
  if (size.y > 0) model.scale.setScalar(NPC_TARGET_HEIGHT_M / size.y)

  // Recompute after scale, then center horizontally and float to y=0.
  bbox = new THREE.Box3().setFromObject(model)
  size = bbox.getSize(new THREE.Vector3())
  const center = bbox.getCenter(new THREE.Vector3())
  model.position.x -= center.x
  model.position.y -= bbox.min.y
  model.position.z -= center.z

  // If the model was authored with nose along ±X, rotate so nose ends up
  // along +Z (game forward). Detection: longer axis is X, not Z.
  if (size.x > size.z * 1.1) {
    model.rotation.y = -Math.PI / 2
    bbox = new THREE.Box3().setFromObject(model)
    const c2 = bbox.getCenter(new THREE.Vector3())
    model.position.x -= c2.x
    model.position.z -= c2.z
    model.position.y -= bbox.min.y
  }
}

/** Singleton per-URL loader cache so multiple opponents that share a model
 *  decode it once. */
const sceneCache = new Map<string, Promise<THREE.Group>>()
function loadScene(model: NpcModel): Promise<THREE.Group> {
  const { url, reverse } = model
  let p = sceneCache.get(url)
  if (!p) {
    p = (async () => {
      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      loader.setDRACOLoader(getDracoLoader())
      const res = await fetch(url)
      const buf = await res.arrayBuffer()
      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        loader.parse(buf, '', (g) => resolve(g as unknown as { scene: THREE.Group }), reject)
      })
      const scene = gltf.scene
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh) {
          mesh.castShadow = true
          mesh.receiveShadow = false
          mesh.frustumCulled = true
        }
      })
      fitGltfToTrack(scene)
      if (reverse) {
        // Wrap in an outer group rotated 180° so the existing pos/rot from
        // fitGltfToTrack is preserved and the visual nose now points -Z (in
        // local space) → +Z after the rotation. We can't simply tweak
        // scene.rotation.y because fitGltfToTrack may have set it to -π/2
        // already; composing here would require recomputing the bbox-based
        // recentre. The wrapper is cleaner.
        const wrapper = new THREE.Group()
        wrapper.rotation.y = Math.PI
        wrapper.add(scene)
        // Recentre the wrapper so the floor stays at y=0 and the nose-tip
        // ends up at the origin's forward axis as the other models do.
        const bbox = new THREE.Box3().setFromObject(wrapper)
        const c = bbox.getCenter(new THREE.Vector3())
        wrapper.position.x -= c.x
        wrapper.position.z -= c.z
        wrapper.position.y -= bbox.min.y
        return wrapper
      }
      return scene
    })().catch((e) => {
      console.warn('[F1S] NPC GLB load failed:', url, e)
      sceneCache.delete(url)
      throw e
    })
    sceneCache.set(url, p)
  }
  return p
}

export function createOpponentCars(opps: OpponentState[]): OpponentCarBundle {
  const root = new THREE.Group()
  root.name = 'opponents'
  const shells: ShellRefs[] = []
  const loads: Promise<void>[] = []

  for (const opp of opps) {
    const shell = buildShell(opp.profile.color)
    shell.group.name = `opponent-${opp.profile.name}`
    shells.push(shell)
    root.add(shell.group)

    const npcModel = NPC_MODELS[opp.profile.name]
    if (npcModel) {
      const load = loadScene(npcModel).then((scene) => {
        if (!shell.placeholderActive) return
        disposePlaceholder(shell)
        const cloned = scene.clone(true)
        shell.group.add(cloned)
        shell.placeholderActive = false
      }).catch(() => {
        // Keep placeholder visible.
      })
      loads.push(load)
    }
  }

  const ready = Promise.all(loads).then(() => undefined)

  const update = (s: OpponentState[]): void => {
    for (let i = 0; i < shells.length && i < s.length; i++) {
      shells[i].group.position.copy(s[i].pos)
      shells[i].group.rotation.y = s[i].heading
      // Wheel spin only on the procedural placeholder; GLB wheels aren't
      // tagged, and AI cars are rarely close enough for it to matter.
      if (shells[i].placeholderActive) {
        const spin = s[i].speed * 0.35
        for (const w of shells[i].wheels) w.rotation.x += spin * 0.016
      }
    }
  }

  const dispose = (): void => {
    for (const sh of shells) {
      if (sh.placeholderActive) {
        for (const g of sh.geos) g.dispose()
        for (const m of sh.mats) m.dispose()
      }
      // Cloned GLB scenes share the cached source's geos/mats; let GC
      // reclaim them when this root is detached from the scene.
    }
  }

  return { group: root, ready, update, dispose }
}
