import type { BoardItem } from '../types'
import { useGame, useIsPinned } from './store'

/**
 * Pins an item to the evidence board, or takes it off if it's already there.
 * New cards land somewhere near the middle of the board.
 */
export default function PinButton({
  refKind,
  refId,
  name,
  className = 'btn small ghost',
  pin = 'Pin',
  unpin = 'Unpin',
}: {
  refKind: Exclude<BoardItem['refKind'], 'text'>
  refId: string
  name: string // for the confirmation, e.g. "Nora Marsh"
  className?: string
  pin?: string
  unpin?: string
}) {
  const pinned = useIsPinned(refKind, refId)
  const { addCard, unpin: unpinItem, toast } = useGame.getState()
  return (
    <button
      className={`${className} ${pinned ? 'is-pinned' : ''}`}
      aria-pressed={pinned}
      title={pinned ? 'Take it off the evidence board' : 'Put it on the evidence board'}
      onClick={async () => {
        if (pinned) {
          await unpinItem(refKind, refId)
          return
        }
        const it = await addCard({ refKind, refId, x: 400 + Math.random() * 600, y: 300 + Math.random() * 400 })
        if (it) toast(`${name} pinned to the board`)
      }}
    >
      {pinned ? unpin : pin}
    </button>
  )
}
