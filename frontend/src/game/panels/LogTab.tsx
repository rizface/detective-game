import { useState } from 'react'
import { api } from '../../api'
import type { EventRow } from '../../types'
import { memberById, useGame } from '../store'
import { eventSummary } from '../Outcome'
import { clockAt } from '../util'

export default function LogTab() {
  const snap = useGame((s) => s.snap)!
  const [older, setOlder] = useState<EventRow[]>([])
  const [done, setDone] = useState(false)
  const events = [...older, ...snap.events]

  const loadOlder = async () => {
    const first = events[0]
    if (!first) return
    const page = await api<EventRow[]>(`/teams/${snap.team.id}/events?before=${first.id}`)
    if (page.length === 0) setDone(true)
    setOlder([...page, ...older])
  }

  const open = (e: EventRow) => {
    if (e.kind !== 'action') return
    // Make sure the Scene tab can find older events too.
    if (!snap.events.some((x) => x.id === e.id)) {
      const merged = [...older, ...snap.events].sort((a, b) => a.id - b.id)
      useGame.setState({ snap: { ...snap, events: merged } })
    }
    useGame.setState({ focusEvent: e.id, tab: 'scene' })
  }

  let lastDay = ''
  return (
    <div className="log">
      {!done && events.length >= 120 && (
        <button className="btn small ghost" onClick={loadOlder}>
          Show earlier
        </button>
      )}
      <ol className="log-list">
        {events.map((e) => {
          const t = clockAt(snap, e.clock)
          const dayHead = t.day !== lastDay ? t.day : null
          lastDay = t.day
          const by = memberById(snap, e.by)
          return (
            <li key={e.id}>
              {dayHead && <h4 className="log-day">{dayHead}</h4>}
              <button className={`log-row kind-${e.kind}`} onClick={() => open(e)} disabled={e.kind !== 'action'}>
                <span className="log-time">{t.time}</span>
                <span className="log-what">{eventSummary(snap, e)}</span>
                {by && <span className="dot" style={{ background: by.color }} title={by.displayName} />}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
