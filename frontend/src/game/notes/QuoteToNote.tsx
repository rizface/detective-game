import { useEffect, useState } from 'react'
import { useGame } from '../store'

interface Sel {
  text: string
  source: string
  x: number
  top: number
  bottom: number
}

/** Reads the current text selection if it's inside something quotable. */
function readSelection(): Sel | null {
  const s = window.getSelection()
  if (!s || s.isCollapsed || s.rangeCount === 0) return null
  const text = s.toString().replace(/\s+/g, ' ').trim()
  if (text.length < 3) return null
  const range = s.getRangeAt(0)
  const node = range.commonAncestorContainer
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  // The closest marked container wins: a single dialogue line before the whole transcript.
  const holder = el?.closest('[data-note-source]')
  if (!holder || holder.closest('input, textarea')) return null
  const r = range.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { text: text.slice(0, 2000), source: holder.getAttribute('data-note-source')!, x: r.left + r.width / 2, top: r.top, bottom: r.bottom }
}

/**
 * Select text in a scene, document, dossier or interview and a small bar
 * appears above it: save the passage as a quote, or quote it and write a
 * comment in the notepad.
 */
export default function QuoteToNote() {
  const [sel, setSel] = useState<Sel | null>(null)
  const { addNote, attachQuote, focusJot, toast } = useGame.getState()

  useEffect(() => {
    let quick: ReturnType<typeof setTimeout> | undefined
    let slow: ReturnType<typeof setTimeout> | undefined
    const check = () => setSel(readSelection())
    const soon = () => {
      clearTimeout(quick)
      quick = setTimeout(check, 10)
    }
    // Touch devices change the selection with handles, without a pointerup.
    const onChange = () => {
      clearTimeout(slow)
      slow = setTimeout(check, 300)
    }
    document.addEventListener('pointerup', soon)
    document.addEventListener('keyup', soon)
    document.addEventListener('selectionchange', onChange)
    window.addEventListener('scroll', check, true)
    window.addEventListener('resize', check)
    return () => {
      clearTimeout(quick)
      clearTimeout(slow)
      document.removeEventListener('pointerup', soon)
      document.removeEventListener('keyup', soon)
      document.removeEventListener('selectionchange', onChange)
      window.removeEventListener('scroll', check, true)
      window.removeEventListener('resize', check)
    }
  }, [])

  if (!sel) return null

  const done = () => {
    window.getSelection()?.removeAllRanges()
    setSel(null)
  }

  const width = 236
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, sel.x - width / 2))
  const above = sel.top > 56
  const top = above ? sel.top - 46 : sel.bottom + 8

  return (
    <div
      className={`quote-bar ${above ? 'above' : 'below'}`}
      style={{ left, top, width }}
      // Keep the selection alive while clicking the buttons.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label="Quote the selected text"
    >
      <button
        onClick={async () => {
          const q = sel
          done()
          const n = await addNote({ quote: q.text, source: q.source })
          if (n) toast('Quote saved to notes')
        }}
      >
        Save quote
      </button>
      <button
        onClick={() => {
          attachQuote({ text: sel.text, source: sel.source })
          done()
          focusJot()
        }}
      >
        Quote + comment
      </button>
    </div>
  )
}
