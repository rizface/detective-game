import type { EventRow, Outcome, Snapshot } from '../types'
import { memberById, useGame } from './store'
import { Prose, clockAt, duration, locName, personName, topicLabel } from './util'

function headline(snap: Snapshot, o: Outcome) {
  switch (o.action) {
    case 'travel':
      return locName(snap, o.location)
    case 'address':
      return o.location ? locName(snap, o.location) : o.query ?? 'An address'
    case 'ask':
      return o.topic === 'intro' ? personName(snap, o.person) : `${personName(snap, o.person)}, about ${topicLabel(snap, o.topic!)}`
    case 'search':
      return `City directory: “${o.query}”`
  }
}

export function eventSummary(snap: Snapshot, e: EventRow): string {
  if (e.kind === 'opened') return 'The case was opened'
  if (e.kind === 'joined') return `${memberById(snap, e.by)?.displayName ?? 'Someone'} joined the agency`
  if (e.kind === 'accusation') {
    const p = e.payload
    return p.passed ? `Report ${p.attempt} filed and accepted` : `Report ${p.attempt} filed: ${p.requiredCorrect} of ${p.requiredTotal} key answers right`
  }
  const o = e.payload as Outcome
  switch (o.action) {
    case 'travel':
    case 'address':
      return o.location ? `Went to ${locName(snap, o.location)}` : `Tried ${o.query}`
    case 'ask':
      return o.topic === 'intro' ? `Talked to ${personName(snap, o.person)}` : `Asked ${personName(snap, o.person)} about ${topicLabel(snap, o.topic!)}`
    case 'search':
      return `Looked up “${o.query}”`
  }
}

/** Renders one action: the scenes it played and what it revealed. */
export default function OutcomeView({ event }: { event: EventRow }) {
  const snap = useGame((s) => s.snap)!
  const showDoc = useGame((s) => s.showDoc)
  const showPerson = useGame((s) => s.showPerson)
  const selectLoc = useGame((s) => s.selectLoc)
  const o = event.payload as Outcome
  const by = memberById(snap, event.by)
  const when = clockAt(snap, event.clock)
  const r = o.revealed ?? {}

  return (
    <article className="outcome">
      <header className="outcome-head">
        <h2>{headline(snap, o)}</h2>
        <p className="outcome-meta">
          {by && <span style={{ color: by.color }}>{by.displayName}</span>}
          <span>
            {when.day}, {when.time}
          </span>
          {o.minutes > 0 && <span>took {duration(o.minutes)}</span>}
          {o.overnight && <span>after a night's sleep</span>}
        </p>
      </header>

      {(o.scenes ?? []).map((sc, i) => {
        if (sc.kind === 'chapter') {
          return (
            <section key={i} className="scene scene-chapter">
              <p className="chapter-mark">New chapter</p>
              <h2>{sc.title}</h2>
              <Prose text={sc.text} />
            </section>
          )
        }
        if (sc.kind === 'dialogue') {
          return (
            <section key={i} className={`scene scene-dialogue ${sc.repeat ? 'repeat' : ''}`}>
              {sc.repeat && <p className="muted small">You've asked this before. You remember the answer:</p>}
              <h4 className="speaker">{personName(snap, sc.speaker)}</h4>
              <Prose text={sc.text} />
            </section>
          )
        }
        return (
          <section key={i} className={`scene scene-${sc.kind}`}>
            {sc.title && <h3>{sc.title}</h3>}
            <Prose text={sc.text} />
          </section>
        )
      })}

      {o.directory && o.directory.length > 0 && (
        <section className="dir-results">
          {o.directory.map((d, i) => (
            <div key={i} className="dir-entry">
              <strong>{d.name}</strong>
              {d.note && <span className="muted"> {d.note}</span>}
              <div className="dir-line">
                {d.address}
                {d.phone && <span className="muted">, tel. {d.phone}</span>}
              </div>
              {d.location && (
                <button className="link-btn small" onClick={() => selectLoc(d.location!)}>
                  Show on map
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {(r.documents?.length || r.locations?.length || r.people?.length) ? (
        <footer className="revealed">
          {r.documents?.map((id) => (
            <button key={id} className="chip chip-doc" onClick={() => showDoc(id)}>
              New evidence: {snap.game.documents.find((d) => d.id === id)?.title ?? id}
            </button>
          ))}
          {r.locations?.map((id) => (
            <button key={id} className="chip chip-loc" onClick={() => selectLoc(id)}>
              On the map: {locName(snap, id)}
            </button>
          ))}
          {r.people?.map((id) => (
            <button key={id} className="chip chip-person" onClick={() => showPerson(id)}>
              New name: {personName(snap, id)}
            </button>
          ))}
        </footer>
      ) : null}
    </article>
  )
}
