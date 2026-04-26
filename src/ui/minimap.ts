/**
 * Top-left mini-map. Renders the track silhouette once on creation and
 * draws coloured dots for the player + each AI every frame.
 *
 * Coordinates: world (x, z) — y is up but irrelevant here.
 * Drawing: Canvas2D, single draw call per frame (cheap; ≈250 line ops).
 */

import type { TrackBundle } from '../render/track'

const MAP_W = 180
const MAP_H = 130
const PADDING = 10

const COLORS = {
  bg: 'rgba(8,12,22,0.65)',
  track: 'rgba(255,255,255,0.88)',
  trackBorder: 'rgba(0,0,0,0.45)',
  player: '#ffffff',
  playerEdge: '#ff1801',
  startLine: '#25f4ee',
}

export interface MinimapDot {
  x: number
  z: number
  color: string
}

export interface MinimapController {
  show: () => void
  hide: () => void
  update: (data: {
    player: { x: number; z: number }
    opponents: MinimapDot[]
  }) => void
  dispose: () => void
}

export function createMinimap(track: TrackBundle): MinimapController {
  let host: HTMLDivElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null

  // --- One-time: sample the track curve, compute bbox, derive a
  // world→pixel fit transform that preserves aspect ratio.
  const samples = 260
  const pts: Array<[number, number]> = []
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i <= samples; i++) {
    const p = track.getPositionAt((i / samples) % 1)
    pts.push([p.x, p.z])
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  const trackW = maxX - minX || 1
  const trackH = maxZ - minZ || 1
  const fitW = MAP_W - PADDING * 2
  const fitH = MAP_H - PADDING * 2
  const scale = Math.min(fitW / trackW, fitH / trackH)
  const offX = PADDING + (fitW - trackW * scale) / 2 - minX * scale
  const offZ = PADDING + (fitH - trackH * scale) / 2 - minZ * scale
  const project = (x: number, z: number): [number, number] => [
    x * scale + offX,
    z * scale + offZ,
  ]

  // Cache the start/finish position so we can highlight it on the map.
  const start = track.getPositionAt(0)

  const draw = (player: { x: number; z: number }, opponents: MinimapDot[]): void => {
    if (!ctx) return
    ctx.clearRect(0, 0, MAP_W, MAP_H)

    // Rounded background.
    ctx.fillStyle = COLORS.bg
    ctx.beginPath()
    const r = 8
    ctx.moveTo(r, 0)
    ctx.lineTo(MAP_W - r, 0)
    ctx.quadraticCurveTo(MAP_W, 0, MAP_W, r)
    ctx.lineTo(MAP_W, MAP_H - r)
    ctx.quadraticCurveTo(MAP_W, MAP_H, MAP_W - r, MAP_H)
    ctx.lineTo(r, MAP_H)
    ctx.quadraticCurveTo(0, MAP_H, 0, MAP_H - r)
    ctx.lineTo(0, r)
    ctx.quadraticCurveTo(0, 0, r, 0)
    ctx.closePath()
    ctx.fill()

    // Track silhouette: dark border under, bright stroke on top.
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const pass of [
      { stroke: COLORS.trackBorder, w: 6 },
      { stroke: COLORS.track, w: 4 },
    ]) {
      ctx.strokeStyle = pass.stroke
      ctx.lineWidth = pass.w
      ctx.beginPath()
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = project(pts[i][0], pts[i][1])
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }

    // Start/finish marker.
    const [sx, sy] = project(start.x, start.z)
    ctx.fillStyle = COLORS.startLine
    ctx.beginPath()
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2)
    ctx.fill()

    // Opponent dots (under the player).
    for (const opp of opponents) {
      const [px, py] = project(opp.x, opp.z)
      ctx.fillStyle = opp.color
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(px, py, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // Player dot — bigger + red ring so it always reads.
    const [ppx, ppy] = project(player.x, player.z)
    ctx.fillStyle = COLORS.player
    ctx.beginPath()
    ctx.arc(ppx, ppy, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = COLORS.playerEdge
    ctx.lineWidth = 2
    ctx.stroke()
  }

  const show = (): void => {
    if (host) return
    host = document.createElement('div')
    host.style.cssText = `
      position: fixed; left: 16px; top: 16px;
      z-index: 55;
      pointer-events: none;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.6));
    `
    canvas = document.createElement('canvas')
    canvas.width = MAP_W
    canvas.height = MAP_H
    canvas.style.cssText = `
      display: block;
      width: ${MAP_W}px;
      height: ${MAP_H}px;
    `
    ctx = canvas.getContext('2d')
    host.appendChild(canvas)
    document.body.appendChild(host)
  }

  const hide = (): void => {
    if (host && host.parentElement) host.parentElement.removeChild(host)
    host = null
    canvas = null
    ctx = null
  }

  const update = (data: {
    player: { x: number; z: number }
    opponents: MinimapDot[]
  }): void => {
    if (!ctx) return
    draw(data.player, data.opponents)
  }

  return { show, hide, update, dispose: hide }
}
