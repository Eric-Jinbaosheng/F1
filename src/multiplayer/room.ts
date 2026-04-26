/**
 * LAN multiplayer room client. Wraps a WebSocket to the dev-time
 * `/__room__` relay and exposes a typed event API.
 *
 * Messaging model:
 *   - Server assigns numeric clientId on connect; first client = host.
 *   - All messages are JSON; relay tags each one with `from = senderId`.
 *   - Each client owns its own car (authoritative); broadcasts position
 *     20 Hz; other clients render received positions via `peers` Map.
 *   - Host triggers race start; everyone listens for `start`.
 *   - Crossing the line → broadcast `finish`; everyone tallies.
 *
 * The relay only exists in dev (`vite dev`); production build is offline.
 */

export interface PeerState {
  clientId: number
  name: string
  ready: boolean
  /** Latest position from the network (raw, no interpolation). */
  pos: { x: number; y: number; z: number }
  heading: number
  speed: number
  lapProgress: number
  lap: number
  /** Wall-clock ms when peer crossed the line; null = still racing. */
  finishedLapMs: number | null
  /** Last time we received any state from this peer (ms). */
  lastSeenAt: number
}

export interface RoomEvents {
  onConnect: (myId: number, isHost: boolean) => void
  onDisconnect: () => void
  onPeerJoin: (clientId: number) => void
  onPeerLeave: (clientId: number) => void
  onPeerHello: (clientId: number, name: string) => void
  onPeerReady: (clientId: number, ready: boolean) => void
  onPeerState: (state: PeerState) => void
  onStart: () => void
  onPeerFinish: (clientId: number, lapMs: number) => void
  onPromotedHost: () => void
  onError: (msg: string) => void
}

type RoomMsg =
  | { type: 'welcome'; clientId: number; isHost: boolean; roster: number[] }
  | { type: 'peer_join'; clientId: number }
  | { type: 'peer_leave'; clientId: number }
  | { type: 'promoted_host' }
  | { type: 'hello'; from: number; name: string }
  | { type: 'ready'; from: number; ready: boolean }
  | { type: 'start'; from: number }
  | {
      type: 'state'
      from: number
      pos: [number, number, number]
      heading: number
      speed: number
      lapProgress: number
      lap: number
    }
  | { type: 'finish'; from: number; lapMs: number }

const noop = (): void => {}

export class RoomClient {
  private ws: WebSocket | null = null
  private myId = 0
  private isHost = false
  private myName: string
  private peers = new Map<number, PeerState>()
  private listeners: RoomEvents
  private destroyed = false
  private reconnectTimer: number | null = null

  constructor(name: string, partial: Partial<RoomEvents> = {}) {
    this.myName = name
    this.listeners = {
      onConnect: partial.onConnect ?? noop,
      onDisconnect: partial.onDisconnect ?? noop,
      onPeerJoin: partial.onPeerJoin ?? noop,
      onPeerLeave: partial.onPeerLeave ?? noop,
      onPeerHello: partial.onPeerHello ?? noop,
      onPeerReady: partial.onPeerReady ?? noop,
      onPeerState: partial.onPeerState ?? noop,
      onStart: partial.onStart ?? noop,
      onPeerFinish: partial.onPeerFinish ?? noop,
      onPromotedHost: partial.onPromotedHost ?? noop,
      onError: partial.onError ?? noop,
    }
  }

  connect(): void {
    if (this.ws) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    // `__ROOM_LAN_HOST__` is injected by Vite at dev startup; if it's empty
    // (production build), we fall back to the page's own host so the user
    // gets a clear "connection failed" rather than an undefined URL.
    const host = (typeof __ROOM_LAN_HOST__ === 'string' && __ROOM_LAN_HOST__) || location.host
    const url = `${proto}://${host}${__ROOM_PATH__}`
    try {
      this.ws = new WebSocket(url)
    } catch (e) {
      this.listeners.onError(`无法连接到房间服务: ${String(e)}`)
      return
    }
    this.ws.addEventListener('open', () => {
      // Identify ourselves to the rest of the room.
      this.send({ type: 'hello', name: this.myName })
    })
    this.ws.addEventListener('close', () => {
      this.listeners.onDisconnect()
      this.ws = null
      // Try to reconnect once (handles vite restart) — give up after that.
      if (!this.destroyed && !this.reconnectTimer) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null
          if (!this.destroyed) this.connect()
        }, 1500)
      }
    })
    this.ws.addEventListener('error', () => {
      this.listeners.onError('房间连接出错')
    })
    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as RoomMsg
        this.handle(msg)
      } catch {
        /* noop */
      }
    })
  }

  private handle(msg: RoomMsg): void {
    switch (msg.type) {
      case 'welcome': {
        this.myId = msg.clientId
        this.isHost = msg.isHost
        this.listeners.onConnect(this.myId, this.isHost)
        // Pre-populate placeholder peer entries from the roster so the
        // lobby renders something immediately.
        for (const id of msg.roster) {
          this.upsertPeer(id, '玩家')
        }
        break
      }
      case 'peer_join':
        this.upsertPeer(msg.clientId, '玩家')
        this.listeners.onPeerJoin(msg.clientId)
        // Re-broadcast our own hello so the joiner learns our name.
        this.send({ type: 'hello', name: this.myName })
        break
      case 'peer_leave':
        this.peers.delete(msg.clientId)
        this.listeners.onPeerLeave(msg.clientId)
        break
      case 'hello': {
        const p = this.upsertPeer(msg.from, msg.name)
        p.name = msg.name
        this.listeners.onPeerHello(msg.from, msg.name)
        break
      }
      case 'ready': {
        const p = this.upsertPeer(msg.from, '玩家')
        p.ready = msg.ready
        this.listeners.onPeerReady(msg.from, msg.ready)
        break
      }
      case 'start':
        this.listeners.onStart()
        break
      case 'state': {
        const p = this.upsertPeer(msg.from, '玩家')
        p.pos = { x: msg.pos[0], y: msg.pos[1], z: msg.pos[2] }
        p.heading = msg.heading
        p.speed = msg.speed
        p.lapProgress = msg.lapProgress
        p.lap = msg.lap
        p.lastSeenAt = performance.now()
        this.listeners.onPeerState(p)
        break
      }
      case 'finish': {
        const p = this.upsertPeer(msg.from, '玩家')
        p.finishedLapMs = msg.lapMs
        this.listeners.onPeerFinish(msg.from, msg.lapMs)
        break
      }
      case 'promoted_host':
        this.isHost = true
        this.listeners.onPromotedHost()
        break
    }
  }

  private upsertPeer(clientId: number, fallbackName: string): PeerState {
    let p = this.peers.get(clientId)
    if (!p) {
      p = {
        clientId,
        name: fallbackName,
        ready: false,
        pos: { x: 0, y: 0, z: 0 },
        heading: 0,
        speed: 0,
        lapProgress: 0,
        lap: 0,
        finishedLapMs: null,
        lastSeenAt: performance.now(),
      }
      this.peers.set(clientId, p)
    }
    return p
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  // --- Public actions ----------------------------------------------------

  setReady(ready: boolean): void {
    this.send({ type: 'ready', ready })
  }

  startRace(): void {
    if (!this.isHost) return
    this.send({ type: 'start' })
  }

  sendState(state: {
    pos: { x: number; y: number; z: number }
    heading: number
    speed: number
    lapProgress: number
    lap: number
  }): void {
    this.send({
      type: 'state',
      pos: [state.pos.x, state.pos.y, state.pos.z],
      heading: state.heading,
      speed: state.speed,
      lapProgress: state.lapProgress,
      lap: state.lap,
    })
  }

  sendFinish(lapMs: number): void {
    this.send({ type: 'finish', lapMs })
  }

  getMyId(): number {
    return this.myId
  }
  getIsHost(): boolean {
    return this.isHost
  }
  getPeers(): PeerState[] {
    return Array.from(this.peers.values()).sort((a, b) => a.clientId - b.clientId)
  }
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1
  }

  disconnect(): void {
    this.destroyed = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.peers.clear()
  }
}

/** Per-clientId distinct colour so the rendering layer doesn't have to
 *  invent one. Mirrors the AI palette + 3 extra distinct hues. */
export function colourForClient(clientId: number): string {
  const palette = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#9b5de5']
  return palette[(clientId - 1) % palette.length]
}
