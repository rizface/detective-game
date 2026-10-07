import { useEffect } from 'react'
import { useGame } from '../game/store'
import type { Outcome, Snapshot } from '../types'
import { sound } from './engine'

const maxId = <T extends { id: number }>(list: T[]) => list.reduce((m, x) => Math.max(m, x.id), 0)

function districtTone(snap: Snapshot): string {
  const loc = snap.game.locations.find((l) => l.id === snap.game.current)
  const district = snap.case.map.districts.find((d) => d.id === loc?.district)
  return district?.tone ?? 'center'
}

/** Sounds for one action. Teammates hear each other's actions too. */
function actionSounds(o: Outcome) {
  let delay = 0
  if ((o.action === 'travel' || o.action === 'address') && o.minutes > 0) {
    sound.play('travel')
    delay = 1.3
  }
  if (o.action === 'search') {
    sound.play('phone')
    delay = 1.0
  }
  if (o.revealed?.documents?.length) {
    sound.play('typewriter', delay)
    delay += 1.4
  }
  if (o.chapters?.length) sound.play('chapter', delay + 0.2)
}

/**
 * Watches the game store and plays sounds for what changes. Kept outside the
 * store so the game logic doesn't know about audio.
 */
export function useGameSounds() {
  useEffect(() => {
    sound.setInGame(true)
    let team: string | null = null
    let lastEvent = 0
    let lastChat = 0
    let members = 0
    let attempts = 0

    const init = (snap: Snapshot) => {
      team = snap.team.id
      lastEvent = maxId(snap.events)
      lastChat = maxId(snap.chat)
      members = snap.members.length
      attempts = snap.attempts.length
    }

    const first = useGame.getState().snap
    if (first) {
      init(first)
      sound.setTone(districtTone(first))
    }

    const unsubscribe = useGame.subscribe((s, prev) => {
      if (s.openDoc && s.openDoc !== prev.openDoc) sound.play('rustle')

      const snap = s.snap
      if (!snap) {
        team = null
        return
      }
      if (snap === prev.snap) return
      sound.setTone(districtTone(snap))
      if (team !== snap.team.id) {
        init(snap)
        return
      }

      const fresh = snap.events.filter((e) => e.id > lastEvent)
      if (fresh.length) {
        lastEvent = maxId(fresh)
        // A big batch means a resync after reconnecting, not something that just happened.
        if (fresh.length <= 3) {
          const action = [...fresh].reverse().find((e) => e.kind === 'action')
          if (action) actionSounds(action.payload as Outcome)
        }
      }

      const newChat = snap.chat.filter((m) => m.id > lastChat)
      if (newChat.length) {
        lastChat = maxId(newChat)
        if (newChat.some((m) => m.userId !== snap.you)) sound.play('chat')
      }

      if (snap.members.length > members) sound.play('join')
      members = snap.members.length

      if (snap.attempts.length > attempts) {
        attempts = snap.attempts.length
        sound.play('stamp')
        const status = snap.team.status
        sound.play(status === 'solved' ? 'solved' : status === 'failed' ? 'failed' : 'wrong', 0.6)
      }
    })

    return () => {
      unsubscribe()
      sound.setInGame(false)
    }
  }, [])
}
