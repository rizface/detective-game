import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { sound } from './engine'
import './sound.css'

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none" />
      {on ? (
        <>
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19.5 5.5a9 9 0 0 1 0 13" />
        </>
      ) : (
        <>
          <path d="M17 9l5 6" />
          <path d="M22 9l-5 6" />
        </>
      )}
    </svg>
  )
}

export default function SoundControl() {
  const s = useSyncExternalStore(sound.subscribe, sound.getSettings)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="sound" ref={wrap}>
      <button
        className={`btn small ghost sound-btn ${s.enabled ? 'on' : ''}`}
        aria-label={s.enabled ? 'Sound settings (sound on)' : 'Sound settings (sound off)'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <SpeakerIcon on={s.enabled} />
      </button>
      {open && (
        <div className="sound-pop" role="dialog" aria-label="Sound">
          <label className="sound-row">
            <span>Sound</span>
            <input type="checkbox" className="toggle" checked={s.enabled} onChange={(e) => sound.setEnabled(e.target.checked)} />
          </label>
          <label className="sound-field">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.volume}
              disabled={!s.enabled}
              onChange={(e) => sound.setVolume(Number(e.target.value))}
            />
          </label>
          <label className="check sound-check">
            <input type="checkbox" checked={s.ambience} disabled={!s.enabled} onChange={(e) => sound.setAmbience(e.target.checked)} />
            Rain and harbor in the background
          </label>
          <p className="muted small">Only you hear your settings. They're saved in this browser.</p>
        </div>
      )}
    </div>
  )
}
