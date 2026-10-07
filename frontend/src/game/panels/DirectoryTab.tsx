import { useState } from 'react'
import { useGame } from '../store'

export default function DirectoryTab() {
  const snap = useGame((s) => s.snap)!
  const busy = useGame((s) => s.busy)
  const search = useGame((s) => s.search)
  const travelAddress = useGame((s) => s.travelAddress)
  const selectLoc = useGame((s) => s.selectLoc)
  const [name, setName] = useState('')
  const [addr, setAddr] = useState('')
  const clock = snap.game.clock

  return (
    <div className="directory">
      <form
        className="dir-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (name.trim() && (await search(name))) setName('')
        }}
      >
        <h3>City directory</h3>
        <p className="muted small">
          Look up a surname or a business name exactly as you read it. Each lookup takes about ten minutes.
        </p>
        <div className="row">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Surname or business" />
          <button className="btn" disabled={busy || !name.trim()}>
            Look up
          </button>
        </div>
      </form>

      <form
        className="dir-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (addr.trim() && (await travelAddress(addr))) setAddr('')
        }}
      >
        <h3>Go to an address</h3>
        <p className="muted small">
          Found an address that isn't on your map? Take a cab there. A wasted trip still costs time.
        </p>
        <div className="row">
          <input className="input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="e.g. 214 Cutter Street" />
          <button className="btn" disabled={busy || !addr.trim()}>
            Go
          </button>
        </div>
      </form>

      <h3 className="dir-heading">Your listings</h3>
      {snap.game.directory.length === 0 && <p className="muted small">Lookups you make are kept here.</p>}
      <ul className="dir-list">
        {[...snap.game.directory]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d, i) => (
            <li key={i} className="dir-entry">
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
            </li>
          ))}
      </ul>
      <p className="muted small">{clock.actions} actions taken so far.</p>
    </div>
  )
}
