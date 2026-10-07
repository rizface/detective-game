import { useMemo, useState } from 'react'
import { useGame } from '../store'
import { KIND_LABEL } from '../util'

export function ViewingDots({ refKey }: { refKey: string }) {
  const snap = useGame((s) => s.snap)!
  const viewing = useGame((s) => s.viewing)
  const who = snap.members.filter((m) => m.online && m.id !== snap.you && viewing[m.id] === refKey)
  if (!who.length) return null
  return (
    <span className="viewing" title={`${who.map((m) => m.displayName).join(', ')} reading this`}>
      {who.map((m) => (
        <span key={m.id} className="dot" style={{ background: m.color }} />
      ))}
    </span>
  )
}

export default function EvidenceTab() {
  const snap = useGame((s) => s.snap)!
  const unseen = useGame((s) => s.unseenDocs)
  const showDoc = useGame((s) => s.showDoc)
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<'new' | 'old' | 'kind'>('new')

  const docs = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = snap.game.documents.filter(
      (d) => !needle || d.title.toLowerCase().includes(needle) || d.body.toLowerCase().includes(needle),
    )
    list = [...list].sort((a, b) => a.foundAt - b.foundAt)
    if (order === 'new') list.reverse()
    if (order === 'kind') list.sort((a, b) => (KIND_LABEL[a.kind] ?? a.kind).localeCompare(KIND_LABEL[b.kind] ?? b.kind))
    return list
  }, [snap.game.documents, q, order])

  return (
    <div className="listtab">
      <div className="row listtab-tools">
        <input className="input" placeholder="Search the evidence…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: 'auto' }} value={order} onChange={(e) => setOrder(e.target.value as any)} aria-label="Sort">
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
          <option value="kind">By type</option>
        </select>
      </div>
      {docs.length === 0 && <p className="muted">{q ? 'Nothing matches.' : 'No evidence yet. Go and find some.'}</p>}
      <ul className="doclist">
        {docs.map((d) => (
          <li key={d.id}>
            <button className={`docrow ${unseen.has(d.id) ? 'unseen' : ''}`} onClick={() => showDoc(d.id)}>
              <span className="docrow-kind">{KIND_LABEL[d.kind] ?? d.kind}</span>
              <span className="docrow-title">{d.title}</span>
              {d.date && <span className="docrow-date muted small">{d.date}</span>}
              <ViewingDots refKey={`doc:${d.id}`} />
              {unseen.has(d.id) && <span className="docrow-new">new</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
