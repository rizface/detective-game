import { useId } from 'react'
import type { Reveal } from './caseTypes'

export function Text(p: { label: string; value?: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; list?: string }) {
  return (
    <label className="field">
      <span>{p.label}</span>
      <input
        className={`input ${p.mono ? 'mono' : ''}`}
        value={p.value ?? ''}
        placeholder={p.placeholder}
        list={p.list}
        onChange={(e) => p.onChange(e.target.value)}
      />
    </label>
  )
}

export function Area(p: { label: string; value?: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  return (
    <label className="field">
      <span>
        {p.label}
        {p.hint && <em className="muted"> {p.hint}</em>}
      </span>
      <textarea className="textarea" rows={p.rows ?? 6} value={p.value ?? ''} onChange={(e) => p.onChange(e.target.value)} />
    </label>
  )
}

export function Num(p: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{p.label}</span>
      <input className="input" type="number" value={p.value ?? 0} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  )
}

export function Check(p: { label: string; value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!p.value} onChange={(e) => p.onChange(e.target.checked)} /> {p.label}
    </label>
  )
}

export function Select(p: { label: string; value?: string; onChange: (v: string) => void; options: { value: string; label: string }[]; blank?: string }) {
  return (
    <label className="field">
      <span>{p.label}</span>
      <select className="select" value={p.value ?? ''} onChange={(e) => p.onChange(e.target.value)}>
        {p.blank !== undefined && <option value="">{p.blank}</option>}
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Comma-separated ids with suggestions. */
export function IdList(p: { label: string; value?: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const id = useId()
  return (
    <label className="field">
      <span>{p.label}</span>
      <input
        className="input mono"
        list={id}
        value={(p.value ?? []).join(', ')}
        onChange={(e) =>
          p.onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter((s, i, a) => s || i === a.length - 1),
          )
        }
        onBlur={(e) => p.onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
      />
      <datalist id={id}>
        {p.suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  )
}

export function Cond(p: { label?: string; value?: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>
        {p.label ?? 'Requires'}
        <em className="muted"> e.g. doc:letter &amp; (visited:docks | flag:tailed) &amp; !met:pike</em>
      </span>
      <input className="input mono" value={p.value ?? ''} placeholder="always" onChange={(e) => p.onChange(e.target.value)} />
    </label>
  )
}

export function RevealEditor(p: {
  value?: Reveal
  onChange: (r: Reveal) => void
  ids: { documents: string[]; locations: string[]; people: string[]; flags: string[] }
}) {
  const r = p.value ?? {}
  const set = (k: keyof Reveal, v: string[]) => {
    const next = { ...r, [k]: v }
    if (!v.length) delete next[k]
    p.onChange(next)
  }
  return (
    <fieldset className="reveal">
      <legend>Reveals</legend>
      <div className="grid2">
        <IdList label="Documents" value={r.documents} onChange={(v) => set('documents', v)} suggestions={p.ids.documents} />
        <IdList label="Locations" value={r.locations} onChange={(v) => set('locations', v)} suggestions={p.ids.locations} />
        <IdList label="People" value={r.people} onChange={(v) => set('people', v)} suggestions={p.ids.people} />
        <IdList label="Flags" value={r.flags} onChange={(v) => set('flags', v)} suggestions={p.ids.flags} />
      </div>
    </fieldset>
  )
}
