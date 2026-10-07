// Shapes returned by the Go API (see backend/internal/server/view.go).

export interface User {
  id: string
  email: string
  displayName: string
  isAdmin: boolean
}

export interface CaseSummary {
  id: string
  slug: string
  title: string
  tagline: string
  blurb: string
  setting: string
  difficulty: string
  estimatedMinutes: number
  players: string
  published: boolean
}

export interface Team {
  id: string
  caseId: string
  name: string
  inviteCode: string
  ownerId: string
  status: 'active' | 'solved' | 'failed'
  attemptsUsed: number
  maxAttempts: number
  createdAt: string
}

export interface TeamListing extends Team {
  caseSlug: string
  caseTitle: string
  members: string[]
  updatedAt: string
  chapter: number
  chapters: number
}

export interface Member {
  id: string
  displayName: string
  color: string
  online: boolean
}

export type Point = [number, number]

export interface MapData {
  name: string
  width: number
  height: number
  districts: { id: string; name: string; points: Point[]; label: Point; tone?: string; blurb?: string }[]
  water?: { name?: string; points: Point[] }[]
  parks?: { name?: string; points: Point[] }[]
  streets: { name: string; kind?: string; points: Point[] }[]
}

export interface LocationView {
  id: string
  name: string
  address: string
  district: string
  kind: string
  summary: string
  x: number
  y: number
  visited: boolean
  present: string[]
  travel: number
  foundAt: number
}

export interface PersonView {
  id: string
  name: string
  role: string
  age?: string
  description: string
  met: boolean
  foundAt: number
}

export interface DocView {
  id: string
  title: string
  kind: string
  date?: string
  source?: string
  body: string
  askable: boolean
  foundAt: number
}

export interface ChapterView {
  id: string
  title: string
  brief: string
  objectives?: string[]
}

export interface ClockView {
  active: number
  clock: number
  now: string
  day: number
  par: number
  actions: number
}

export interface DirEntry {
  name: string
  address: string
  phone?: string
  note?: string
  location?: string
}

export interface Question {
  id: string
  prompt: string
  kind: 'person' | 'choice'
  options?: { id: string; label: string }[]
  required: boolean
  points: number
}

export interface CaseView {
  slug: string
  title: string
  tagline: string
  setting: string
  intro: string
  map: MapData
  totalChapters: number
  accusation: { intro: string; open: boolean; questions: Question[] }
}

export interface Scene {
  id: string
  kind: 'visit' | 'dialogue' | 'chapter' | 'idle' | 'info'
  title?: string
  speaker?: string
  text: string
  repeat?: boolean
}

export interface Reveal {
  documents?: string[]
  locations?: string[]
  people?: string[]
  flags?: string[]
}

export interface Outcome {
  action: 'travel' | 'ask' | 'search' | 'address'
  location?: string
  person?: string
  topic?: string
  query?: string
  scenes: Scene[]
  revealed: Reveal
  chapters?: string[]
  directory?: DirEntry[]
  minutes: number
  overnight?: boolean
}

export interface GameView {
  chapter: number
  chapters: ChapterView[]
  clock: ClockView
  current: string
  locations: LocationView[]
  people: PersonView[]
  documents: DocView[]
  directory: DirEntry[]
  topics: string[]
  accusationOpen: boolean
}

export interface EventRow {
  id: number
  kind: 'action' | 'opened' | 'joined' | 'accusation'
  by: string | null
  payload: any
  clock: number
  createdAt: string
}

export interface Delta extends Omit<GameView, 'documents'> {
  outcome: Outcome
  event?: EventRow
  documents: DocView[]
}

export interface Note {
  id: string
  authorId: string | null
  body: string
  createdAt: string
  updatedAt: string
}

export interface BoardItem {
  id: string
  refKind: 'doc' | 'person' | 'loc' | 'note' | 'text'
  refId: string
  label: string
  x: number
  y: number
  createdBy: string | null
}

export interface BoardLink {
  id: string
  from: string
  to: string
  label: string
}

export interface ChatMessage {
  id: number
  userId: string | null
  body: string
  createdAt: string
}

export interface Draft {
  answers: Record<string, string>
  signed: string[]
  updatedBy?: string
  version: number
}

export interface AttemptRow {
  attempt: number
  requiredCorrect: number
  requiredTotal: number
  passed: boolean
  submittedBy: string | null
  createdAt: string
}

export interface Result {
  status: 'solved' | 'failed'
  questions: { id: string; prompt: string; correct: boolean; given: string; answer: string; points: number }[]
  points: number
  maxPoints: number
  active: number
  par: number
  attempts: number
  score: number
  rank: string
  epilogue: string
  finished: string
}

export interface Snapshot {
  team: Team
  you: string
  members: Member[]
  case: CaseView
  game: GameView
  notes: Note[]
  board: { items: BoardItem[]; links: BoardLink[] }
  chat: ChatMessage[]
  events: EventRow[]
  draft: Draft
  attempts: AttemptRow[]
  result: Result | null
}
