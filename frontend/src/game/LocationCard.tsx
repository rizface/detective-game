import { useGame } from './store'
import PinButton from './PinButton'
import { duration, personName } from './util'

export default function LocationCard({ id, onTalk }: { id: string; onTalk: (person: string) => void }) {
  const snap = useGame((s) => s.snap)!
  const busy = useGame((s) => s.busy)
  const travel = useGame((s) => s.travel)
  const selectLoc = useGame((s) => s.selectLoc)
  const l = snap.game.locations.find((x) => x.id === id)
  if (!l) return null
  const here = snap.game.current === id
  const district = snap.case.map.districts.find((d) => d.id === l.district)

  return (
    <div className="loc-card" role="dialog" aria-label={l.name}>
      <button className="loc-close" aria-label="Close" onClick={() => selectLoc(null)}>
        ×
      </button>
      <h3>{l.name}</h3>
      <p className="loc-address">
        {l.address}
        {district && <span className="muted">, {district.name}</span>}
      </p>
      {l.summary && <p className="loc-summary">{l.summary}</p>}

      {here ? (
        <>
          <p className="loc-here">
            <span className="dot" /> You're here
          </p>
          {l.present.length > 0 ? (
            <ul className="loc-people">
              {l.present.map((p) => (
                <li key={p}>
                  <span>{personName(snap, p)}</span>
                  <button className="btn small primary" onClick={() => onTalk(p)}>
                    Talk
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Nobody here to talk to.</p>
          )}
          <div className="row">
            <button className="btn small ghost" disabled={busy} onClick={() => travel(id)}>
              Look around again
            </button>
            <span className="spacer" />
            <PinButton refKind="loc" refId={l.id} name={l.name} />
          </div>
        </>
      ) : (
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => travel(id)}>
            Go there
          </button>
          <span className="muted small">{duration(l.travel)}</span>
          <span className="spacer" />
          {!l.visited && <span className="muted small">Not visited</span>}
          <PinButton refKind="loc" refId={l.id} name={l.name} />
        </div>
      )}
    </div>
  )
}
