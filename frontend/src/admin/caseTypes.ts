// The full case format (mirrors backend/internal/casefmt/types.go).
import type { MapData } from '../types'

export interface Reveal {
  documents?: string[]
  locations?: string[]
  people?: string[]
  flags?: string[]
}

export interface Visit { id: string; title?: string; requires?: string; text: string; reveals?: Reveal }
export interface Presence { person: string; requires?: string }
export interface Location {
  id: string; name: string; address: string; altAddresses?: string[]; district: string; x: number; y: number
  kind: string; hidden?: boolean; summary: string; visits: Visit[]; presence?: Presence[]; idle?: string
}
export interface Dialogue { id: string; topic: string; requires?: string; text: string; reveals?: Reveal }
export interface Person { id: string; name: string; role: string; description: string; age?: string; dialogue?: Dialogue[]; fallback?: string }
export interface Document { id: string; title: string; kind: string; date?: string; source?: string; body: string; askable?: boolean }
export interface DirEntry { name: string; keys?: string[]; address: string; phone?: string; note?: string; location?: string }
export interface Chapter { id: string; title: string; requires?: string; brief: string; objectives?: string[]; reveals?: Reveal }
export interface Question {
  id: string; prompt: string; kind: 'person' | 'choice'; options?: { id: string; label: string }[]
  required: boolean; points: number; answer?: string; answerHash?: string; evidence?: string[]
}
export interface Clock {
  start: string; dayStartHour: number; dayEndHour: number; travelBase: number; travelPerUnit: number
  interviewMinutes: number; searchMinutes: number; parMinutes: number
}
export interface CaseContent {
  slug: string; title: string; tagline: string; blurb: string; setting: string; difficulty: string
  estimatedMinutes: number; players: string; version: number
  clock: Clock; intro: string; start: Reveal; chapters: Chapter[]; map: MapData
  locations: Location[]; people: Person[]; documents: Document[]; directory: DirEntry[]
  accusation: { intro: string; availableFrom?: string; maxAttempts: number; salt: string; questions: Question[]; successMessage?: string }
  epilogue: string
}

export interface Issue { level: 'error' | 'warning'; where: string; msg: string }
export interface Report {
  issues: Issue[]
  stats: {
    chapters: number; locations: number; people: number; documents: number; scenes: number; directoryEntries: number
    words: number; reachableWords: number; estimatedMinutes: number; exhaustiveActiveMinutes: number
  }
}
