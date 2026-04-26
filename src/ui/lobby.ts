/**
 * LAN multiplayer lobby. Sits on top of the menu while players gather:
 * shows the roster, lets each client toggle "ready", and the host clicks
 * "开始比赛" once everyone is ready. Resolves when the host triggers start
 * (or the user backs out).
 */

import { RoomClient, colourForClient, type PeerState } from '../multiplayer/room'

export interface LobbyResult {
  status: 'started' | 'cancelled'
  client?: RoomClient
}

export interface LobbyController {
  /** Connects to the room, shows the lobby UI, resolves on start/cancel. */
  show: (playerName: string) => Promise<LobbyResult>
  hide: () => void
}

const LAN_HINT = (): string => {
  // Show LAN URL so other devices know where to connect.
  const host = (typeof __ROOM_LAN_HOST__ === 'string' && __ROOM_LAN_HOST__) || location.host
  return `http://${host}/index.html`
}

export function createLobby(): LobbyController {
  let host: HTMLDivElement | null = null
  let resolveFn: ((r: LobbyResult) => void) | null = null
  let client: RoomClient | null = null

  const hide = (): void => {
    if (host && host.parentElement) host.parentElement.removeChild(host)
    host = null
  }

  const show = (playerName: string): Promise<LobbyResult> => {
    hide()
    return new Promise<LobbyResult>((resolve) => {
      resolveFn = resolve

      host = document.createElement('div')
      host.style.cssText = `
        position: fixed; inset: 0; z-index: 100;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: linear-gradient(180deg, rgba(10,14,26,0.85), rgba(10,14,26,0.95));
        color: #fff; gap: 16px; padding: 24px;
        font-family: -apple-system, "PingFang SC", BlinkMacSystemFont, sans-serif;
      `

      const title = document.createElement('div')
      title.textContent = '联 机 大 厅'
      title.style.cssText = 'font-size: 32px; font-weight: 900; letter-spacing: 6px;'

      const status = document.createElement('div')
      status.textContent = '正在连接房间...'
      status.style.cssText = 'font-size: 13px; color: #aaa; letter-spacing: 2px; min-height: 18px;'

      // LAN URL display — peers paste this into their own browsers.
      const urlBox = document.createElement('div')
      urlBox.style.cssText = `
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        padding: 10px 18px; border: 1px dashed #ff8800; border-radius: 8px;
        background: rgba(255,136,0,0.08);
      `
      const urlLabel = document.createElement('div')
      urlLabel.textContent = '邀请其他玩家在浏览器打开此地址(同一 WiFi)'
      urlLabel.style.cssText = 'font-size: 12px; color: #ffb060;'
      const urlText = document.createElement('div')
      urlText.textContent = LAN_HINT()
      urlText.style.cssText = `
        font-family: ui-monospace, Menlo, Consolas, monospace;
        font-size: 14px; font-weight: 700; color: #fff;
        background: rgba(0,0,0,0.4); padding: 6px 12px; border-radius: 6px;
        letter-spacing: 1px; user-select: all;
      `
      urlBox.appendChild(urlLabel)
      urlBox.appendChild(urlText)

      const rosterCaption = document.createElement('div')
      rosterCaption.textContent = '在 线 玩 家'
      rosterCaption.style.cssText = 'font-size: 13px; color: #aaa; letter-spacing: 4px; margin-top: 6px;'

      const rosterEl = document.createElement('div')
      rosterEl.style.cssText = `
        display: flex; flex-direction: column; gap: 6px;
        min-width: 320px; max-width: 90vw;
        padding: 12px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
      `

      // Headline summary that drives the "should I start now?" decision.
      // Updates colour + text whenever the roster / ready states change.
      const summary = document.createElement('div')
      summary.style.cssText = `
        font-size: 13px; letter-spacing: 2px; text-align: center;
        padding: 6px 14px; border-radius: 6px;
        min-width: 320px;
      `

      const buttonRow = document.createElement('div')
      buttonRow.style.cssText = 'display: flex; gap: 12px; margin-top: 8px;'

      const readyBtn = document.createElement('button')
      readyBtn.textContent = '我 已 准 备'
      readyBtn.style.cssText = `
        min-width: 160px; min-height: 56px;
        background: transparent; color: #fff; border: 2px solid #06d6a0; border-radius: 8px;
        font-size: 16px; font-weight: 800; letter-spacing: 4px; cursor: pointer;
      `
      let myReady = false
      const paintReady = (): void => {
        readyBtn.textContent = myReady ? '✓ 已 准 备' : '我 已 准 备'
        readyBtn.style.background = myReady ? '#06d6a0' : 'transparent'
        readyBtn.style.color = myReady ? '#0a1418' : '#fff'
      }
      readyBtn.addEventListener('click', () => {
        myReady = !myReady
        paintReady()
        client?.setReady(myReady)
      })

      const startBtn = document.createElement('button')
      startBtn.textContent = '开 始 比 赛'
      startBtn.style.cssText = `
        min-width: 200px; min-height: 56px;
        background: #ff1801; color: #fff; border: none; border-radius: 8px;
        font-size: 18px; font-weight: 900; letter-spacing: 4px; cursor: pointer;
        display: none;
      `
      startBtn.addEventListener('click', () => {
        if (!client) return
        // Empty slots fill with local AI bots automatically, so it's OK
        // to start with zero peers (you race vs 3 AI).
        client.startRace()
        // The host's own onStart isn't fired (server doesn't echo back to
        // sender) so trigger locally here too.
        finish('started')
      })

      const cancelBtn = document.createElement('button')
      cancelBtn.textContent = '返 回'
      cancelBtn.style.cssText = `
        min-width: 120px; min-height: 56px;
        background: transparent; color: #aaa; border: 1px solid #555; border-radius: 8px;
        font-size: 14px; font-weight: 700; letter-spacing: 4px; cursor: pointer;
      `
      cancelBtn.addEventListener('click', () => finish('cancelled'))

      buttonRow.appendChild(readyBtn)
      buttonRow.appendChild(startBtn)
      buttonRow.appendChild(cancelBtn)

      const note = document.createElement('div')
      note.style.cssText = 'font-size: 11px; color: #888; max-width: 380px; text-align: center; line-height: 1.5;'
      note.textContent = '主机随时可点开始 · 建议等所有真人变绿后再上 · 空位由 AI 补足到 4 人场 · 同一 WiFi · 仅开发模式'

      host.appendChild(title)
      host.appendChild(status)
      host.appendChild(urlBox)
      host.appendChild(rosterCaption)
      host.appendChild(rosterEl)
      host.appendChild(summary)
      host.appendChild(buttonRow)
      host.appendChild(note)
      document.body.appendChild(host)

      const renderRoster = (peers: PeerState[], myId: number, isHost: boolean): void => {
        rosterEl.innerHTML = ''
        // Make sure we always show ourselves first if we're not in the
        // peer list (server doesn't echo our hello back to us).
        const seen = new Set(peers.map((p) => p.clientId))
        const display: Array<{ id: number; name: string; ready: boolean; isMe: boolean; isHost: boolean }> = []
        if (!seen.has(myId) && myId > 0) {
          display.push({ id: myId, name: playerName + ' (我)', ready: myReady, isMe: true, isHost })
        }
        for (const p of peers) {
          display.push({
            id: p.clientId,
            name: p.name + (p.clientId === myId ? ' (我)' : ''),
            ready: p.clientId === myId ? myReady : p.ready,
            isMe: p.clientId === myId,
            isHost: p.clientId === 1, // first connect = host (server convention)
          })
        }

        // --- Summary banner: tells the host whether to keep waiting or
        // hit start. Three states:
        //   1. Solo  → "无其他玩家 · 可立即开始"
        //   2. Some not ready → "X / Y 已准备 · 建议等待"
        //   3. All ready → "全部已准备 · 现在就上!"
        const total = display.length
        const others = display.filter((r) => !r.isMe)
        const readyOthers = others.filter((r) => r.ready).length
        const aiSlots = Math.max(0, 3 - others.length)
        let summaryText: string
        let summaryFg = '#fff'
        let summaryBg = 'rgba(255,255,255,0.05)'
        if (others.length === 0) {
          summaryText = `当前 1 人 · 空 ${aiSlots} 位由 AI 补足 · 可直接开始`
          summaryFg = '#ffd166'
          summaryBg = 'rgba(255,209,102,0.1)'
        } else if (readyOthers < others.length) {
          summaryText = `已准备 ${readyOthers} / ${others.length} 真人 · 建议等待全部就绪${aiSlots > 0 ? ` (空 ${aiSlots} 位将用 AI)` : ''}`
          summaryFg = '#888'
          summaryBg = 'rgba(255,255,255,0.04)'
        } else {
          summaryText = `✓ 全部 ${others.length} 名真人已准备${aiSlots > 0 ? ` · 空 ${aiSlots} 位用 AI` : ''} · 现在就上!`
          summaryFg = '#06d6a0'
          summaryBg = 'rgba(6,214,160,0.12)'
        }
        summary.textContent = summaryText
        summary.style.color = summaryFg
        summary.style.background = summaryBg

        // Boost the start button when conditions are ideal so the host
        // sees the "go now!" cue without having to count rows manually.
        const allReady = others.length === 0 || readyOthers === others.length
        startBtn.textContent = allReady ? '🏁 立 即 开 始' : '开 始 比 赛 (不再等待)'
        startBtn.style.boxShadow = allReady ? '0 0 18px rgba(255,24,1,0.7)' : 'none'
        startBtn.style.transform = allReady ? 'scale(1.04)' : 'scale(1.0)'
        startBtn.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease'
        void total

        for (const row of display) {
          const r = document.createElement('div')
          r.style.cssText = `
            display: flex; align-items: center; gap: 12px;
            padding: 8px 12px; border-radius: 6px;
            background: ${row.isMe ? 'rgba(6,214,160,0.08)' : 'rgba(255,255,255,0.03)'};
          `
          const dot = document.createElement('div')
          dot.style.cssText = `
            width: 12px; height: 12px; border-radius: 50%;
            background: ${colourForClient(row.id)};
            box-shadow: 0 0 8px ${colourForClient(row.id)};
            flex: 0 0 auto;
          `
          const name = document.createElement('div')
          name.textContent = row.name
          name.style.cssText = 'flex: 1 1 auto; font-size: 14px; font-weight: 600;'
          const tag = document.createElement('div')
          tag.style.cssText = 'font-size: 11px; letter-spacing: 2px;'
          if (row.isHost) {
            tag.textContent = '主机'
            tag.style.color = '#ffd166'
          } else if (row.ready) {
            tag.textContent = '✓ 已准备'
            tag.style.color = '#06d6a0'
          } else {
            tag.textContent = '等待中'
            tag.style.color = '#888'
          }
          r.appendChild(dot)
          r.appendChild(name)
          r.appendChild(tag)
          rosterEl.appendChild(r)
        }
      }

      // --- Wire up the room client.
      const refresh = (): void => {
        if (!client) return
        renderRoster(client.getPeers(), client.getMyId(), client.getIsHost())
        startBtn.style.display = client.getIsHost() ? '' : 'none'
      }
      const finish = (statusKind: 'started' | 'cancelled'): void => {
        if (!resolveFn) return
        const r = resolveFn
        resolveFn = null
        if (statusKind === 'cancelled') {
          client?.disconnect()
          client = null
        }
        hide()
        r({ status: statusKind, client: statusKind === 'started' ? client ?? undefined : undefined })
      }

      client = new RoomClient(playerName, {
        onConnect: (myId, isHost) => {
          status.textContent = isHost
            ? `✓ 已连接 · 你是主机(ID ${myId})`
            : `✓ 已连接 · 你是玩家 ${myId}`
          status.style.color = '#06d6a0'
          refresh()
        },
        onDisconnect: () => {
          status.textContent = '与房间断开 · 1.5 秒后重连...'
          status.style.color = '#ef476f'
        },
        onPeerJoin: refresh,
        onPeerLeave: refresh,
        onPeerHello: refresh,
        onPeerReady: refresh,
        onStart: () => finish('started'),
        onPromotedHost: () => {
          status.textContent = '原主机离开 · 你被晋升为主机'
          status.style.color = '#ffd166'
          refresh()
        },
        onError: (msg) => {
          status.textContent = msg
          status.style.color = '#ef476f'
        },
      })
      client.connect()
    })
  }

  return { show, hide }
}
