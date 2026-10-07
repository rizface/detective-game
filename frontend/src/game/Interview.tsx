import { useEffect, useMemo, useRef, useState } from 'react'
import type { Outcome } from '../types'
import { useGame } from './store'
import { useTranscript } from './Dossier'
import { Prose, initials, topicLabel } from './util'

type Group = 'person' | 'loc' | 'doc'
const GROUPS: { id: Group; label: string }[] = [
  { id: 'person', label: 'People' },
  { id: 'loc', label: 'Places' },
  { id: 'doc', label: 'Evidence' },
]

export default function Interview({ person, onClose }: { person: string; onClose: () => void }) {
  const snap = useGame((s) => s.snap)!
  const busy = useGame((s) => s.busy)
  const ask = useGame((s) => s.ask)
  const [group, setGroup] = useState<Group>('person')
  const [q, setQ] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const p = snap.game.people.find((x) => x.id === person)
  const here = snap.game.locations.find((l) => l.id === snap.game.current)?.present.includes(person)
  const lines = useTranscript(person)
  const met = p?.met

  // Opening a conversation with a stranger starts with introductions.
  const introduced = useRef(false)
  useEffect(() => {
    if (!met && here && !introduced.current) {
      introduced.current = true
      ask(person, 'intro')
    }
  }, [met, here, person, ask])

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [lines.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const asked = useMemo(() => {
    const set = new Set<string>()
    for (const e of snap.events) {
      const o = e.payload as Outcome
      if (e.kind === 'action' && o.action === 'ask' && o.person === person) set.add(o.topic!)
    }
    return set
  }, [snap.events, person])

  const topics = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return snap.game.topics
      .filter((t) => t.startsWith(group + ':') && t !== `person:${person}`)
      .map((t) => ({ t, label: topicLabel(snap, t) }))
      .filter((x) => !needle || x.label.toLowerCase().includes(needle))
      .sort((a, b) => Number(asked.has(a.t)) - Number(asked.has(b.t)) || a.label.localeCompare(b.label))
  }, [snap, group, q, asked, person])

  if (!p) return null
  return (
    <div className="reader-backdrop" onClick={onClose}>
      <div className="interview" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Talking to ${p.name}`}>
        <header className="dossier-head">
          <span className="avatar big met">{initials(p.name)}</span>
          <div>
            <h2>{p.name}</h2>
            <p className="muted">{p.role}</p>
          </div>
          <span className="spacer" />
          <button className="btn small" onClick={onClose}>
            Leave
          </button>
        </header>

        <div className="interview-body">
          <ol className="transcript">
            {lines.map((l) => (
              <li key={l.id}>
                <p className="transcript-topic">{l.topic === 'intro' ? 'First words' : `You ask about ${topicLabel(snap, l.topic)}`}</p>
                <Prose text={l.text} />
              </li>
            ))}
            {busy && <li className="muted small">…</li>}
            <div ref={end} />
          </ol>

          <div className="ask">
            {!here ? (
              <p className="muted">{p.name} isn't here. You'll have to find them first.</p>
            ) : (
              <>
                <p className="ask-title">Ask about</p>
                <div className="segmented">
                  {GROUPS.map((gr) => (
                    <button key={gr.id} className={group === gr.id ? 'on' : ''} onClick={() => setGroup(gr.id)}>
                      {gr.label}
                    </button>
                  ))}
                </div>
                <input className="input" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
                <ul className="topic-list">
                  <li>
                    <button className="topic" disabled={busy} onClick={() => ask(person, `person:${person}`)}>
                      Themselves
                      {asked.has(`person:${person}`) && <span className="topic-asked">asked</span>}
                    </button>
                  </li>
                  {topics.map((x) => (
                    <li key={x.t}>
                      <button className="topic" disabled={busy} onClick={() => ask(person, x.t)}>
                        {x.label}
                        {asked.has(x.t) && <span className="topic-asked">asked</span>}
                      </button>
                    </li>
                  ))}
                  {topics.length === 0 && group === 'doc' && !q && (
                    <li className="muted small">Some evidence can be shown to people. None of yours can, yet.</li>
                  )}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
