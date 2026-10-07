import { useEffect, useRef, useState } from 'react'
import { memberById, useGame } from '../store'
import type { Note } from '../../types'

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
  const addNote = useGame((s) => s.addNote)
  const [draft, setDraft] = useState('')
  return (
    <div className="notes">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (draft.trim() && (await addNote(draft))) setDraft('')
        }}
      >
        <textarea
          className="textarea"
          placeholder="A theory, a timeline, a name to chase. Everyone on the team sees it."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit()
          }}
        />
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <span className="muted small">Ctrl + Enter to add</span>
          <span className="spacer" />
          <button className="btn small primary" disabled={!draft.trim()}>
            Add note
          </button>
        </div>
      </form>
      {snap.notes.length === 0 && <p className="muted small">No notes yet.</p>}
      <ul className="note-list">
        {[...snap.notes].reverse().map((n) => (
          <NoteItem key={n.id} note={n} />
        ))}
      </ul>
    </div>
  )
}

function NoteItem({ note }: { note: Note }) {
  const snap = useGame((s) => s.snap)!
  const { editNote, removeNote, addCard, toast } = useGame.getState()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.body)
  const author = memberById(snap, note.authorId)
  useEffect(() => {
    if (!editing) setText(note.body)
  }, [note.body, editing])

  return (
    <li className="note" style={{ ['--c' as any]: author?.color ?? 'var(--line)' }}>
      {editing ? (
        <>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="row" style={{ marginTop: '0.4rem' }}>
            <span className="spacer" />
            <button className="btn small ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn small primary"
              onClick={async () => {
                await editNote(note.id, text)
                setEditing(false)
              }}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="note-body">{note.body}</p>
          <div className="row note-meta">
            <span className="small" style={{ color: author?.color }}>
              {author?.displayName ?? 'A former member'}
            </span>
            <span className="spacer" />
            <button className="link-btn small" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              className="link-btn small"
              onClick={async () => {
                const it = await addCard({ refKind: 'note', refId: note.id, x: 300 + Math.random() * 600, y: 300 + Math.random() * 400 })
                if (it) toast('Note pinned to the board')
              }}
            >
              Pin
            </button>
            <button
              className="link-btn small"
              onClick={() => {
                if (confirm('Delete this note for everyone?')) removeNote(note.id)
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </li>
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
