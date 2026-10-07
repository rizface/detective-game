import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import AuthPage from './pages/AuthPage'
import LibraryPage from './pages/LibraryPage'
import JoinPage from './pages/JoinPage'
import GamePage from './game/GamePage'
import AdminCases from './admin/AdminCases'
import CaseEditor from './admin/CaseEditor'

function RequireUser({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return null
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname)}`} replace />
  return <>{children}</>
}

export default function App() {
  const refresh = useAuth((s) => s.refresh)
  useEffect(() => {
    refresh()
  }, [refresh])
  return (
    <Routes>
      <Route path="/signin" element={<AuthPage />} />
      <Route path="/" element={<RequireUser><LibraryPage /></RequireUser>} />
      <Route path="/join/:code" element={<RequireUser><JoinPage /></RequireUser>} />
      <Route path="/play/:teamId" element={<RequireUser><GamePage /></RequireUser>} />
      <Route path="/editor" element={<RequireUser><AdminCases /></RequireUser>} />
      <Route path="/editor/:caseId" element={<RequireUser><CaseEditor /></RequireUser>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
