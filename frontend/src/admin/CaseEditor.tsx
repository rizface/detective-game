import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, post, put } from '../api'
import { TopNav } from '../pages/LibraryPage'
import { Prose } from '../game/util'
import type { MapData, Point } from '../types'
import type { CaseContent, Chapter, DirEntry, Document, Location, Person, Question, Report } from './caseTypes'
import { Area, Check, Cond, IdList, Num, RevealEditor, Select, Text } from './fields'
import './admin.css'

type Section = 'overview' | 'chapters' | 'map' | 'locations' | 'people' | 'documents' | 'directory' | 'report' | 'json'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'map', label: 'Map' },
  { id: 'locations', label: 'Locations' },
  { id: 'people', label: 'People' },
  { id: 'documents', label: 'Documents' },
  { id: 'directory', label: 'Directory' },
  { id: 'report', label: 'Final report' },
  { id: 'json', label: 'Raw JSON' },
]

const DOC_KINDS = ['report', 'letter', 'photo', 'newspaper', 'clipping', 'ledger', 'phone', 'cipher', 'note', 'transcript', 'receipt', 'card', 'telegram', 'map', 'record', 'ticket']
const LOC_KINDS = ['office', 'home', 'apartment', 'bar', 'diner', 'police', 'hospital', 'morgue', 'pier', 'warehouse', 'shop', 'hotel', 'club', 'church', 'park', 'station', 'newspaper', 'bank', 'courthouse', 'factory', 'garage', 'theater', 'school']

interface Meta {
  id: string
  slug: string
  title: string
  sealed: boolean
  published: boolean
  version: number
  teams: number
}

const clone = <T,>(v: T): T => structuredClone(v)

export default function CaseEditor() {
  const { caseId } = useParams()
  const nav = useNavigate()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [content, setContent] = useState<CaseContent | null>(null)
  const [sealed, setSealed] = useState(false)
  const [spoilers, setSpoilers] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [section, setSection] = useState<Section>('overview')
  const [sel, setSel] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const load = async (withSpoilers: boolean) => {
    setError('')
    try {
      const res = await api<Meta & { content: CaseContent }>(`/admin/cases/${caseId}${withSpoilers ? '?spoilers=yes' : ''}`)
      const { content: c, ...m } = res
      setMeta(m)
      setContent(c)
      setSealed(false)
      setDirty(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 423) {
        setMeta(e.body.case)
        setSealed(true)
        return
      }
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (fn: (c: CaseContent) => void) => {
    setContent((c) => {
      if (!c) return c
      const n = clone(c)
      fn(n)
      return n
    })
    setDirty(true)
  }

  const ids = useMemo(() => {
    const c = content
    if (!c) return { documents: [], locations: [], people: [], flags: [], districts: [] as string[] }
    const flags = new Set<string>()
    const addR = (r?: { flags?: string[] }) => r?.flags?.forEach((f) => flags.add(f))
    addR(c.start)
    c.chapters.forEach((ch) => addR(ch.reveals))
    c.locations.forEach((l) => l.visits.forEach((v) => addR(v.reveals)))
    c.people.forEach((p) => p.dialogue?.forEach((d) => addR(d.reveals)))
    return {
      documents: c.documents.map((d) => d.id),
      locations: c.locations.map((l) => l.id),
      people: c.people.map((p) => p.id),
      flags: [...flags],
      districts: c.map.districts.map((d) => d.id),
    }
  }, [content])

  const save = async () => {
    if (!content || !meta) return
    setBusy(true)
    setMsg('')
    setError('')
    try {
      const res = await put<{ version: number; content: CaseContent; report: Report }>(`/admin/cases/${meta.id}${spoilers ? '?spoilers=yes' : ''}`, {
        content,
        version: meta.version,
      })
      setMeta({ ...meta, version: res.version, sealed: false, slug: res.content.slug, title: res.content.title })
      setContent(res.content)
      setReport(res.report)
      setDirty(false)
      const errs = res.report.issues.filter((i) => i.level === 'error').length
      setMsg(errs ? `Saved, with ${errs} errors to fix.` : 'Saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const validate = async () => {
    if (!content) return
    try {
      setReport(await post<Report>('/admin/validate', content))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const publish = async (on: boolean) => {
    if (!meta) return
    if (dirty) {
      setError('Save your changes first.')
      return
    }
    try {
      await post(`/admin/cases/${meta.id}/publish`, { published: on })
      setMeta({ ...meta, published: on })
      setMsg(on ? 'Published. It now appears in the case library.' : 'Unpublished.')
    } catch (e) {
      if (e instanceof ApiError && e.body?.report) setReport(e.body.report)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const playtest = async () => {
    if (!content) return
    if (dirty) await save()
    const { id } = await post<{ id: string }>('/teams', { caseSlug: content.slug, name: 'Playtest' })
    window.open(`/play/${id}`, '_blank')
  }

  const exportJson = () => {
    if (!content) return
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${content.slug}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const remove = async () => {
    if (!meta) return
    const force = meta.teams > 0
    if (!confirm(force ? `Delete this case and the progress of ${meta.teams} teams?` : 'Delete this case?')) return
    await api(`/admin/cases/${meta.id}${force ? '?force=yes' : ''}`, { method: 'DELETE' })
    nav('/editor')
  }

  if (error && !meta) {
    return (
      <>
        <TopNav />
        <main className="page">
          <p className="error-text">{error}</p>
        </main>
      </>
    )
  }

  if (sealed && meta) {
    return (
      <>
        <TopNav />
        <main className="page sealed">
          <h1>This case is sealed</h1>
          <p>
            It shipped with the game, so the editor keeps it closed: opening it shows every clue, every scene and the
            whole solution trail. {meta.teams > 0 && `${meta.teams} teams are playing it.`}
          </p>
          <p className="muted">Version {meta.version}. {meta.published ? 'Published.' : 'Not published.'}</p>
          <div className="row">
            <Link className="btn" to="/editor">
              Back
            </Link>
            <button
              className="btn stamp"
              onClick={() => {
                if (confirm('Really? This spoils the whole case.')) {
                  setSpoilers(true)
                  load(true)
                }
              }}
            >
              Open it and spoil the case
            </button>
          </div>
        </main>
      </>
    )
  }

  if (!content || !meta) return null
  const errors = report?.issues.filter((i) => i.level === 'error') ?? []
  const warnings = report?.issues.filter((i) => i.level === 'warning') ?? []

  return (
    <div className="editor">
      <header className="editor-bar">
        <Link to="/editor" className="brand">
          <span className="dot" /> Editor
        </Link>
        <strong className="editor-title">{content.title}</strong>
        <span className="muted small">
          v{meta.version} {meta.published ? 'published' : 'draft'}
          {dirty ? ', unsaved changes' : ''}
        </span>
        <span className="spacer" />
        {msg && <span className="small editor-msg">{msg}</span>}
        {error && <span className="small error-text">{error}</span>}
        <button className="btn small ghost" onClick={validate}>
          Check
        </button>
        <button className="btn small ghost" onClick={exportJson}>
          Export
        </button>
        <button className="btn small ghost" onClick={playtest}>
          Playtest
        </button>
        <button className="btn small ghost" onClick={() => publish(!meta.published)}>
          {meta.published ? 'Unpublish' : 'Publish'}
        </button>
        <button className="btn small primary" onClick={save} disabled={busy || !dirty}>
          Save
        </button>
      </header>
      <div className="editor-main">
        <nav className="editor-nav">
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? 'on' : ''} onClick={() => setSection(s.id)}>
              {s.label}
              {s.id === 'locations' && <span className="muted"> {content.locations.length}</span>}
              {s.id === 'people' && <span className="muted"> {content.people.length}</span>}
              {s.id === 'documents' && <span className="muted"> {content.documents.length}</span>}
              {s.id === 'directory' && <span className="muted"> {content.directory.length}</span>}
            </button>
          ))}
          <button className="danger" onClick={remove}>
            Delete case
          </button>
        </nav>
        <section className="editor-content">
          {section === 'overview' && <Overview c={content} update={update} ids={ids} />}
          {section === 'chapters' && (
            <ListEditor
              items={content.chapters}
              label={(ch) => ch.title || ch.id}
              sel={sel.chapters ?? 0}
              setSel={(i) => setSel({ ...sel, chapters: i })}
              onAdd={() => update((c) => c.chapters.push({ id: `ch${c.chapters.length + 1}`, title: 'New chapter', brief: '', requires: c.chapters.length ? 'flag:CHANGE_ME' : '' }))}
              onRemove={(i) => update((c) => c.chapters.splice(i, 1))}
              onMove={(i, d) => update((c) => move(c.chapters, i, d))}
              render={(ch, i) => <ChapterForm ch={ch} i={i} update={update} ids={ids} />}
            />
          )}
          {section === 'map' && <MapSection c={content} update={update} />}
          {section === 'locations' && (
            <ListEditor
              items={content.locations}
              label={(l) => `${l.name}${l.hidden ? ' (hidden)' : ''}`}
              sel={sel.locations ?? 0}
              setSel={(i) => setSel({ ...sel, locations: i })}
              onAdd={() =>
                update((c) =>
                  c.locations.push({
                    id: `loc${c.locations.length + 1}`, name: 'New place', address: '', district: c.map.districts[0]?.id ?? '',
                    x: c.map.width / 2, y: c.map.height / 2, kind: 'home', summary: '', visits: [{ id: `loc${c.locations.length + 1}-1`, text: '' }],
                  }),
                )
              }
              onRemove={(i) => update((c) => c.locations.splice(i, 1))}
              onMove={(i, d) => update((c) => move(c.locations, i, d))}
              render={(l, i) => <LocationForm l={l} i={i} c={content} update={update} ids={ids} />}
            />
          )}
          {section === 'people' && (
            <ListEditor
              items={content.people}
              label={(p) => p.name || p.id}
              sel={sel.people ?? 0}
              setSel={(i) => setSel({ ...sel, people: i })}
              onAdd={() => update((c) => c.people.push({ id: `person${c.people.length + 1}`, name: 'New person', role: '', description: '', dialogue: [], fallback: '' }))}
              onRemove={(i) => update((c) => c.people.splice(i, 1))}
              onMove={(i, d) => update((c) => move(c.people, i, d))}
              render={(p, i) => <PersonForm p={p} i={i} c={content} update={update} ids={ids} />}
            />
          )}
          {section === 'documents' && (
            <ListEditor
              items={content.documents}
              label={(d) => d.title || d.id}
              sel={sel.documents ?? 0}
              setSel={(i) => setSel({ ...sel, documents: i })}
              onAdd={() => update((c) => c.documents.push({ id: `doc${c.documents.length + 1}`, title: 'New document', kind: 'note', body: '' }))}
              onRemove={(i) => update((c) => c.documents.splice(i, 1))}
              onMove={(i, d) => update((c) => move(c.documents, i, d))}
              render={(d, i) => <DocumentForm d={d} i={i} update={update} />}
            />
          )}
          {section === 'directory' && <DirectorySection c={content} update={update} ids={ids} />}
          {section === 'report' && <ReportSection c={content} update={update} ids={ids} />}
          {section === 'json' && <JsonSection c={content} onApply={(c) => { setContent(c); setDirty(true) }} />}
        </section>
        <aside className="editor-report">
          <h3>Check</h3>
          {!report && <p className="muted small">Press Check to validate references and simulate a playthrough.</p>}
          {report && (
            <>
              <p className="small">
                {errors.length} errors, {warnings.length} warnings
              </p>
              <dl className="stats">
                <dt>Words</dt>
                <dd>{report.stats.words.toLocaleString()}</dd>
                <dt>Scenes</dt>
                <dd>{report.stats.scenes}</dd>
                <dt>Estimated play</dt>
                <dd>{Math.round(report.stats.estimatedMinutes / 6) / 10} h</dd>
              </dl>
              <ul className="issues">
                {report.issues.map((is, i) => (
                  <li key={i} className={is.level}>
                    <strong>{is.where}</strong> {is.msg}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function move<T>(arr: T[], i: number, d: number) {
  const j = i + d
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

function ListEditor<T>(p: {
  items: T[]
  label: (t: T) => string
  sel: number
  setSel: (i: number) => void
  onAdd: () => void
  onRemove: (i: number) => void
  onMove: (i: number, d: number) => void
  render: (t: T, i: number) => React.ReactNode
}) {
  const [q, setQ] = useState('')
  const i = Math.min(p.sel, p.items.length - 1)
  const item = p.items[i]
  return (
    <div className="list-editor">
      <div className="list-side">
        <input className="input" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul>
          {p.items.map((it, k) =>
            !q || p.label(it).toLowerCase().includes(q.toLowerCase()) ? (
              <li key={k}>
                <button className={k === i ? 'on' : ''} onClick={() => p.setSel(k)}>
                  {p.label(it)}
                </button>
              </li>
            ) : null,
          )}
        </ul>
        <button
          className="btn small"
          onClick={() => {
            p.onAdd()
            p.setSel(p.items.length)
          }}
        >
          Add
        </button>
      </div>
      <div className="list-form">
        {item ? (
          <>
            <div className="row list-tools">
              <button className="btn small ghost" onClick={() => { p.onMove(i, -1); p.setSel(Math.max(0, i - 1)) }}>
                Move up
              </button>
              <button className="btn small ghost" onClick={() => { p.onMove(i, 1); p.setSel(Math.min(p.items.length - 1, i + 1)) }}>
                Move down
              </button>
              <span className="spacer" />
              <button className="btn small ghost danger" onClick={() => confirm('Remove this?') && p.onRemove(i)}>
                Remove
              </button>
            </div>
            {p.render(item, i)}
          </>
        ) : (
          <p className="muted">Nothing here yet. Add one.</p>
        )}
      </div>
    </div>
  )
}

type Upd = (fn: (c: CaseContent) => void) => void
type Ids = { documents: string[]; locations: string[]; people: string[]; flags: string[]; districts: string[] }

function Overview({ c, update, ids }: { c: CaseContent; update: Upd; ids: Ids }) {
  const clk = c.clock
  return (
    <div className="form">
      <div className="grid2">
        <Text label="Title" value={c.title} onChange={(v) => update((n) => (n.title = v))} />
        <Text label="Slug (URL)" mono value={c.slug} onChange={(v) => update((n) => (n.slug = v))} />
        <Text label="Tagline" value={c.tagline} onChange={(v) => update((n) => (n.tagline = v))} />
        <Text label="Setting" value={c.setting} placeholder="Port Aurelia, October 1985" onChange={(v) => update((n) => (n.setting = v))} />
        <Text label="Difficulty" value={c.difficulty} onChange={(v) => update((n) => (n.difficulty = v))} />
        <Text label="Players" value={c.players} onChange={(v) => update((n) => (n.players = v))} />
        <Num label="Estimated minutes" value={c.estimatedMinutes} onChange={(v) => update((n) => (n.estimatedMinutes = v))} />
      </div>
      <Area label="Library blurb" rows={3} value={c.blurb} onChange={(v) => update((n) => (n.blurb = v))} />
      <Area label="Intro" hint="markdown; read when the case opens" rows={10} value={c.intro} onChange={(v) => update((n) => (n.intro = v))} />
      <RevealEditor value={c.start} onChange={(r) => update((n) => (n.start = r))} ids={ids} />
      <fieldset className="reveal">
        <legend>Clock</legend>
        <div className="grid3">
          <Text label="Start (YYYY-MM-DDTHH:MM)" mono value={clk.start} onChange={(v) => update((n) => (n.clock.start = v))} />
          <Num label="Day starts (hour)" value={clk.dayStartHour} onChange={(v) => update((n) => (n.clock.dayStartHour = v))} />
          <Num label="Day ends (hour)" value={clk.dayEndHour} onChange={(v) => update((n) => (n.clock.dayEndHour = v))} />
          <Num label="Minutes per trip" value={clk.travelBase} onChange={(v) => update((n) => (n.clock.travelBase = v))} />
          <Num label="Extra min per 100 units" value={clk.travelPerUnit} onChange={(v) => update((n) => (n.clock.travelPerUnit = v))} />
          <Num label="Minutes per question" value={clk.interviewMinutes} onChange={(v) => update((n) => (n.clock.interviewMinutes = v))} />
          <Num label="Minutes per lookup" value={clk.searchMinutes} onChange={(v) => update((n) => (n.clock.searchMinutes = v))} />
          <Num label="Par (minutes)" value={clk.parMinutes} onChange={(v) => update((n) => (n.clock.parMinutes = v))} />
        </div>
      </fieldset>
      <Area label="Epilogue" hint="markdown; shown when the case ends" rows={10} value={c.epilogue} onChange={(v) => update((n) => (n.epilogue = v))} />
    </div>
  )
}

function ChapterForm({ ch, i, update, ids }: { ch: Chapter; i: number; update: Upd; ids: Ids }) {
  const set = (fn: (x: Chapter) => void) => update((c) => fn(c.chapters[i]))
  return (
    <div className="form">
      <div className="grid2">
        <Text label="Id" mono value={ch.id} onChange={(v) => set((x) => (x.id = v))} />
        <Text label="Title" value={ch.title} onChange={(v) => set((x) => (x.title = v))} />
      </div>
      {i > 0 ? <Cond label="Starts when" value={ch.requires} onChange={(v) => set((x) => (x.requires = v))} /> : <p className="muted small">The first chapter starts immediately.</p>}
      <Area label="Brief" hint="markdown" rows={8} value={ch.brief} onChange={(v) => set((x) => (x.brief = v))} />
      <Area
        label="Open questions"
        hint="one per line"
        rows={4}
        value={(ch.objectives ?? []).join('\n')}
        onChange={(v) => set((x) => (x.objectives = v.split('\n').filter((s) => s.trim())))}
      />
      <RevealEditor value={ch.reveals} onChange={(r) => set((x) => (x.reveals = r))} ids={ids} />
    </div>
  )
}

function LocationForm({ l, i, c, update, ids }: { l: Location; i: number; c: CaseContent; update: Upd; ids: Ids }) {
  const set = (fn: (x: Location) => void) => update((n) => fn(n.locations[i]))
  return (
    <div className="form">
      <div className="grid2">
        <Text label="Id" mono value={l.id} onChange={(v) => set((x) => (x.id = v))} />
        <Text label="Name" value={l.name} onChange={(v) => set((x) => (x.name = v))} />
        <Text label="Address" value={l.address} onChange={(v) => set((x) => (x.address = v))} />
        <IdList label="Other addresses" value={l.altAddresses} onChange={(v) => set((x) => (x.altAddresses = v))} suggestions={[]} />
        <Select label="District" value={l.district} onChange={(v) => set((x) => (x.district = v))} options={c.map.districts.map((d) => ({ value: d.id, label: d.name }))} />
        <Select label="Kind (icon)" value={l.kind} onChange={(v) => set((x) => (x.kind = v))} options={LOC_KINDS.map((k) => ({ value: k, label: k }))} />
        <Num label="X" value={l.x} onChange={(v) => set((x) => (x.x = v))} />
        <Num label="Y" value={l.y} onChange={(v) => set((x) => (x.y = v))} />
      </div>
      <MiniMap map={c.map} locations={c.locations} selected={l.id} onPick={(pt) => set((x) => { x.x = Math.round(pt[0]); x.y = Math.round(pt[1]) })} />
      <Check label="Hidden until revealed (still reachable by typing the address)" value={l.hidden} onChange={(v) => set((x) => (x.hidden = v))} />
      <Text label="Summary (one line on the map)" value={l.summary} onChange={(v) => set((x) => (x.summary = v))} />
      <Text label="Nothing-new line" value={l.idle} onChange={(v) => set((x) => (x.idle = v))} />

      <h3 className="form-h">People present</h3>
      {(l.presence ?? []).map((p, k) => (
        <div key={k} className="grid2 sub">
          <Select label="Person" value={p.person} onChange={(v) => set((x) => (x.presence![k].person = v))} options={ids.people.map((id) => ({ value: id, label: id }))} blank="Choose" />
          <div>
            <Cond label="While" value={p.requires} onChange={(v) => set((x) => (x.presence![k].requires = v))} />
            <button className="link-btn small" onClick={() => set((x) => x.presence!.splice(k, 1))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <button className="btn small" onClick={() => set((x) => (x.presence = [...(x.presence ?? []), { person: '' }]))}>
        Add person
      </button>

      <h3 className="form-h">Scenes on arrival</h3>
      <p className="muted small">Each plays once, in order, the first time the team arrives while its condition holds.</p>
      {l.visits.map((v, k) => (
        <fieldset key={k} className="sub scene-edit">
          <legend>Scene {k + 1}</legend>
          <div className="grid2">
            <Text label="Id" mono value={v.id} onChange={(val) => set((x) => (x.visits[k].id = val))} />
            <Text label="Title" value={v.title} onChange={(val) => set((x) => (x.visits[k].title = val))} />
          </div>
          <Cond value={v.requires} onChange={(val) => set((x) => (x.visits[k].requires = val))} />
          <Area label="Text" hint="markdown" rows={8} value={v.text} onChange={(val) => set((x) => (x.visits[k].text = val))} />
          <RevealEditor value={v.reveals} onChange={(r) => set((x) => (x.visits[k].reveals = r))} ids={ids} />
          <button className="link-btn small" onClick={() => set((x) => x.visits.splice(k, 1))}>
            Remove scene
          </button>
        </fieldset>
      ))}
      <button className="btn small" onClick={() => set((x) => x.visits.push({ id: `${x.id}-${x.visits.length + 1}`, text: '' }))}>
        Add scene
      </button>
    </div>
  )
}

function PersonForm({ p, i, c, update, ids }: { p: Person; i: number; c: CaseContent; update: Upd; ids: Ids }) {
  const set = (fn: (x: Person) => void) => update((n) => fn(n.people[i]))
  const topics = [
    'intro',
    'any',
    ...ids.people.map((x) => `person:${x}`),
    ...ids.locations.map((x) => `loc:${x}`),
    ...c.documents.filter((d) => d.askable).map((d) => `doc:${d.id}`),
  ]
  return (
    <div className="form">
      <div className="grid2">
        <Text label="Id" mono value={p.id} onChange={(v) => set((x) => (x.id = v))} />
        <Text label="Name" value={p.name} onChange={(v) => set((x) => (x.name = v))} />
        <Text label="Role" value={p.role} onChange={(v) => set((x) => (x.role = v))} />
        <Text label="Age" value={p.age} onChange={(v) => set((x) => (x.age = v))} />
      </div>
      <Area label="Dossier" hint="markdown; what the team knows on hearing the name" rows={4} value={p.description} onChange={(v) => set((x) => (x.description = v))} />
      <Text label="Fallback (asked about something they don't discuss)" value={p.fallback} onChange={(v) => set((x) => (x.fallback = v))} />
      <h3 className="form-h">Dialogue</h3>
      <p className="muted small">
        Topic <code>intro</code> plays on first meeting; <code>any</code> plays after any question once its condition holds.
      </p>
      <datalist id={`topics-${p.id}`}>
        {topics.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {(p.dialogue ?? []).map((d, k) => (
        <fieldset key={k} className="sub scene-edit">
          <legend>{d.topic || 'answer'}</legend>
          <div className="grid2">
            <Text label="Id" mono value={d.id} onChange={(v) => set((x) => (x.dialogue![k].id = v))} />
            <Text label="Topic" mono list={`topics-${p.id}`} value={d.topic} onChange={(v) => set((x) => (x.dialogue![k].topic = v))} />
          </div>
          <Cond value={d.requires} onChange={(v) => set((x) => (x.dialogue![k].requires = v))} />
          <Area label="Text" rows={6} value={d.text} onChange={(v) => set((x) => (x.dialogue![k].text = v))} />
          <RevealEditor value={d.reveals} onChange={(r) => set((x) => (x.dialogue![k].reveals = r))} ids={ids} />
          <button className="link-btn small" onClick={() => set((x) => x.dialogue!.splice(k, 1))}>
            Remove answer
          </button>
        </fieldset>
      ))}
      <button className="btn small" onClick={() => set((x) => (x.dialogue = [...(x.dialogue ?? []), { id: `${x.id}-${(x.dialogue?.length ?? 0) + 1}`, topic: 'intro', text: '' }]))}>
        Add answer
      </button>
    </div>
  )
}

function DocumentForm({ d, i, update }: { d: Document; i: number; update: Upd }) {
  const set = (fn: (x: Document) => void) => update((n) => fn(n.documents[i]))
  const [preview, setPreview] = useState(false)
  return (
    <div className="form">
      <div className="grid2">
        <Text label="Id" mono value={d.id} onChange={(v) => set((x) => (x.id = v))} />
        <Text label="Title" value={d.title} onChange={(v) => set((x) => (x.title = v))} />
        <Select label="Kind" value={d.kind} onChange={(v) => set((x) => (x.kind = v))} options={DOC_KINDS.map((k) => ({ value: k, label: k }))} />
        <Text label="Date" value={d.date} onChange={(v) => set((x) => (x.date = v))} />
        <Text label="Source" value={d.source} onChange={(v) => set((x) => (x.source = v))} />
      </div>
      <Check label="Can be shown to people in interviews" value={d.askable} onChange={(v) => set((x) => (x.askable = v))} />
      <div className="row">
        <button className={`btn small ${preview ? '' : 'ghost'}`} onClick={() => setPreview(!preview)}>
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <article className={`paper kind-${d.kind}`} style={{ marginTop: '1rem' }}>
          <h2 style={{ fontFamily: 'var(--type)', fontSize: '1.3rem' }}>{d.title}</h2>
          <Prose text={d.body} />
        </article>
      ) : (
        <Area label="Body" hint="markdown" rows={18} value={d.body} onChange={(v) => set((x) => (x.body = v))} />
      )}
    </div>
  )
}

function DirectorySection({ c, update, ids }: { c: CaseContent; update: Upd; ids: Ids }) {
  const set = (k: number, fn: (x: DirEntry) => void) => update((n) => fn(n.directory[k]))
  return (
    <div className="form">
      <p className="muted small">
        Players find entries by typing an exact key: by default the full name and the surname. Add keys for businesses
        ("Blue Anchor").
      </p>
      <table className="admin-table dir-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Keys</th>
            <th>Address</th>
            <th>Phone</th>
            <th>Note</th>
            <th>Location</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {c.directory.map((e, k) => (
            <tr key={k}>
              <td><input className="input" value={e.name} onChange={(ev) => set(k, (x) => (x.name = ev.target.value))} /></td>
              <td><input className="input mono" value={(e.keys ?? []).join(', ')} onChange={(ev) => set(k, (x) => (x.keys = ev.target.value.split(',').map((s) => s.trim()).filter(Boolean)))} /></td>
              <td><input className="input" value={e.address} onChange={(ev) => set(k, (x) => (x.address = ev.target.value))} /></td>
              <td><input className="input" value={e.phone ?? ''} onChange={(ev) => set(k, (x) => (x.phone = ev.target.value))} /></td>
              <td><input className="input" value={e.note ?? ''} onChange={(ev) => set(k, (x) => (x.note = ev.target.value))} /></td>
              <td>
                <select className="select" value={e.location ?? ''} onChange={(ev) => set(k, (x) => (x.location = ev.target.value || undefined))}>
                  <option value="">none</option>
                  {ids.locations.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </td>
              <td><button className="link-btn small" onClick={() => update((n) => n.directory.splice(k, 1))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn small" onClick={() => update((n) => n.directory.push({ name: '', address: '' }))}>
        Add entry
      </button>
    </div>
  )
}

function ReportSection({ c, update, ids }: { c: CaseContent; update: Upd; ids: Ids }) {
  const a = c.accusation
  const setQ = (k: number, fn: (q: Question) => void) => update((n) => fn(n.accusation.questions[k]))
  return (
    <div className="form">
      <Area label="Intro" rows={4} value={a.intro} onChange={(v) => update((n) => (n.accusation.intro = v))} />
      <div className="grid2">
        <Cond label="Report opens when" value={a.availableFrom} onChange={(v) => update((n) => (n.accusation.availableFrom = v))} />
        <Num label="Attempts" value={a.maxAttempts} onChange={(v) => update((n) => (n.accusation.maxAttempts = v))} />
      </div>
      <p className="muted small">Answers are stored as hashes. Leave an answer blank to keep the one already set.</p>
      {a.questions.map((q, k) => (
        <fieldset key={k} className="sub scene-edit">
          <legend>Question {k + 1}</legend>
          <div className="grid2">
            <Text label="Id" mono value={q.id} onChange={(v) => setQ(k, (x) => (x.id = v))} />
            <Select label="Kind" value={q.kind} onChange={(v) => setQ(k, (x) => (x.kind = v as Question['kind']))} options={[{ value: 'person', label: 'Pick a person' }, { value: 'choice', label: 'Multiple choice' }]} />
          </div>
          <Text label="Prompt" value={q.prompt} onChange={(v) => setQ(k, (x) => (x.prompt = v))} />
          <div className="grid3">
            <Check label="Required to solve" value={q.required} onChange={(v) => setQ(k, (x) => (x.required = v))} />
            <Num label="Points" value={q.points} onChange={(v) => setQ(k, (x) => (x.points = v))} />
          </div>
          {q.kind === 'choice' && (
            <Area
              label="Options"
              hint="one per line as id: label"
              rows={5}
              value={(q.options ?? []).map((o) => `${o.id}: ${o.label}`).join('\n')}
              onChange={(v) =>
                setQ(k, (x) => (x.options = v.split('\n').filter((l) => l.includes(':')).map((l) => ({ id: l.split(':')[0].trim(), label: l.slice(l.indexOf(':') + 1).trim() }))))
              }
            />
          )}
          {q.kind === 'person' ? (
            <Select
              label={q.answerHash && !q.answer ? 'Answer (set; choose to replace)' : 'Answer'}
              value={q.answer}
              blank="keep"
              onChange={(v) => setQ(k, (x) => (x.answer = v || undefined))}
              options={ids.people.map((id) => ({ value: id, label: id }))}
            />
          ) : (
            <Select
              label={q.answerHash && !q.answer ? 'Answer (set; choose to replace)' : 'Answer'}
              value={q.answer}
              blank="keep"
              onChange={(v) => setQ(k, (x) => (x.answer = v || undefined))}
              options={(q.options ?? []).map((o) => ({ value: o.id, label: o.label }))}
            />
          )}
          <IdList label="Evidence (doc:x, flag:y, scene:z) that makes the answer fair" value={q.evidence} onChange={(v) => setQ(k, (x) => (x.evidence = v))} suggestions={[...ids.documents.map((d) => `doc:${d}`), ...ids.flags.map((f) => `flag:${f}`)]} />
          <button className="link-btn small" onClick={() => update((n) => n.accusation.questions.splice(k, 1))}>
            Remove question
          </button>
        </fieldset>
      ))}
      <button className="btn small" onClick={() => update((n) => n.accusation.questions.push({ id: `q${n.accusation.questions.length + 1}`, prompt: '', kind: 'person', required: true, points: 10 }))}>
        Add question
      </button>
    </div>
  )
}

function JsonSection({ c, onApply }: { c: CaseContent; onApply: (c: CaseContent) => void }) {
  const [text, setText] = useState(() => JSON.stringify(c, null, 2))
  const [err, setErr] = useState('')
  return (
    <div className="form">
      <p className="muted small">The whole case as JSON. Apply, then Save.</p>
      <textarea className="textarea mono json" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {err && <p className="error-text">{err}</p>}
      <div className="row">
        <button className="btn small ghost" onClick={() => setText(JSON.stringify(c, null, 2))}>
          Reset
        </button>
        <button
          className="btn small primary"
          onClick={() => {
            try {
              onApply(JSON.parse(text))
              setErr('')
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

function MapSection({ c, update }: { c: CaseContent; update: Upd }) {
  const [text, setText] = useState(() => JSON.stringify(c.map, null, 2))
  const [err, setErr] = useState('')
  return (
    <div className="form">
      <p className="muted small">
        The map is drawn from districts (polygons), water, parks and streets (polylines) in a space of width × height
        units. Street names are what players type in addresses. Place locations from the Locations section by clicking
        the small map there.
      </p>
      <MiniMap map={c.map} locations={c.locations} big />
      <textarea className="textarea mono json" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {err && <p className="error-text">{err}</p>}
      <button
        className="btn small primary"
        onClick={() => {
          try {
            const m = JSON.parse(text) as MapData
            update((n) => (n.map = m))
            setErr('')
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        Apply map
      </button>
    </div>
  )
}

function MiniMap({ map, locations, selected, onPick, big }: { map: MapData; locations: Location[]; selected?: string; onPick?: (p: Point) => void; big?: boolean }) {
  const d = (pts: Point[], close = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ') + (close ? 'Z' : '')
  return (
    <svg
      className={`minimap ${big ? 'big' : ''} ${onPick ? 'pick' : ''}`}
      viewBox={`0 0 ${map.width} ${map.height}`}
      onClick={(e) => {
        if (!onPick) return
        const svg = e.currentTarget
        const pt = svg.createSVGPoint()
        pt.x = e.clientX
        pt.y = e.clientY
        const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
        onPick([p.x, p.y])
      }}
    >
      <rect width={map.width} height={map.height} fill="#0f2028" />
      {map.districts.map((x) => <path key={x.id} d={d(x.points, true)} fill="#13283a" stroke="#2a4955" strokeWidth={3} />)}
      {map.water?.map((x, i) => <path key={i} d={d(x.points, true)} fill="#071119" />)}
      {map.parks?.map((x, i) => <path key={i} d={d(x.points, true)} fill="#11271f" />)}
      {map.streets.map((s, i) => <path key={i} d={d(s.points)} stroke={s.kind === 'avenue' ? '#e9a552' : '#a87a40'} strokeWidth={s.kind === 'avenue' ? 6 : 3} fill="none" />)}
      {map.districts.map((x) => (
        <text key={x.id} x={x.label[0]} y={x.label[1]} fill="#6f9aa7" fontSize={Math.max(24, map.width / 50)} textAnchor="middle" opacity={0.6}>
          {x.name}
        </text>
      ))}
      {locations.map((l) => (
        <g key={l.id}>
          <circle cx={l.x} cy={l.y} r={l.id === selected ? map.width / 90 : map.width / 160} fill={l.id === selected ? '#fff' : l.hidden ? '#8fb3bf' : '#f0a03c'} />
          {(big || l.id === selected) && (
            <text x={l.x} y={l.y - map.width / 100} fill="#dde5e2" fontSize={map.width / 80} textAnchor="middle">
              {l.name}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}
