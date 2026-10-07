import { useMemo, useState } from 'react'
import { useGame } from '../store'
import { initials } from '../util'
import { ViewingDots } from './EvidenceTab'

export default function PeopleTab() {
  const snap = useGame((s) => s.snap)!
  const showPerson = useGame((s) => s.showPerson)
  const [q, setQ] = useState('')
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return snap.game.people
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.role.toLowerCase().includes(needle))
      .sort((a, b) => a.name.split(' ').slice(-1)[0].localeCompare(b.name.split(' ').slice(-1)[0]))
  }, [snap.game.people, q])

  return (
    <div className="listtab">
      <div className="row listtab-tools">
        <input className="input" placeholder="Find a name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {people.length === 0 && <p className="muted">No names yet.</p>}
      <ul className="peoplelist">
        {people.map((p) => (
          <li key={p.id}>
            <button className="personrow" onClick={() => showPerson(p.id)}>
              <span className={`avatar ${p.met ? 'met' : ''}`}>{initials(p.name)}</span>
              <span>
                <span className="personrow-name">{p.name}</span>
                <span className="muted small">{p.role}</span>
              </span>
              <ViewingDots refKey={`person:${p.id}`} />
              {!p.met && <span className="muted small personrow-tag">not met</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
