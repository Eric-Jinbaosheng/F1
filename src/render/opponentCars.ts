import * as THREE from 'three'
import type { OpponentState } from '../game/opponents'

export interface OpponentCarBundle {
  group: THREE.Group
  update: (opps: OpponentState[]) => void
  dispose: () => void
}

interface ShellRefs {
  group: THREE.Group
  geos: THREE.BufferGeometry[]
  mats: THREE.Material[]
  wheels: THREE.Mesh[]
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

  return { group, geos, mats, wheels }
}

export function createOpponentCars(opps: OpponentState[]): OpponentCarBundle {
  const root = new THREE.Group()
  root.name = 'opponents'
  const shells: ShellRefs[] = []
  for (const opp of opps) {
    const shell = buildShell(opp.profile.color)
    shell.group.name = `opponent-${opp.profile.name}`
    shells.push(shell)
    root.add(shell.group)
  }

  const update = (s: OpponentState[]): void => {
    for (let i = 0; i < shells.length && i < s.length; i++) {
      shells[i].group.position.copy(s[i].pos)
      shells[i].group.rotation.y = s[i].heading
      const spin = s[i].speed * 0.35
      for (const w of shells[i].wheels) w.rotation.x += spin * 0.016
    }
  }

  const dispose = (): void => {
    for (const sh of shells) {
      for (const g of sh.geos) g.dispose()
      for (const m of sh.mats) m.dispose()
    }
  }

  return { group: root, update, dispose }
}
