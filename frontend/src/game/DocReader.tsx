import { useEffect } from 'react'
import { useGame } from './store'
import { sendLive } from './socket'
import { KIND_LABEL, Prose } from './util'

export default function DocReader({ id }: { id: string }) {
  const snap = useGame((s) => s.snap)!
  const showDoc = useGame((s) => s.showDoc)
  const addCard = useGame((s) => s.addCard)
  const toast = useGame((s) => s.toast)
  const docs = [...snap.game.documents].sort((a, b) => a.foundAt - b.foundAt)
  const i = docs.findIndex((d) => d.id === id)
  const d = docs[i]

  useEffect(() => {
    sendLive('viewing', { ref: `doc:${id}` })
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select')
      if (typing) return
      if (e.key === 'Escape') showDoc(null)
      if (e.key === 'ArrowLeft' && i > 0) showDoc(docs[i - 1].id)
      if (e.key === 'ArrowRight' && i < docs.length - 1) showDoc(docs[i + 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      sendLive('viewing', { ref: '' })
    }
  })

  if (!d) return null
  return (
    <div className="reader-backdrop" onClick={() => showDoc(null)}>
      <div className="reader" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={d.title}>
        <div className="reader-bar">
          <span className="muted small">
            {KIND_LABEL[d.kind] ?? d.kind}
            {d.source ? `, ${d.source}` : ''}
          </span>
          <span className="spacer" />
          <button
            className="btn small ghost"
            onClick={async () => {
              const it = await addCard({ refKind: 'doc', refId: d.id, x: 400 + Math.random() * 600, y: 300 + Math.random() * 400 })
              if (it) toast('Pinned to the evidence board')
            }}
          >
            Pin to board
          </button>
          <button className="btn small ghost" disabled={i <= 0} onClick={() => showDoc(docs[i - 1].id)} aria-label="Previous document">
            ‹
          </button>
          <button className="btn small ghost" disabled={i >= docs.length - 1} onClick={() => showDoc(docs[i + 1].id)} aria-label="Next document">
            ›
          </button>
          <button className="btn small" onClick={() => showDoc(null)}>
            Close
          </button>
        </div>
        <article className={`paper kind-${d.kind}`} data-note-source={`doc:${d.id}`}>
          <header className="paper-head">
            <h2>{d.title}</h2>
            {d.date && <p className="paper-date">{d.date}</p>}
          </header>
          <Prose text={d.body} />
          {d.kind === 'photo' && <p className="photo-caption">Photograph — described from the print</p>}
        </article>
      </div>
    </div>
  )
}
