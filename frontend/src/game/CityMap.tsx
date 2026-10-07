import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LocationView, MapData, Point } from '../types'

interface Props {
  map: MapData
  locations: LocationView[]
  current: string
  selected: string | null
  onSelect: (id: string | null) => void
}

interface View {
  x: number
  y: number
  w: number // visible width in map units; height follows the aspect ratio
}

const pathOf = (pts: Point[], close = false) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ') + (close ? ' Z' : '')

export default function CityMap({ map, locations, current, selected, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ x: 0, y: 0, w: map.width })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ moved: boolean; startView: View; sx: number; sy: number; pinch?: number } | null>(null)
  const fitted = useRef(false)

  const aspect = size.h / size.w
  const vh = view.w * aspect
  const scale = size.w / view.w // screen px per map unit

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width || 1, h: e.contentRect.height || 1 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit the whole city once we know the panel size.
  useEffect(() => {
    if (fitted.current || size.w < 50) return
    fitted.current = true
    const a = size.h / size.w
    const w = Math.max(map.width, map.height / a) * 1.04
    setView({ x: (map.width - w) / 2, y: (map.height - w * a) / 2, w })
  }, [size, map.width, map.height])

  const clampView = useCallback(
    (v: View): View => {
      const minW = map.width / 8
      const maxW = Math.max(map.width, map.height / aspect) * 1.6
      const w = Math.min(maxW, Math.max(minW, v.w))
      const h = w * aspect
      const x = Math.min(map.width - w * 0.25, Math.max(-w * 0.75, v.x))
      const y = Math.min(map.height - h * 0.25, Math.max(-h * 0.75, v.y))
      return { x, y, w }
    },
    [map.width, map.height, aspect],
  )

  const toMap = (clientX: number, clientY: number, v = view) => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: v.x + ((clientX - r.left) / r.width) * v.w, y: v.y + ((clientY - r.top) / r.height) * v.w * aspect }
  }

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    setView((v) => {
      const p = toMap(clientX, clientY, v)
      const w = v.w * factor
      const r = wrap.current!.getBoundingClientRect()
      const fx = (clientX - r.left) / r.width
      const fy = (clientY - r.top) / r.height
      return clampView({ x: p.x - fx * w, y: p.y - fy * w * aspect, w })
    })
  }

  const zoomCenter = (f: number) => {
    const r = wrap.current!.getBoundingClientRect()
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f)
  }

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    drag.current = {
      moved: false,
      startView: view,
      sx: pts.reduce((a, p) => a + p.x, 0) / pts.length,
      sy: pts.reduce((a, p) => a + p.y, 0) / pts.length,
      pinch: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : undefined,
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
    const d = drag.current
    if (Math.hypot(cx - d.sx, cy - d.sy) > 4) d.moved = true
    const r = wrap.current!.getBoundingClientRect()
    let w = d.startView.w
    if (pts.length === 2 && d.pinch) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      w = d.startView.w * (d.pinch / Math.max(dist, 1))
      d.moved = true
    }
    // Keep the map point that was under the gesture's start centre under the current centre.
    const anchorX = d.startView.x + ((d.sx - r.left) / r.width) * d.startView.w
    const anchorY = d.startView.y + ((d.sy - r.top) / r.height) * d.startView.w * aspect
    setView(clampView({ x: anchorX - ((cx - r.left) / r.width) * w, y: anchorY - ((cy - r.top) / r.height) * w * aspect, w }))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const d = drag.current
    if (pointers.current.size === 0) {
      if (d && !d.moved) {
        const id = (e.target as Element).closest?.('[data-loc]')?.getAttribute('data-loc')
        onSelect(id ?? null)
      }
      drag.current = null
    } else if (d) {
      // One finger lifted from a pinch: restart the gesture from here.
      const pts = [...pointers.current.values()]
      drag.current = { moved: true, startView: view, sx: pts[0].x, sy: pts[0].y }
    }
  }

  const centerOn = (id: string) => {
    const l = locations.find((x) => x.id === id)
    if (!l) return
    setView((v) => clampView({ x: l.x - v.w / 2, y: l.y - (v.w * aspect) / 2, w: v.w }))
  }

  // Follow the team when it moves.
  const lastCurrent = useRef(current)
  useEffect(() => {
    if (current && current !== lastCurrent.current) {
      const l = locations.find((x) => x.id === current)
      if (l && (l.x < view.x || l.x > view.x + view.w || l.y < view.y || l.y > view.y + vh)) centerOn(current)
    }
    lastCurrent.current = current
  })

  const px = 1 / scale // one screen pixel in map units
  const showLabels = scale > 0.55
  const streetLabels = scale > 0.8

  const districts = useMemo(
    () =>
      map.districts.map((d) => (
        <path key={d.id} d={pathOf(d.points, true)} className={`map-district tone-${d.tone ?? 'none'}`} />
      )),
    [map.districts],
  )

  const streets = useMemo(
    () =>
      map.streets.map((s, i) => ({
        id: `st-${i}`,
        d: s.points.map((p, j) => `${j ? 'L' : 'M'}${p[0]},${p[1]}`).join(' '),
        kind: s.kind ?? 'street',
        name: s.name,
        len: s.points.reduce((a, p, j) => (j ? a + Math.hypot(p[0] - s.points[j - 1][0], p[1] - s.points[j - 1][1]) : 0), 0),
      })),
    [map.streets],
  )

  return (
    <div className="citymap-wrap">
    <div
      ref={wrap}
      className="citymap"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label={`Map of ${map.name}`}
    >
      <svg viewBox={`${view.x} ${view.y} ${view.w} ${vh}`} width="100%" height="100%">
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={Math.max(2, 6 * px)} />
          </filter>
          <radialGradient id="lamp-halo">
            <stop offset="0" stopColor="#f0a03c" stopOpacity="0.6" />
            <stop offset="0.45" stopColor="#f0a03c" stopOpacity="0.16" />
            <stop offset="1" stopColor="#f0a03c" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x={-map.width} y={-map.height} width={map.width * 3} height={map.height * 3} className="map-sea" />
        <rect x={0} y={0} width={map.width} height={map.height} className="map-land" />
        <g>{districts}</g>
        {map.water?.map((w, i) => <path key={i} d={pathOf(w.points, true)} className="map-water" />)}
        {map.parks?.map((p, i) => <path key={i} d={pathOf(p.points, true)} className="map-park" />)}

        {/* Sodium glow under the streets: the city at night. */}
        <g className="map-street-glow" filter="url(#glow)">
          {streets.map((s) => (
            <path key={s.id} d={s.d} className={`k-${s.kind}`} strokeWidth={s.kind === 'avenue' ? 26 : s.kind === 'rail' ? 0 : 14} />
          ))}
        </g>
        <g className="map-streets">
          {streets.map((s) => (
            <path key={s.id} id={s.id} d={s.d} className={`k-${s.kind}`} strokeWidth={s.kind === 'avenue' ? 5 : s.kind === 'rail' ? 2.5 : 2.6} />
          ))}
        </g>
        {streetLabels && (
          <g className="map-street-names" fontSize={11 * px}>
            {streets
              .filter((s) => s.kind !== 'rail' && s.len * scale > s.name.length * 9)
              .map((s) => (
                <text key={s.id} dy={-5 * px}>
                  <textPath href={`#${s.id}`} startOffset="50%" textAnchor="middle">
                    {s.name}
                  </textPath>
                </text>
              ))}
          </g>
        )}

        <g className="map-district-names">
          {map.districts.map((d) => (
            <text key={d.id} x={d.label[0]} y={d.label[1]} fontSize={Math.max(28, 22 * px)} textAnchor="middle">
              {d.name}
            </text>
          ))}
        </g>

        <g className="map-locations">
          {locations.map((l) => {
            const isCurrent = l.id === current
            const isSel = l.id === selected
            const r = (isCurrent ? 8 : 6) * px
            return (
              <g
                key={l.id}
                data-loc={l.id}
                className={`map-loc ${l.visited ? 'visited' : 'unvisited'} ${isCurrent ? 'current' : ''} ${isSel ? 'selected' : ''}`}
                transform={`translate(${l.x},${l.y})`}
              >
                <circle r={(isCurrent ? 70 : 42) * px} fill="url(#lamp-halo)" className="halo" />
                <circle r={18 * px} fill="transparent" />
                {isSel && <circle r={r + 6 * px} className="sel-ring" strokeWidth={1.6 * px} />}
                <circle r={r} className="lamp" strokeWidth={2 * px} />
                {(showLabels || isSel || isCurrent) && (
                  <text y={-14 * px} fontSize={13 * px} textAnchor="middle" className="map-loc-label">
                    {l.name}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
      <div className="map-zoom">
        <button className="btn small" aria-label="Zoom in" onClick={() => zoomCenter(0.7)}>
          +
        </button>
        <button className="btn small" aria-label="Zoom out" onClick={() => zoomCenter(1.4)}>
          −
        </button>
        {current && (
          <button className="btn small" onClick={() => centerOn(current)}>
            Where we are
          </button>
        )}
      </div>
    </div>
  )
}
