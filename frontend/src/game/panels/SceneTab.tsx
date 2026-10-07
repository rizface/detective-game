import { useEffect, useRef } from 'react'
import { useGame } from '../store'
import OutcomeView from '../Outcome'
import { Prose, personName } from '../util'

export default function SceneTab({ onTalk }: { onTalk: (p: string) => void }) {
  const snap = useGame((s) => s.snap)!
  const focus = useGame((s) => s.focusEvent)
  const top = useRef<HTMLDivElement>(null)
  const actions = snap.events.filter((e) => e.kind === 'action')
  const idx = actions.findIndex((e) => e.id === focus)
  const event = idx >= 0 ? actions[idx] : null
  const here = snap.game.locations.find((l) => l.id === snap.game.current)
  const isLatest = idx === actions.length - 1

  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' })
  }, [focus])

  const go = (i: number) => useGame.setState({ focusEvent: actions[i]?.id ?? null })

  return (
    <div className="scene-tab">
      <div ref={top} />
      {!event && (
        <article className="outcome">
          <header className="outcome-head">
            <h2>{snap.case.title}</h2>
            {snap.case.setting && <p className="outcome-meta">{snap.case.setting}</p>}
          </header>
          <Prose text={snap.case.intro} />
          <p className="hint">
            Pick a place on the map and press <em>Go there</em>. Every trip, question and directory lookup costs
            time on the clock, so talk it over before you move.
          </p>
        </article>
      )}
      {event && <OutcomeView event={event} />}

      {isLatest && here && here.present.length > 0 && (
        <div className="here-strip">
          <span className="muted small">Here with you:</span>
          {here.present.map((p) => (
            <button key={p} className="btn small" onClick={() => onTalk(p)}>
              Talk to {personName(snap, p)}
            </button>
          ))}
        </div>
      )}

      {actions.length > 0 && (
        <nav className="scene-nav">
          <button className="btn small ghost" disabled={idx <= 0} onClick={() => go(idx - 1)}>
            Earlier
          </button>
          <span className="muted small">
            {idx >= 0 ? idx + 1 : 0} of {actions.length}
          </span>
          <button className="btn small ghost" disabled={idx >= actions.length - 1} onClick={() => go(idx + 1)}>
            Later
          </button>
          {!isLatest && (
            <button className="btn small" onClick={() => go(actions.length - 1)}>
              Latest
            </button>
          )}
        </nav>
      )}
    </div>
  )
}
