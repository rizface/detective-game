import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useGame, type Tab } from './store'
import { useTeamSocket } from './socket'
import CityMap from './CityMap'
import LocationCard from './LocationCard'
import TopBar from './TopBar'
import SceneTab from './panels/SceneTab'
import CaseFileTab from './panels/CaseFileTab'
import EvidenceTab from './panels/EvidenceTab'
import PeopleTab from './panels/PeopleTab'
import DirectoryTab from './panels/DirectoryTab'
import NotesTab from './panels/NotesTab'
import LogTab from './panels/LogTab'
import ReportTab from './panels/ReportTab'
import DocReader from './DocReader'
import Dossier from './Dossier'
import Interview from './Interview'
import Board from './Board'
import { useGameSounds } from '../sound/useGameSounds'
import './game.css'

const TABS: { id: Tab; label: string }[] = [
  { id: 'scene', label: 'Scene' },
  { id: 'file', label: 'Case file' },
  { id: 'docs', label: 'Evidence' },
  { id: 'people', label: 'People' },
  { id: 'directory', label: 'Directory' },
  { id: 'notes', label: 'Notes' },
  { id: 'log', label: 'Log' },
  { id: 'report', label: 'Report' },
]

export default function GamePage() {
  const { teamId } = useParams()
  const g = useGame()
  const [talkTo, setTalkTo] = useState<string | null>(null)
  useTeamSocket(teamId)
  useGameSounds()

  useEffect(() => {
    if (teamId) g.load(teamId)
    return () => g.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  if (g.error) {
    return (
      <div className="page">
        <p className="error-text">{g.error}</p>
        <Link to="/">Back to the library</Link>
      </div>
    )
  }
  const snap = g.snap
  if (!snap) return <div className="game-loading">Opening the case file…</div>

  const badge = (t: Tab) => {
    if (t === 'docs' && g.unseenDocs.size > 0) return g.unseenDocs.size
    if (t === 'notes' && g.unreadChat > 0) return g.unreadChat
    if (t === 'report' && snap.case.accusation.open && snap.team.status === 'active') return '!'
    return null
  }

  return (
    <div className="game">
      <TopBar />
      <div className="game-body">
        <section className="game-map">
          <CityMap
            map={snap.case.map}
            locations={snap.game.locations}
            current={snap.game.current}
            selected={g.selectedLoc}
            onSelect={g.selectLoc}
          />
          {g.selectedLoc && <LocationCard id={g.selectedLoc} onTalk={setTalkTo} />}
        </section>
        <aside className="game-panel">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={g.tab === t.id}
                className={`tab ${g.tab === t.id ? 'on' : ''} ${t.id === 'report' ? 'tab-report' : ''}`}
                onClick={() => {
                  g.setTab(t.id)
                  if (t.id === 'notes') g.markChatRead()
                }}
              >
                {t.label}
                {badge(t.id) !== null && <span className="tab-badge">{badge(t.id)}</span>}
              </button>
            ))}
          </nav>
          <div className="panel-body">
            {g.tab === 'scene' && <SceneTab onTalk={setTalkTo} />}
            {g.tab === 'file' && <CaseFileTab />}
            {g.tab === 'docs' && <EvidenceTab />}
            {g.tab === 'people' && <PeopleTab />}
            {g.tab === 'directory' && <DirectoryTab />}
            {g.tab === 'notes' && <NotesTab />}
            {g.tab === 'log' && <LogTab />}
            {g.tab === 'report' && <ReportTab />}
          </div>
        </aside>
      </div>
      {g.openDoc && <DocReader id={g.openDoc} />}
      {g.openPerson && <Dossier id={g.openPerson} onTalk={setTalkTo} />}
      {talkTo && <Interview person={talkTo} onClose={() => setTalkTo(null)} />}
      {g.boardOpen && <Board />}
      <div className="toasts" aria-live="polite">
        {g.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => g.dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
