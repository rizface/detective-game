import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import StreetGlow from '../components/StreetGlow'
import './pages.css'

export default function AuthPage() {
  const { user, ready, login, register } = useAuth()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (ready && user) return <Navigate to={params.get('next') || '/'} replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'signin') await login(email, password)
      else await register(email, name, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <StreetGlow className="auth-art" seed={11} />
      <div className="auth-inner">
        <div className="auth-title">
          <h1>Night Shift</h1>
          <p>
            Detective cases you solve with friends. The board is a whole city: read the files, knock on doors,
            argue over the evidence, and file one report together.
          </p>
        </div>
        <form className="auth-card" onSubmit={submit}>
          <h2>{mode === 'signin' ? 'Sign in' : 'Open an account'}</h2>
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode === 'register' && (
            <label className="field">
              <span>Detective name — what your teammates see</span>
              <input className="input" required minLength={2} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <p className="muted small" style={{ marginTop: '1rem' }}>
            {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
            <button type="button" className="link-btn" onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')}>
              {mode === 'signin' ? 'Open an account' : 'Sign in'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
