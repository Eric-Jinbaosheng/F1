import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ROOM_PATH = '/__room__'

function detectLanIP(): string {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return 'localhost'
}

const lanIp = detectLanIP()

/**
 * LAN multiplayer relay. Spins up a WebSocket server on the same port as
 * Vite (dev only — `apply: 'serve'`). Each connected client gets a numeric
 * id and the first one is flagged as host. All client messages are
 * broadcast to the others, tagged with `from = senderId`.
 *
 * The production build (`vite build`) does NOT include this plugin, so
 * the offline single-file output is unaffected.
 */
function roomBridge(): Plugin {
  return {
    name: 'room-bridge',
    apply: 'serve',
    async configureServer(server) {
      const { WebSocketServer } = await import('ws')
      const wss = new WebSocketServer({ noServer: true })

      type WSClient = import('ws').WebSocket
      let nextId = 1
      const clients = new Map<number, WSClient>()

      const send = (ws: WSClient, msg: unknown): void => {
        if (ws.readyState === 1) ws.send(JSON.stringify(msg))
      }
      const broadcast = (senderId: number | null, msg: unknown): void => {
        const data = JSON.stringify(msg)
        for (const [id, ws] of clients) {
          if (id !== senderId && ws.readyState === 1) ws.send(data)
        }
      }

      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (req.url === ROOM_PATH) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req)
          })
        }
      })

      wss.on('connection', (ws: WSClient) => {
        const id = nextId++
        clients.set(id, ws)
        const isHost = clients.size === 1
        // Welcome packet — tells the new client who they are + the
        // current roster so the lobby can populate itself.
        send(ws, {
          type: 'welcome',
          clientId: id,
          isHost,
          roster: Array.from(clients.keys()).filter((k) => k !== id),
        })
        broadcast(id, { type: 'peer_join', clientId: id })

        ws.on('message', (data: Buffer) => {
          let msg: Record<string, unknown>
          try {
            msg = JSON.parse(data.toString())
          } catch {
            return
          }
          // Always tag with sender so peers know who it came from.
          msg.from = id
          broadcast(id, msg)
        })

        ws.on('close', () => {
          clients.delete(id)
          broadcast(null, { type: 'peer_leave', clientId: id })
          // If host left, promote the lowest-id remaining client.
          if (isHost && clients.size > 0) {
            const newHostId = Math.min(...clients.keys())
            const newHost = clients.get(newHostId)
            if (newHost) send(newHost, { type: 'promoted_host' })
          }
        })
      })

      server.config.logger.info(
        `\n  [33m➤ LAN multiplayer:[0m  ws://${lanIp}:5188${ROOM_PATH}\n`,
      )
    },
  }
}

export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true }), roomBridge()],
  define: {
    __ROOM_LAN_HOST__: JSON.stringify(`${lanIp}:5188`),
    __ROOM_PATH__: JSON.stringify(ROOM_PATH),
  },
  build: {
    target: 'esnext',
    minify: 'terser',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
    terserOptions: {
      ecma: 2020,
      compress: {
        passes: 3,
        drop_console: false,
      },
      // No `unsafe_arrows` / `unsafe` — they convert constructor functions
      // into arrow functions, which then fail when `new`-ed and surface as
      // "TypeError: ... is not a constructor" at runtime in stricter
      // sandboxes (e.g. Douyin virtual creator). No `mangle.properties` —
      // that renames Three.js internal `_*` fields and breaks rendering.
      format: { comments: false },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5188,
    strictPort: true,
    open: 'http://localhost:5188/index.html',
  },
})
