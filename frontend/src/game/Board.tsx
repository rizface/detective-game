import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardItem } from '../types'
import { memberById, useGame } from './store'
import { sendDrag } from './socket'
import { KIND_LABEL, initials } from './util'

const SIZE = 4000
const CARD_W = 190

interface Cam {
  x: number
  y: number
  z: number
}

export default function Board() {
  const snap = useGame((s) => s.snap)!
  const dragging = useGame((s) => s.dragging)
  const { setBoardOpen, moveCard, removeCard, labelCard, link, labelLink, unlink, addCard, showDoc, showPerson, selectLoc } = useGame.getState()
  const surface = useRef<HTMLDivElement>(null)
  const [cam, setCam] = useState<Cam>({ x: -200, y: -150, z: 0.8 })
  const [local, setLocal] = useState<Record<string, { x: number; y: number }>>({})
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(true)
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({})
  const pan = useRef<{ sx: number; sy: number; cam: Cam } | null>(null)

  const items = snap.board.items
  const pos = (it: BoardItem) => local[it.id] ?? dragging[it.id] ?? { x: it.x, y: it.y }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (linkFrom) setLinkFrom(null)
        else setBoardOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linkFrom, setBoardOpen])

  useEffect(() => {
    const el = surface.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setCam((c) => {
        const z = Math.min(2, Math.max(0.25, c.z * Math.exp(-e.deltaY * 0.0015)))
        const mx = (e.clientX - r.left) / c.z + c.x
        const my = (e.clientY - r.top) / c.z + c.y
        return { z, x: mx - (e.clientX - r.left) / z, y: my - (e.clientY - r.top) / z }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Measure cards so strings attach to their centres.
  const measure = (id: string, el: HTMLElement | null) => {
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (!sizes[id] || sizes[id].w !== w || sizes[id].h !== h) setSizes((s) => ({ ...s, [id]: { w, h } }))
  }

  const centre = (it: BoardItem) => {
    const p = pos(it)
    const s = sizes[it.id] ?? { w: CARD_W, h: 90 }
    return { x: p.x + s.w / 2, y: p.y + s.h / 2 }
  }

  const startCardDrag = (e: React.PointerEvent, it: BoardItem) => {
    if ((e.target as HTMLElement).closest('button, textarea, input')) return
    e.stopPropagation()
    if (linkFrom) {
      if (linkFrom !== it.id) link(linkFrom, it.id)
      setLinkFrom(null)
      return
    }
    const start = pos(it)
    const sx = e.clientX
    const sy = e.clientY
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let last = start
    const move = (ev: PointerEvent) => {
      last = {
        x: Math.max(0, Math.min(SIZE - 50, start.x + (ev.clientX - sx) / cam.z)),
        y: Math.max(0, Math.min(SIZE - 50, start.y + (ev.clientY - sy) / cam.z)),
      }
      setLocal((l) => ({ ...l, [it.id]: last }))
      sendDrag(it.id, last.x, last.y)
    }
    const up = async () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (last !== start) await moveCard(it.id, last.x, last.y)
      setLocal((l) => {
        const n = { ...l }
        delete n[it.id]
        return n
      })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const onBgDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('board-plane')) return
    if (linkFrom) {
      setLinkFrom(null)
      return
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pan.current = { sx: e.clientX, sy: e.clientY, cam }
  }
  const onBgMove = (e: React.PointerEvent) => {
    const p = pan.current
    if (!p) return
    setCam({ ...p.cam, x: p.cam.x - (e.clientX - p.sx) / p.cam.z, y: p.cam.y - (e.clientY - p.sy) / p.cam.z })
  }
  const onBgUp = () => {
    pan.current = null
  }

  const viewCentre = () => {
    const r = surface.current?.getBoundingClientRect()
    const w = r ? r.width : 800
    const h = r ? r.height : 600
    return {
      x: Math.max(20, Math.min(SIZE - 220, cam.x + w / cam.z / 2 - CARD_W / 2 + (Math.random() - 0.5) * 120)),
      y: Math.max(20, Math.min(SIZE - 120, cam.y + h / cam.z / 2 - 50 + (Math.random() - 0.5) * 120)),
    }
  }

  const pinned = useMemo(() => new Set(items.map((i) => `${i.refKind}:${i.refId}`)), [items])

  return (
    <div className="board" role="dialog" aria-label="Evidence board">
      <header className="board-bar">
        <h2>Evidence board</h2>
        <span className="muted small">
          {linkFrom ? 'Now click the card to connect it to. Esc cancels.' : 'Drag cards around. Use “String” to connect two cards.'}
        </span>
        <span className="spacer" />
        <button className="btn small ghost" onClick={() => setDrawer(!drawer)}>
          {drawer ? 'Hide drawer' : 'Add to board'}
        </button>
        <button className="btn small" onClick={() => setBoardOpen(false)}>
          Close
        </button>
      </header>
      <div className="board-main">
        {drawer && (
          <BoardDrawer
            pinned={pinned}
            onAdd={(card) => addCard({ ...card, ...viewCentre() })}
          />
        )}
        <div
          ref={surface}
          className={`board-surface ${linkFrom ? 'linking' : ''}`}
          onPointerDown={onBgDown}
          onPointerMove={onBgMove}
          onPointerUp={onBgUp}
          onPointerCancel={onBgUp}
        >
          <div
            className="board-plane"
            style={{ width: SIZE, height: SIZE, transform: `scale(${cam.z}) translate(${-cam.x}px, ${-cam.y}px)` }}
          >
            <svg className="board-strings" width={SIZE} height={SIZE}>
              {snap.board.links.map((l) => {
                const a = items.find((i) => i.id === l.from)
                const b = items.find((i) => i.id === l.to)
                if (!a || !b) return null
                const p = centre(a)
                const q = centre(b)
                const mx = (p.x + q.x) / 2
                const my = (p.y + q.y) / 2 + Math.min(60, Math.hypot(q.x - p.x, q.y - p.y) * 0.08)
                return (
                  <g key={l.id} className="string">
                    <path d={`M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`} />
                    <foreignObject x={mx - 80} y={my - 16} width={160} height={34}>
                      <div className="string-label">
                        <button
                          onClick={() => {
                            const label = prompt('Label this connection', l.label)
                            if (label !== null) labelLink(l.id, label)
                          }}
                        >
                          {l.label || '·'}
                        </button>
                        <button className="string-x" aria-label="Cut string" onClick={() => unlink(l.id)}>
                          ×
                        </button>
                      </div>
                    </foreignObject>
                  </g>
                )
              })}
            </svg>
            {items.map((it) => (
              <Card
                key={it.id}
                it={it}
                p={pos(it)}
                linkSource={linkFrom === it.id}
                moving={!!dragging[it.id] && !local[it.id]}
                measureRef={(el) => measure(it.id, el)}
                onPointerDown={(e) => startCardDrag(e, it)}
                onString={() => setLinkFrom(it.id)}
                onRemove={() => removeCard(it.id)}
                onLabel={(label) => labelCard(it.id, label)}
                onOpen={() => {
                  if (it.refKind === 'doc') showDoc(it.refId)
                  if (it.refKind === 'person') showPerson(it.refId)
                  if (it.refKind === 'loc') {
                    selectLoc(it.refId)
                    setBoardOpen(false)
                  }
                }}
              />
            ))}
          </div>
          {items.length === 0 && (
            <p className="board-empty">
              Pin evidence, people, places and notes here, then string them together. Everyone on the team sees the
              same board as you move things.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Card(props: {
  it: BoardItem
  p: { x: number; y: number }
  linkSource: boolean
  moving: boolean
  measureRef: (el: HTMLElement | null) => void
  onPointerDown: (e: React.PointerEvent) => void
  onString: () => void
  onRemove: () => void
  onLabel: (label: string) => void
  onOpen: () => void
}) {
  const snap = useGame((s) => s.snap)!
  const { it, p } = props
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(it.label)
  useEffect(() => setLabel(it.label), [it.label])
  const by = memberById(snap, it.createdBy)

  let kind = ''
  let title = ''
  if (it.refKind === 'doc') {
    const d = snap.game.documents.find((x) => x.id === it.refId)
    kind = KIND_LABEL[d?.kind ?? ''] ?? 'Evidence'
    title = d?.title ?? 'Missing evidence'
  } else if (it.refKind === 'person') {
    const pp = snap.game.people.find((x) => x.id === it.refId)
    kind = pp?.role ?? 'Person'
    title = pp?.name ?? 'Unknown'
  } else if (it.refKind === 'loc') {
    const l = snap.game.locations.find((x) => x.id === it.refId)
    kind = l?.address ?? 'Place'
    title = l?.name ?? 'Unknown place'
  } else if (it.refKind === 'note') {
    const n = snap.notes.find((x) => x.id === it.refId)
    kind = n?.quote && !n.body ? 'Quote' : 'Note'
    title = n ? n.body || `“${n.quote}”` : ''
  }

  return (
    <div
      ref={props.measureRef}
      className={`card card-${it.refKind} ${props.linkSource ? 'link-source' : ''} ${props.moving ? 'moving' : ''}`}
      style={{ left: p.x, top: p.y, width: CARD_W, ['--c' as any]: by?.color ?? 'var(--line)' }}
      onPointerDown={props.onPointerDown}
    >
      <span className="card-pin" />
      {it.refKind === 'person' && <span className="avatar">{initials(title)}</span>}
      {it.refKind !== 'text' && <p className="card-kind">{kind}</p>}
      {it.refKind !== 'text' && (
        <p className={`card-title ${it.refKind === 'note' ? 'card-title-note' : ''}`}>
          {it.refKind === 'note' ? title.slice(0, 220) : title}
        </p>
      )}
      {editing ? (
        <textarea
          className="card-edit"
          value={label}
          autoFocus
          maxLength={300}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (label !== it.label) props.onLabel(label)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) (e.target as HTMLTextAreaElement).blur()
          }}
        />
      ) : (
        (it.label || it.refKind === 'text') && <p className="card-label" onDoubleClick={() => setEditing(true)}>{it.label}</p>
      )}
      <div className="card-actions">
        {it.refKind !== 'text' && it.refKind !== 'note' && <button onClick={props.onOpen}>Open</button>}
        <button onClick={() => setEditing(true)}>{it.refKind === 'text' ? 'Edit' : 'Annotate'}</button>
        <button onClick={props.onString}>String</button>
        <button onClick={props.onRemove} aria-label="Remove card">
          Remove
        </button>
      </div>
    </div>
  )
}

function BoardDrawer({ pinned, onAdd }: { pinned: Set<string>; onAdd: (card: Partial<BoardItem>) => void }) {
  const snap = useGame((s) => s.snap)!
  const [tab, setTab] = useState<'doc' | 'person' | 'loc' | 'note'>('doc')
  const [text, setText] = useState('')
  const entries =
    tab === 'doc'
      ? snap.game.documents.map((d) => ({ id: d.id, label: d.title }))
      : tab === 'person'
        ? snap.game.people.map((p) => ({ id: p.id, label: p.name }))
        : tab === 'loc'
          ? snap.game.locations.map((l) => ({ id: l.id, label: l.name }))
          : snap.notes.map((n) => ({ id: n.id, label: n.body.slice(0, 80) }))

  return (
    <aside className="board-drawer">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          onAdd({ refKind: 'text', label: text })
          setText('')
        }}
      >
        <textarea className="textarea" placeholder="Write a card: a theory, a question, a time…" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
        <button className="btn small" disabled={!text.trim()} style={{ marginTop: '0.4rem' }}>
          Add card
        </button>
      </form>
      <div className="segmented">
        <button className={tab === 'doc' ? 'on' : ''} onClick={() => setTab('doc')}>Evidence</button>
        <button className={tab === 'person' ? 'on' : ''} onClick={() => setTab('person')}>People</button>
        <button className={tab === 'loc' ? 'on' : ''} onClick={() => setTab('loc')}>Places</button>
        <button className={tab === 'note' ? 'on' : ''} onClick={() => setTab('note')}>Notes</button>
      </div>
      <ul className="drawer-list">
        {entries.map((e) => {
          const on = pinned.has(`${tab}:${e.id}`)
          return (
            <li key={e.id}>
              <span>{e.label}</span>
              <button className="btn small ghost" disabled={on} onClick={() => onAdd({ refKind: tab, refId: e.id })}>
                {on ? 'Pinned' : 'Pin'}
              </button>
            </li>
          )
        })}
        {entries.length === 0 && <li className="muted small">Nothing here yet.</li>}
      </ul>
    </aside>
  )
}
