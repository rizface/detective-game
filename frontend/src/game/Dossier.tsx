import { useEffect } from 'react'
import type { Outcome } from '../types'
import { useGame } from './store'
import PinButton from './PinButton'
import { sendLive } from './socket'
import { Prose, initials, topicLabel } from './util'

export function useTranscript(personId: string) {
  const snap = useGame((s) => s.snap)!
  const lines: { id: string; topic: string; text: string; event: number }[] = []
  for (const e of snap.events) {
    if (e.kind !== 'action') continue
    const o = e.payload as Outcome
    if (o.action !== 'ask' || o.person !== personId) continue
    for (const sc of o.scenes) {
      if (sc.kind === 'dialogue' && !sc.repeat) lines.push({ id: sc.id + e.id, topic: o.topic!, text: sc.text, event: e.id })
    }
  }
  return lines
}

export default function Dossier({ id, onTalk }: { id: string; onTalk: (p: string) => void }) {
  const snap = useGame((s) => s.snap)!
  const showPerson = useGame((s) => s.showPerson)
  const p = snap.game.people.find((x) => x.id === id)
  const lines = useTranscript(id)
  const here = snap.game.locations.find((l) => l.id === snap.game.current)?.present.includes(id)

  useEffect(() => {
    sendLive('viewing', { ref: `person:${id}` })
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      if (e.key === 'Escape') showPerson(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      sendLive('viewing', { ref: '' })
    }
  }, [id, showPerson])

  if (!p) return null
  return (
    <div className="reader-backdrop" onClick={() => showPerson(null)}>
      <div className="dossier" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={p.name}>
        <header className="dossier-head">
          <span className={`avatar big ${p.met ? 'met' : ''}`}>{initials(p.name)}</span>
          <div>
            <h2>{p.name}</h2>
            <p className="muted">
              {p.role}
              {p.age ? `, ${p.age}` : ''}
            </p>
          </div>
          <span className="spacer" />
          <button className="btn small" onClick={() => showPerson(null)}>
            Close
          </button>
        </header>
        <div data-note-source={`person:${p.id}`}>
          <Prose text={p.description} />
        </div>
        <div className="row">
          {here && (
            <button
              className="btn primary small"
              onClick={() => {
                showPerson(null)
                onTalk(id)
              }}
            >
              Talk to {p.name.split(' ')[0]}
            </button>
          )}
          <PinButton refKind="person" refId={id} name={p.name} pin="Pin to board" unpin="Unpin from board" />
        </div>
        <h3 className="dossier-sub">What they've told you</h3>
        {lines.length === 0 && <p className="muted small">You haven't spoken yet.</p>}
        <ol className="transcript" data-note-source={`person:${p.id}`}>
          {lines.map((l) => (
            <li key={l.id} data-note-source={`event:${l.event}`}>
              <p className="transcript-topic">{topicLabel(snap, l.topic)}</p>
              <Prose text={l.text} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
