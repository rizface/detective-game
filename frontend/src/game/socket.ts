import { useEffect } from 'react'
import { useGame } from './store'

let current: WebSocket | null = null

/** Send an ephemeral message (board drag, "viewing") to teammates. */
export function sendLive(type: string, payload: unknown) {
  if (current && current.readyState === WebSocket.OPEN) {
    current.send(JSON.stringify({ type, payload }))
  }
}

let lastDrag = 0
export function sendDrag(id: string, x: number, y: number) {
  const now = performance.now()
  if (now - lastDrag < 50) return
  lastDrag = now
  sendLive('board.drag', { id, x, y })
}

/** Keeps a WebSocket open for the team, reconnecting with backoff and
 *  resyncing the snapshot after a reconnect (we may have missed events). */
export function useTeamSocket(teamId: string | undefined) {
  useEffect(() => {
    if (!teamId) return
    let closed = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/teams/${teamId}/ws`)
      current = ws
      useGame.setState({ socketState: 'connecting' })
      ws.onopen = () => {
        useGame.setState({ socketState: 'open' })
        if (attempt > 0) useGame.getState().load(teamId)
        attempt = 0
      }
      ws.onmessage = (ev) => {
        try {
          useGame.getState().handleSocket(JSON.parse(ev.data))
        } catch {
          /* ignore malformed */
        }
      }
      ws.onclose = () => {
        if (current === ws) current = null
        useGame.setState({ socketState: 'closed' })
        if (closed) return
        attempt++
        timer = setTimeout(connect, Math.min(10000, 500 * 2 ** attempt))
      }
    }
    connect()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      current?.close()
      current = null
    }
  }, [teamId])
}
