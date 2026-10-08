import { create } from 'zustand'
import { api, del, patch, post, put } from '../api'
import type {
  AttemptRow, BoardItem, BoardLink, ChatMessage, Delta, DocView, Draft, EventRow, Member, Note, Result, Snapshot,
} from '../types'

export type Tab = 'scene' | 'file' | 'docs' | 'people' | 'directory' | 'notes' | 'log' | 'report'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
  action?: { label: string; run: () => void }
}

interface GameState {
  teamId: string | null
  snap: Snapshot | null
  loading: boolean
  error: string | null
  connection: string | null
  socketState: 'connecting' | 'open' | 'closed'

  tab: Tab
  boardOpen: boolean
  openDoc: string | null
  openPerson: string | null
  selectedLoc: string | null
  focusEvent: number | null // event shown in the Scene tab
  unseenDocs: Set<string>
  unreadChat: number
  viewing: Record<string, string> // userId -> what they're looking at
  dragging: Record<string, { x: number; y: number }>
  busy: boolean
  toasts: Toast[]
  seenEvents: Set<number>
  /** A quote waiting in the note composer for a comment. */
  quoteDraft: { text: string; source: string } | null
  /** Bumped to ask the note composer to focus itself. */
  jotFocus: number

  load: (teamId: string) => Promise<void>
  reset: () => void
  setTab: (t: Tab) => void
  setBoardOpen: (open: boolean) => void
  showDoc: (id: string | null) => void
  showPerson: (id: string | null) => void
  selectLoc: (id: string | null) => void
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void
  dismissToast: (id: number) => void

  travel: (location: string) => Promise<void>
  travelAddress: (address: string) => Promise<boolean>
  ask: (person: string, topic: string) => Promise<void>
  search: (query: string) => Promise<boolean>

  addNote: (note: { body?: string; quote?: string; source?: string }) => Promise<Note | undefined>
  attachQuote: (q: { text: string; source: string } | null) => void
  focusJot: () => void
  openSource: (source: string) => Promise<void>
  editNote: (id: string, body: string) => Promise<void>
  removeNote: (id: string) => Promise<void>
  addCard: (card: Partial<BoardItem>) => Promise<BoardItem | undefined>
  moveCard: (id: string, x: number, y: number) => Promise<void>
  labelCard: (id: string, label: string) => Promise<void>
  removeCard: (id: string) => Promise<void>
  /** Takes whatever card shows this item off the board. */
  unpin: (refKind: BoardItem['refKind'], refId: string) => Promise<void>
  link: (from: string, to: string, label?: string) => Promise<void>
  labelLink: (id: string, label: string) => Promise<void>
  unlink: (id: string) => Promise<void>
  say: (body: string) => Promise<void>
  setAnswers: (answers: Record<string, string>) => Promise<void>
  sign: (yes: boolean) => Promise<void>
  accuse: () => Promise<void>

  handleSocket: (msg: { type: string; by?: string; origin?: string; payload?: any }) => void
  markChatRead: () => void
}

let toastSeq = 0

function upsert<T extends { id: string | number }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

export const useGame = create<GameState>((set, get) => {
  const fail = (e: unknown) => {
    get().toast(e instanceof Error ? e.message : String(e), 'error')
  }

  // Apply a game delta (from our own request or a teammate's) exactly once.
  const applyDelta = (d: Delta, fromSelf: boolean) => {
    const s = get()
    if (!s.snap) return
    if (d.event && s.seenEvents.has(d.event.id)) return
    const seen = new Set(s.seenEvents)
    if (d.event) seen.add(d.event.id)
    const docs: DocView[] = [...s.snap.game.documents]
    const unseen = new Set(s.unseenDocs)
    for (const doc of d.documents) {
      if (!docs.some((x) => x.id === doc.id)) {
        docs.push(doc)
        unseen.add(doc.id)
      }
    }
    const events = d.event ? [...s.snap.events, d.event] : s.snap.events
    set({
      seenEvents: seen,
      unseenDocs: unseen,
      snap: {
        ...s.snap,
        events,
        case: { ...s.snap.case, accusation: { ...s.snap.case.accusation, open: d.accusationOpen } },
        game: {
          chapter: d.chapter, chapters: d.chapters, clock: d.clock, current: d.current, locations: d.locations,
          people: d.people, documents: docs, directory: d.directory, topics: d.topics, accusationOpen: d.accusationOpen,
        },
      },
      // Show the new scene. A teammate's action takes the Scene tab only if
      // we're already on it, so nobody is yanked out of a document.
      ...(d.event && (fromSelf || s.tab === 'scene') ? { focusEvent: d.event.id, tab: 'scene' as Tab } : {}),
      ...(d.outcome.location && (fromSelf || d.outcome.action !== 'ask') ? { selectedLoc: d.outcome.location } : {}),
    })
  }

  const run = async (fn: () => Promise<Delta>) => {
    if (get().busy) return false
    set({ busy: true })
    try {
      const d = await fn()
      applyDelta(d, true)
      return true
    } catch (e) {
      fail(e)
      return false
    } finally {
      set({ busy: false })
    }
  }

  const tp = (path: string) => `/teams/${get().teamId}${path}`

  return {
    teamId: null,
    snap: null,
    loading: false,
    error: null,
    connection: null,
    socketState: 'connecting',
    tab: 'scene',
    boardOpen: false,
    openDoc: null,
    openPerson: null,
    selectedLoc: null,
    focusEvent: null,
    unseenDocs: new Set(),
    unreadChat: 0,
    viewing: {},
    dragging: {},
    busy: false,
    toasts: [],
    seenEvents: new Set(),
    quoteDraft: null,
    jotFocus: 0,

    load: async (teamId) => {
      set({ teamId, loading: true, error: null })
      try {
        const snap = await api<Snapshot>(`/teams/${teamId}/`)
        const lastAction = [...snap.events].reverse().find((e) => e.kind === 'action')
        set({
          snap,
          loading: false,
          seenEvents: new Set(snap.events.map((e) => e.id)),
          focusEvent: lastAction ? lastAction.id : null,
          selectedLoc: get().selectedLoc ?? (snap.game.current || null),
          tab: get().snap ? get().tab : lastAction ? 'scene' : 'file',
        })
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
    reset: () =>
      set({ teamId: null, snap: null, focusEvent: null, selectedLoc: null, openDoc: null, openPerson: null, boardOpen: false,
        unseenDocs: new Set(), seenEvents: new Set(), viewing: {}, dragging: {}, tab: 'scene', unreadChat: 0 }),
    setTab: (tab) => set({ tab }),
    setBoardOpen: (boardOpen) => set({ boardOpen }),
    showDoc: (id) => {
      const unseen = new Set(get().unseenDocs)
      if (id) unseen.delete(id)
      set({ openDoc: id, unseenDocs: unseen })
    },
    showPerson: (id) => set({ openPerson: id }),
    selectLoc: (id) => set({ selectedLoc: id }),
    toast: (text, tone = 'info', action) => {
      const id = ++toastSeq
      set({ toasts: [...get().toasts, { id, text, tone, action }] })
      setTimeout(() => get().dismissToast(id), tone === 'error' || action ? 7000 : 4000)
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

    travel: async (location) => {
      await run(() => post<Delta>(tp('/travel'), { location }))
    },
    travelAddress: (address) => run(() => post<Delta>(tp('/travel'), { address })),
    ask: async (person, topic) => {
      let repeat = false
      await run(async () => {
        const d = await post<Delta>(tp('/ask'), { person, topic })
        repeat = (d.outcome.scenes ?? []).length > 0 && d.outcome.scenes.every((s) => s.repeat)
        return d
      })
      if (repeat) get().toast("You've asked that before. Their answer hasn't changed; it's in the transcript.")
    },
    search: (query) => run(() => post<Delta>(tp('/search'), { query })),

    addNote: async (note) => {
      try {
        const n = await post<Note>(tp('/notes'), note)
        get().handleSocket({ type: 'note.upsert', payload: n })
        return n
      } catch (e) {
        fail(e)
      }
    },
    attachQuote: (q) => set({ quoteDraft: q }),
    focusJot: () => set({ jotFocus: get().jotFocus + 1 }),
    openSource: async (source) => {
      const [kind, id] = source.split(':')
      const s = get()
      if (kind === 'doc') s.showDoc(id)
      else if (kind === 'person') s.showPerson(id)
      else if (kind === 'loc') s.selectLoc(id)
      else if (kind === 'chapter' || kind === 'case') set({ tab: 'file' })
      else if (kind === 'event') {
        const eventId = Number(id)
        let snap = get().snap
        if (snap && !snap.events.some((e) => e.id === eventId)) {
          // Older than what's loaded: fetch the page that contains it.
          try {
            const page = await api<EventRow[]>(tp(`/events?before=${eventId + 1}`))
            snap = get().snap
            if (snap) {
              const known = new Set(snap.events.map((e) => e.id))
              const merged = [...page.filter((e) => !known.has(e.id)), ...snap.events].sort((a, b) => a.id - b.id)
              set({ snap: { ...snap, events: merged } })
            }
          } catch (e) {
            fail(e)
            return
          }
        }
        set({ focusEvent: eventId, tab: 'scene', openDoc: null, openPerson: null })
      }
    },
    editNote: async (id, body) => {
      try {
        const n = await patch<Note>(tp(`/notes/${id}`), { body })
        get().handleSocket({ type: 'note.upsert', payload: n })
      } catch (e) {
        fail(e)
      }
    },
    removeNote: async (id) => {
      try {
        await del(tp(`/notes/${id}`))
        get().handleSocket({ type: 'note.delete', payload: { id } })
      } catch (e) {
        fail(e)
      }
    },
    addCard: async (card) => {
      const existing = card.refKind !== 'text' && get().snap?.board.items.find((i) => i.refKind === card.refKind && i.refId === card.refId)
      if (existing) {
        get().toast('That is already on the board')
        return undefined
      }
      try {
        const it = await post<BoardItem>(tp('/board/items'), card)
        get().handleSocket({ type: 'board.item', payload: it })
        return it
      } catch (e) {
        fail(e)
      }
    },
    moveCard: async (id, x, y) => {
      try {
        const it = await patch<BoardItem>(tp(`/board/items/${id}`), { x, y })
        get().handleSocket({ type: 'board.item', payload: it })
      } catch (e) {
        fail(e)
      }
    },
    labelCard: async (id, label) => {
      try {
        const it = await patch<BoardItem>(tp(`/board/items/${id}`), { label })
        get().handleSocket({ type: 'board.item', payload: it })
      } catch (e) {
        fail(e)
      }
    },
    removeCard: async (id) => {
      const snap = get().snap
      const item = snap?.board.items.find((i) => i.id === id)
      const links = snap?.board.links.filter((l) => l.from === id || l.to === id) ?? []
      try {
        await del(tp(`/board/items/${id}`))
        get().handleSocket({ type: 'board.item.delete', payload: { id } })
      } catch (e) {
        fail(e)
        return
      }
      if (!item) return
      // Undo puts the card back where it was, with its strings to cards still on the board.
      const undo = async () => {
        try {
          const back = await post<BoardItem>(tp('/board/items'), {
            refKind: item.refKind, refId: item.refId, label: item.label, x: item.x, y: item.y,
          })
          get().handleSocket({ type: 'board.item', payload: back })
          const onBoard = new Set(get().snap?.board.items.map((i) => i.id))
          for (const l of links) {
            const from = l.from === id ? back.id : l.from
            const to = l.to === id ? back.id : l.to
            if (!onBoard.has(from) || !onBoard.has(to)) continue
            const nl = await post<BoardLink>(tp('/board/links'), { from, to, label: l.label })
            get().handleSocket({ type: 'board.link', payload: nl })
          }
        } catch (e) {
          fail(e)
        }
      }
      get().toast(`Unpinned ${cardName(get().snap, item)}`, 'info', { label: 'Undo', run: undo })
    },
    unpin: async (refKind, refId) => {
      const item = get().snap?.board.items.find((i) => i.refKind === refKind && i.refId === refId)
      if (item) await get().removeCard(item.id)
    },
    link: async (from, to, label = '') => {
      try {
        const l = await post<BoardLink>(tp('/board/links'), { from, to, label })
        get().handleSocket({ type: 'board.link', payload: l })
      } catch (e) {
        fail(e)
      }
    },
    labelLink: async (id, label) => {
      try {
        const l = await patch<BoardLink>(tp(`/board/links/${id}`), { label })
        get().handleSocket({ type: 'board.link', payload: l })
      } catch (e) {
        fail(e)
      }
    },
    unlink: async (id) => {
      try {
        await del(tp(`/board/links/${id}`))
        get().handleSocket({ type: 'board.link.delete', payload: { id } })
      } catch (e) {
        fail(e)
      }
    },
    say: async (body) => {
      try {
        const m = await post<ChatMessage>(tp('/chat'), { body })
        get().handleSocket({ type: 'chat', by: get().snap?.you, payload: m })
      } catch (e) {
        fail(e)
      }
    },
    setAnswers: async (answers) => {
      // Optimistic: show the change at once so quick successive edits build on it.
      const snap = get().snap
      if (snap) set({ snap: { ...snap, draft: { ...snap.draft, answers, signed: [] } } })
      try {
        const d = await put<Draft>(tp('/draft'), { answers })
        get().handleSocket({ type: 'draft', payload: d })
      } catch (e) {
        fail(e)
      }
    },
    sign: async (yes) => {
      try {
        const d = await post<Draft>(tp(yes ? '/draft/sign' : '/draft/unsign'))
        get().handleSocket({ type: 'draft', payload: d })
      } catch (e) {
        fail(e)
      }
    },
    accuse: async () => {
      set({ busy: true })
      try {
        const res = await post(tp('/accuse'))
        get().handleSocket({ type: 'accusation', payload: res })
      } catch (e) {
        fail(e)
      } finally {
        set({ busy: false })
      }
    },

    markChatRead: () => set({ unreadChat: 0 }),

    handleSocket: (msg) => {
      const s = get()
      if (msg.type === 'hello') {
        set({ connection: msg.payload.connection })
        return
      }
      if (!s.snap) return
      const snap = s.snap
      const mine = msg.origin && msg.origin === s.connection
      switch (msg.type) {
        case 'game':
          applyDelta(msg.payload as Delta, msg.by === snap.you)
          return
        case 'presence': {
          const online = new Set<string>(msg.payload.online)
          set({ snap: { ...snap, members: snap.members.map((m) => ({ ...m, online: online.has(m.id) })) } })
          return
        }
        case 'member.joined': {
          const m = msg.payload as Member
          if (!snap.members.some((x) => x.id === m.id)) {
            set({ snap: { ...snap, members: [...snap.members, { ...m, online: true }] } })
            get().toast(`${m.displayName} joined the agency`)
          }
          return
        }
        case 'member.left':
          set({ snap: { ...snap, members: snap.members.filter((m) => m.id !== msg.by) } })
          return
        case 'note.upsert':
          set({ snap: { ...snap, notes: upsert(snap.notes, msg.payload as Note) } })
          return
        case 'note.delete':
          set({ snap: { ...snap, notes: snap.notes.filter((n) => n.id !== msg.payload.id) } })
          return
        case 'board.item': {
          const it = msg.payload as BoardItem
          const dragging = { ...s.dragging }
          delete dragging[it.id]
          set({ dragging, snap: { ...snap, board: { ...snap.board, items: upsert(snap.board.items, it) } } })
          return
        }
        case 'board.item.delete':
          set({
            snap: {
              ...snap,
              board: {
                items: snap.board.items.filter((i) => i.id !== msg.payload.id),
                links: snap.board.links.filter((l) => l.from !== msg.payload.id && l.to !== msg.payload.id),
              },
            },
          })
          return
        case 'board.link':
          set({ snap: { ...snap, board: { ...snap.board, links: upsert(snap.board.links, msg.payload as BoardLink) } } })
          return
        case 'board.link.delete':
          set({ snap: { ...snap, board: { ...snap.board, links: snap.board.links.filter((l) => l.id !== msg.payload.id) } } })
          return
        case 'board.drag':
          if (mine) return
          set({ dragging: { ...s.dragging, [msg.payload.id]: { x: msg.payload.x, y: msg.payload.y } } })
          return
        case 'viewing':
          if (!msg.by || mine) return
          set({ viewing: { ...s.viewing, [msg.by]: msg.payload?.ref ?? '' } })
          return
        case 'chat': {
          const m = msg.payload as ChatMessage
          if (snap.chat.some((x) => x.id === m.id)) return
          const unread = m.userId !== snap.you && s.tab !== 'notes' ? s.unreadChat + 1 : s.unreadChat
          set({ unreadChat: unread, snap: { ...snap, chat: [...snap.chat, m] } })
          return
        }
        case 'draft':
          if ((msg.payload as Draft).version < snap.draft.version) return
          set({ snap: { ...snap, draft: msg.payload as Draft } })
          return
        case 'accusation': {
          const p = msg.payload as { attempt: AttemptRow; status: Snapshot['team']['status']; attemptsUsed: number; result: Result | null; draft: Draft }
          if (snap.attempts.some((a) => a.attempt === p.attempt.attempt)) return
          set({
            tab: 'report',
            snap: {
              ...snap,
              attempts: [...snap.attempts, p.attempt],
              team: { ...snap.team, status: p.status, attemptsUsed: p.attemptsUsed },
              result: p.result ?? snap.result,
              draft: p.draft,
            },
          })
          return
        }
      }
    },
  }
})

/** A short name for a board card, for messages. */
export function cardName(snap: Snapshot | null, it: BoardItem): string {
  if (!snap) return 'the card'
  const q = (s: string) => `“${s.length > 40 ? s.slice(0, 40) + '…' : s}”`
  switch (it.refKind) {
    case 'doc':
      return q(snap.game.documents.find((d) => d.id === it.refId)?.title ?? 'evidence')
    case 'person':
      return snap.game.people.find((p) => p.id === it.refId)?.name ?? 'a person'
    case 'loc':
      return snap.game.locations.find((l) => l.id === it.refId)?.name ?? 'a place'
    case 'note':
      return 'a note'
    default:
      return it.label ? q(it.label) : 'a card'
  }
}

/** Whether an item is pinned on the board. */
export function useIsPinned(refKind: BoardItem['refKind'], refId: string): boolean {
  return useGame((s) => !!s.snap?.board.items.some((i) => i.refKind === refKind && i.refId === refId))
}

export function memberById(snap: Snapshot | null, id: string | null | undefined): Member | undefined {
  return snap?.members.find((m) => m.id === id)
}

export type { EventRow }
