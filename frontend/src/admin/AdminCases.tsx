import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, post } from '../api'
import { useAuth } from '../auth'
import { TopNav } from '../pages/LibraryPage'
import './admin.css'

interface AdminCase {
  id: string
  slug: string
  title: string
  sealed: boolean
  published: boolean
  version: number
  teams: number
  updatedAt: string
}

export default function AdminCases() {
  const user = useAuth((s) => s.user)
  const nav = useNavigate()
  const [cases, setCases] = useState<AdminCase[]>([])
  const [error, setError] = useState('')
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const load = () => api<AdminCase[]>('/admin/cases').then(setCases).catch((e) => setError(e.message))
  useEffect(() => {
    load()
  }, [])

  if (user && !user.isAdmin) return <Navigate to="/" replace />

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const { id } = await post<{ id: string }>('/admin/cases', { slug, title })
      nav(`/editor/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const importFile = async (f: File) => {
    setError('')
    try {
      const { id } = await api<{ id: string }>('/admin/cases/import', { method: 'POST', body: await f.text() })
      nav(`/editor/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <TopNav />
      <main className="page">
        <h1>Case editor</h1>
        <p className="muted">
          Write your own cases: a city map, places, people, documents and the final report. Cases that ship with the
          game are sealed so the editor can't spoil them.
        </p>
        {error && <p className="error-text">{error}</p>}
        <table className="admin-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Status</th>
              <th>Version</th>
              <th>Teams</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.sealed ? 'Sealed case' : c.title}</strong>
                  <div className="muted small">{c.slug}</div>
                </td>
                <td>{c.sealed ? 'Bundled, sealed' : c.published ? 'Published' : 'Draft'}</td>
                <td>{c.version}</td>
                <td>{c.teams}</td>
                <td>
                  <Link className="btn small" to={`/editor/${c.id}`}>
                    {c.sealed ? 'Details' : 'Edit'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="admin-new">
          <form onSubmit={create}>
            <h3>New case</h3>
            <div className="row wrap">
              <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ maxWidth: '18rem' }} />
              <input
                className="input"
                placeholder="slug-like-this"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                required
                style={{ maxWidth: '14rem' }}
              />
              <button className="btn primary">Create</button>
            </div>
          </form>
          <div>
            <h3>Import</h3>
            <p className="muted small">A case as YAML, JSON or a sealed .dgcase bundle.</p>
            <input ref={file} type="file" accept=".yaml,.yml,.json,.dgcase" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <button className="btn" onClick={() => file.current?.click()}>
              Choose a file
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
