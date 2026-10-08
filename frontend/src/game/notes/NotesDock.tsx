import { useEffect, useRef, useState } from 'react'
import { useGame } from '../store'
import { NoteComposer, NoteItem } from './NoteParts'
import './notes.css'

const KEY = 'nightshift.notesDock'

interface DockPrefs {
  height: number
  collapsed: boolean
}

function loadPrefs(): DockPrefs {
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
  const fallback = { height: 260, collapsed: mobile }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...fallback, ...JSON.parse(raw) }
  } catch {
    /* storage unavailable */
  }
  return fallback
}

/**
 * The notepad docked at the bottom of the side panel. It stays open whatever
 * you're reading, so you never have to leave a scene or a document to write
 * something down. Drag the top edge to resize it.
 */
export default function NotesDock() {
  const notes = useGame((s) => s.snap!.notes)
  const jotFocus = useGame((s) => s.jotFocus)
  const quote = useGame((s) => s.quoteDraft)
  const setTab = useGame((s) => s.setTab)
  const [prefs, setPrefs] = useState(loadPrefs)
  const [flash, setFlash] = useState(false)
  const dock = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const count = useRef(notes.length)

  const save = (p: DockPrefs) => {
    setPrefs(p)
    try {
      localStorage.setItem(KEY, JSON.stringify(p))
    } catch {
      /* storage unavailable */
    }
  }

  // Asking to write (shortcut, "Add a comment") opens the dock.
  useEffect(() => {
    if ((jotFocus > 0 || quote) && prefs.collapsed) save({ ...prefs, collapsed: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jotFocus, quote])

  // Show new notes, and flash the header when one arrives while collapsed.
  useEffect(() => {
    if (notes.length > count.current) {
      listRef.current?.scrollTo({ top: 0 })
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 900)
      count.current = notes.length
      return () => clearTimeout(t)
    }
    count.current = notes.length
  }, [notes.length])

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const panel = dock.current?.parentElement
    const startY = e.clientY
    const startH = prefs.height
    const max = panel ? panel.clientHeight * 0.75 : 600
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let h = startH
    const move = (ev: PointerEvent) => {
      h = Math.max(120, Math.min(max, startH + (startY - ev.clientY)))
      setPrefs((p) => ({ ...p, height: h, collapsed: false }))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      save({ height: h, collapsed: false })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const recent = [...notes].reverse()

  return (
    <section
      ref={dock}
      className={`notes-dock ${prefs.collapsed ? 'collapsed' : ''} ${flash ? 'flash' : ''}`}
      style={prefs.collapsed ? undefined : { height: prefs.height }}
      aria-label="Notes"
    >
      {!prefs.collapsed && (
        <div className="dock-grip" onPointerDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize notes" />
      )}
      <header className="dock-head">
        <button className="dock-title" onClick={() => save({ ...prefs, collapsed: !prefs.collapsed })} aria-expanded={!prefs.collapsed}>
          <span className={`dock-caret ${prefs.collapsed ? '' : 'open'}`} aria-hidden="true">
            ▸
          </span>
          Notes
          <span className="muted small">{notes.length}</span>
        </button>
        <span className="spacer" />
        <span className="muted small dock-hint">Select any text to quote it · N to write</span>
        <button className="link-btn small" onClick={() => setTab('notes')}>
          All notes
        </button>
      </header>
      {!prefs.collapsed && (
        <ul className="dock-list note-list" ref={listRef}>
          {recent.length === 0 && (
            <li className="muted small dock-empty">
              Write something below, or select a passage in anything you're reading and press <em>Save quote</em>.
            </li>
          )}
          {recent.map((n) => (
            <NoteItem key={n.id} note={n} compact />
          ))}
        </ul>
      )}
      <NoteComposer />
    </section>
  )
}
