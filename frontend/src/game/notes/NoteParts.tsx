import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Note, Snapshot } from '../../types'
import { memberById, useGame } from '../store'
import { eventSummary } from '../Outcome'
import { clockAt, locName } from '../util'

/** A readable name for where a quote came from. */
export function sourceLabel(snap: Snapshot, source: string): string {
  const [kind, id] = source.split(':')
  switch (kind) {
    case 'doc':
      return snap.game.documents.find((d) => d.id === id)?.title ?? 'A document'
    case 'person':
      return snap.game.people.find((p) => p.id === id)?.name ?? 'Someone'
    case 'loc':
      return locName(snap, id)
    case 'chapter': {
      const i = snap.game.chapters.findIndex((c) => c.id === id)
      return i >= 0 ? `Chapter ${i + 1}: ${snap.game.chapters[i].title}` : 'A chapter'
    }
    case 'case':
      return 'How it began'
    case 'event': {
      const e = snap.events.find((x) => x.id === Number(id))
      return e ? eventSummary(snap, e) : 'An earlier scene'
    }
  }
  return ''
}

/** "Mon Oct 14, 09:10 · The Cannery Steps" */
export function noteContext(snap: Snapshot, n: Note): string {
  const t = clockAt(snap, n.clock)
  const where = n.loc ? ` · ${locName(snap, n.loc)}` : ''
  return `${t.day}, ${t.time}${where}`
}

export function NoteItem({ note, compact = false }: { note: Note; compact?: boolean }) {
  const snap = useGame((s) => s.snap)!
  const { editNote, removeNote, addCard, toast, openSource } = useGame.getState()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.body)
  const author = memberById(snap, note.authorId)
  useEffect(() => {
    if (!editing) setText(note.body)
  }, [note.body, editing])

  return (
    <li className={`note ${compact ? 'compact' : ''}`} style={{ ['--c' as any]: author?.color ?? 'var(--line)' }}>
      {note.quote && (
        <blockquote className="note-quote">
          <p>{note.quote}</p>
          {note.source && (
            <button className="note-source" onClick={() => openSource(note.source)} title="Open where this came from">
              {sourceLabel(snap, note.source)}
            </button>
          )}
        </blockquote>
      )}
      {editing ? (
        <>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Your comment" />
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
        note.body && <p className="note-body">{note.body}</p>
      )}
      {!editing && (
        <div className="row note-meta">
          <span className="small note-who" style={{ color: author?.color }}>
            {author?.displayName ?? 'A former member'}
          </span>
          <span className="small muted note-when">{noteContext(snap, note)}</span>
          <span className="spacer" />
          <button className="link-btn small" onClick={() => setEditing(true)}>
            {note.body ? 'Edit' : 'Comment'}
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
      )}
    </li>
  )
}

/**
 * Writes a note. Enter saves, Shift+Enter makes a new line. A quote attached
 * from a selection shows above the box until the note is saved or the quote
 * is removed.
 */
export function NoteComposer({ placeholder = 'Jot a note…', autoGrowMax = 160 }: { placeholder?: string; autoGrowMax?: number }) {
  const snap = useGame((s) => s.snap)!
  const quote = useGame((s) => s.quoteDraft)
  const jotFocus = useGame((s) => s.jotFocus)
  const { addNote, attachQuote } = useGame.getState()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (jotFocus > 0) box.current?.focus()
  }, [jotFocus])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, autoGrowMax)}px`
  }, [text, autoGrowMax])

  const save = async () => {
    if (busy || (!text.trim() && !quote)) return
    setBusy(true)
    const n = await addNote({ body: text, quote: quote?.text, source: quote?.source })
    setBusy(false)
    if (n) {
      setText('')
      attachQuote(null)
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      {quote && (
        <div className="composer-quote">
          <p>“{quote.text.length > 240 ? quote.text.slice(0, 240) + '…' : quote.text}”</p>
          <span className="muted small">{sourceLabel(snap, quote.source)}</span>
          <button type="button" className="composer-quote-x" aria-label="Remove quote" onClick={() => attachQuote(null)}>
            ×
          </button>
        </div>
      )}
      <div className="composer-row">
        <textarea
          ref={box}
          rows={1}
          className="textarea composer-box"
          placeholder={quote ? 'Add your comment (optional)…' : placeholder}
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              save()
            }
            if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          }}
        />
        <button className="btn small primary" disabled={busy || (!text.trim() && !quote)}>
          Save
        </button>
      </div>
    </form>
  )
}
