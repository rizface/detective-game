import { useEffect, useRef, useState } from 'react'
import { memberById, useGame } from '../store'
import { NoteComposer, NoteItem } from '../notes/NoteParts'

export default function NotesTab() {
  const [mode, setMode] = useState<'notes' | 'chat'>('notes')
  const unread = useGame((s) => s.unreadChat)
  return (
    <div className="notes-tab">
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={mode === 'notes'} className={mode === 'notes' ? 'on' : ''} onClick={() => setMode('notes')}>
          Shared notes
        </button>
        <button
          role="tab"
          aria-selected={mode === 'chat'}
          className={mode === 'chat' ? 'on' : ''}
          onClick={() => {
            setMode('chat')
            useGame.getState().markChatRead()
          }}
        >
          Chat {unread > 0 && <span className="tab-badge">{unread}</span>}
        </button>
      </div>
      {mode === 'notes' ? <Notes /> : <Chat />}
    </div>
  )
}

function Notes() {
  const snap = useGame((s) => s.snap)!
  return (
    <div className="notes">
      <NoteComposer placeholder="A theory, a timeline, a name to chase. Everyone on the team sees it." autoGrowMax={320} />
      <p className="muted small">Enter saves, Shift+Enter for a new line. Select text anywhere in the case to quote it.</p>
      {snap.notes.length === 0 && <p className="muted small">No notes yet.</p>}
      <ul className="note-list">
        {[...snap.notes].reverse().map((n) => (
          <NoteItem key={n.id} note={n} />
        ))}
      </ul>
    </div>
  )
}

function Chat() {
  const snap = useGame((s) => s.snap)!
  const say = useGame((s) => s.say)
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [snap.chat.length])

  return (
    <div className="chat">
      <ul className="chat-list">
        {snap.chat.length === 0 && <li className="muted small">Talk it over here if you're not on a call together.</li>}
        {snap.chat.map((m, i) => {
          const a = memberById(snap, m.userId)
          const prev = snap.chat[i - 1]
          const same = prev && prev.userId === m.userId
          return (
            <li key={m.id} className={`chat-msg ${m.userId === snap.you ? 'mine' : ''}`}>
              {!same && (
                <span className="chat-author" style={{ color: a?.color }}>
                  {a?.displayName ?? 'A former member'}
                </span>
              )}
              <span className="chat-body">{m.body}</span>
            </li>
          )
        })}
        <div ref={end} />
      </ul>
      <form
        className="row chat-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!text.trim()) return
          const t = text
          setText('')
          await say(t)
        }}
      >
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={1000} />
        <button className="btn" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
