import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, post } from '../api'
import { TopNav } from './LibraryPage'
import './pages.css'

interface Preview {
  teamId: string
  teamName: string
  caseTitle: string
  caseSlug: string
  status: string
  members: string[]
  isMember: boolean
}

export default function JoinPage() {
  const { code } = useParams()
  const nav = useNavigate()
  const [p, setP] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Preview>(`/join/${code}`).then(setP).catch((e) => setError(e.message))
  }, [code])

  if (p?.isMember) return <Navigate to={`/play/${p.teamId}`} replace />

  const join = async () => {
    setBusy(true)
    try {
      const { id } = await post<{ id: string }>(`/join/${code}`)
      nav(`/play/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <>
      <TopNav />
      <main className="page join">
        {error && <p className="error-text">{error}</p>}
        {p && (
          <div className="join-card">
            <p className="muted">You've been asked to join</p>
            <h1>{p.teamName}</h1>
            <p>
              on <strong>{p.caseTitle}</strong>, with {p.members.join(', ')}.
            </p>
            <button className="btn primary" onClick={join} disabled={busy}>
              Join the agency
            </button>
          </div>
        )}
      </main>
    </>
  )
}
