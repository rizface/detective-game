import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, post } from '../api'
import { useAuth } from '../auth'
import type { CaseSummary, TeamListing } from '../types'
import './pages.css'

function hours(min: number) {
  if (!min) return ''
  const h = min / 60
  return h >= 1.5 ? `${Math.round(h * 2) / 2} hours` : `${min} minutes`
}

export function TopNav() {
  const { user, logout } = useAuth()
  return (
    <header className="topnav">
      <Link to="/" className="brand">
        <span className="dot" /> Night Shift
      </Link>
      <span className="spacer" />
      {user?.isAdmin && (
        <Link to="/editor" className="topnav-link">
          Case editor
        </Link>
      )}
      <span className="muted small">{user?.displayName}</span>
      <button className="btn ghost small" onClick={() => logout()}>
        Sign out
      </button>
    </header>
  )
}

export default function LibraryPage() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [teams, setTeams] = useState<TeamListing[] | null>(null)
  const [opening, setOpening] = useState<CaseSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<CaseSummary[]>('/cases').then(setCases).catch((e) => setError(e.message))
    api<TeamListing[]>('/teams').then(setTeams).catch((e) => setError(e.message))
  }, [])

  return (
    <>
      <TopNav />
      <main className="page library">
        {error && <p className="error-text">{error}</p>}

        {teams && teams.length > 0 && (
          <section className="lib-section">
            <h2>Your investigations</h2>
            <ul className="team-list">
              {teams.map((t) => (
                <li key={t.id} className={`team-row status-${t.status}`}>
                  <div>
                    <h3>{t.caseTitle}</h3>
                    <p className="muted small">
                      {t.name} — {t.members.join(', ')}
                    </p>
                  </div>
                  <div className="team-progress" aria-label={`Chapter ${t.chapter + 1} of ${t.chapters}`}>
                    {Array.from({ length: t.chapters }, (_, i) => (
                      <span key={i} className={i <= t.chapter ? 'lit' : ''} />
                    ))}
                  </div>
                  <span className="team-status">
                    {t.status === 'solved' ? 'Solved' : t.status === 'failed' ? 'Closed unsolved' : `Chapter ${t.chapter + 1}`}
                  </span>
                  <Link className={`btn ${t.status === 'active' ? 'primary' : ''}`} to={`/play/${t.id}`}>
                    {t.status === 'active' ? 'Continue' : 'Open file'}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="lib-section">
          <h2>Cases</h2>
          {cases === null && <p className="muted">Loading…</p>}
          {cases && cases.length === 0 && <p className="muted">No cases are published yet.</p>}
          <div className="case-list">
            {cases?.map((c) => (
              <article key={c.id} className="case-card">
                <div className="case-tab">{c.setting || 'Case file'}</div>
                <h3 className="case-title">{c.title}</h3>
                {c.tagline && <p className="case-tagline">{c.tagline}</p>}
                {c.blurb && <p className="case-blurb">{c.blurb}</p>}
                <dl className="case-facts">
                  {c.players && (
                    <div>
                      <dt>Players</dt>
                      <dd>{c.players}</dd>
                    </div>
                  )}
                  {c.estimatedMinutes > 0 && (
                    <div>
                      <dt>Length</dt>
                      <dd>{hours(c.estimatedMinutes)}</dd>
                    </div>
                  )}
                  {c.difficulty && (
                    <div>
                      <dt>Difficulty</dt>
                      <dd>{c.difficulty}</dd>
                    </div>
                  )}
                </dl>
                <div className="row">
                  {!c.published && <span className="muted small">Draft — only admins see this</span>}
                  <span className="spacer" />
                  <button className="btn primary" onClick={() => setOpening(c)}>
                    Take the case
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      {opening && <OpenCaseDialog c={opening} onClose={() => setOpening(null)} />}
    </>
  )
}

function OpenCaseDialog({ c, onClose }: { c: CaseSummary; onClose: () => void }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const [name, setName] = useState(`${user?.displayName ?? 'The'} Investigations`)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { id } = await post<{ id: string }>('/teams', { caseSlug: c.slug, name })
      nav(`/play/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{c.title}</h2>
        <p className="muted">
          You'll get an invite link to share with up to five friends. Everyone sees the same city, the same evidence and
          the same clock.
        </p>
        <label className="field">
          <span>Name your agency</span>
          <input className="input" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="row">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            Open the case
          </button>
        </div>
      </form>
    </div>
  )
}
