import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGame } from './store'
import { duration, gameTime, initials } from './util'
import SoundControl from '../sound/SoundControl'

export default function TopBar() {
  const snap = useGame((s) => s.snap)!
  const socketState = useGame((s) => s.socketState)
  const setBoardOpen = useGame((s) => s.setBoardOpen)
  const toast = useGame((s) => s.toast)
  const [inviteOpen, setInviteOpen] = useState(false)
  const t = gameTime(snap.game.clock.now)
  const chapter = snap.game.chapters[snap.game.chapter]
  const inviteUrl = `${location.origin}/join/${snap.team.inviteCode}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      toast('Invite link copied')
    } catch {
      setInviteOpen(true)
    }
  }

  return (
    <header className="topbar">
      <Link to="/" className="topbar-home" aria-label="Back to the library">
        <span className="dot" />
      </Link>
      <div className="topbar-case">
        <span className="topbar-title">{snap.case.title}</span>
        {chapter && (
          <span className="topbar-chapter">
            Chapter {snap.game.chapter + 1} of {snap.case.totalChapters}: {chapter.title}
          </span>
        )}
      </div>
      <div className="clock" title={`Time on the case: ${duration(snap.game.clock.active)}`}>
        <span className="clock-time">{t.time}</span>
        <span className="clock-date">
          <b>Day {snap.game.clock.day}</b>
          {t.weekday}, {t.date}
        </span>
      </div>
      <span className="spacer" />
      <ul className="members" aria-label="Detectives">
        {snap.members.map((m) => (
          <li key={m.id} title={`${m.displayName}${m.online ? ' — online' : ''}`} className={m.online ? 'online' : ''} style={{ ['--c' as any]: m.color }}>
            {initials(m.displayName)}
          </li>
        ))}
      </ul>
      {socketState !== 'open' && <span className="conn muted small">Reconnecting…</span>}
      <SoundControl />
      <button className="btn small ghost" onClick={copy} onContextMenu={(e) => { e.preventDefault(); setInviteOpen(true) }}>
        Invite
      </button>
      <button className="btn small" onClick={() => setBoardOpen(true)}>
        Evidence board
      </button>
      {inviteOpen && (
        <div className="modal-backdrop" onClick={() => setInviteOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Invite detectives</h2>
            <p className="muted">Anyone with this link can join the agency, up to six detectives.</p>
            <input className="input" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
          </div>
        </div>
      )}
    </header>
  )
}
