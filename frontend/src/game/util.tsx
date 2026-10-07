import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Snapshot } from '../types'

export function Prose({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`prose ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  )
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2006-01-02T15:04" (in-game, timezone-less) -> parts */
export function gameTime(now: string) {
  const [d, t] = now.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, day))
  return {
    weekday: DAYS[date.getUTCDay()],
    date: `${MONTHS[m - 1]} ${day}, ${y}`,
    time: t,
  }
}

export function clockAt(snap: Snapshot, clockMinutes: number) {
  const start = snap.game.clock.now // current
  // Derive the start time from the current clock: start = now - clock.
  const [d, t] = start.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const [hh, mm] = t.split(':').map(Number)
  const base = Date.UTC(y, m - 1, day, hh, mm) - snap.game.clock.clock * 60000
  const at = new Date(base + clockMinutes * 60000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    day: `${DAYS[at.getUTCDay()].slice(0, 3)} ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`,
    time: `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`,
  }
}

export function duration(min: number) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export function topicLabel(snap: Snapshot, topic: string): string {
  if (topic === 'intro') return 'Introduce yourselves'
  const [kind, id] = topic.split(':')
  if (kind === 'person') return snap.game.people.find((p) => p.id === id)?.name ?? id
  if (kind === 'loc') return snap.game.locations.find((l) => l.id === id)?.name ?? id
  if (kind === 'doc') return snap.game.documents.find((d) => d.id === id)?.title ?? id
  return topic
}

export function personName(snap: Snapshot, id?: string) {
  return snap.game.people.find((p) => p.id === id)?.name ?? 'Someone'
}

export function locName(snap: Snapshot, id?: string) {
  return snap.game.locations.find((l) => l.id === id)?.name ?? 'Somewhere'
}

export const KIND_LABEL: Record<string, string> = {
  report: 'Report', letter: 'Letter', photo: 'Photograph', newspaper: 'Newspaper', ledger: 'Ledger',
  phone: 'Phone record', cipher: 'Coded message', note: 'Note', transcript: 'Transcript', receipt: 'Receipt',
  card: 'Card', telegram: 'Telegram', map: 'Map', record: 'Record', clipping: 'Clipping', ticket: 'Ticket',
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
