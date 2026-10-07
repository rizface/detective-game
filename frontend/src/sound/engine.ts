import * as V from './voices'

export type SoundName =
  | 'typewriter' | 'rustle' | 'travel' | 'phone' | 'chapter' | 'stamp'
  | 'solved' | 'failed' | 'wrong' | 'join' | 'chat'

const VOICES: Record<SoundName, V.Voice> = {
  typewriter: V.typewriter,
  rustle: V.rustle,
  travel: V.travel,
  phone: V.phone,
  chapter: V.chapter,
  stamp: V.stamp,
  solved: V.solved,
  failed: V.failed,
  wrong: V.wrong,
  join: V.join,
  chat: V.chat,
}

export interface SoundSettings {
  enabled: boolean
  volume: number // 0..1
  ambience: boolean
}

const KEY = 'nightshift.sound'
const DEFAULTS: SoundSettings = { enabled: false, volume: 0.7, ambience: true }

function load(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/**
 * The sound engine. Sound starts off; each player turns it on for themselves
 * and the choice is remembered in their browser. Browsers only allow audio
 * after the person has interacted with the page, so the audio graph is built
 * lazily on the first click or key press once sound is enabled.
 */
class SoundEngine {
  private settings: SoundSettings = load()
  private listeners = new Set<() => void>()
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfx!: GainNode
  private ambBus!: GainNode
  private wet!: GainNode
  private res!: V.Res
  private amb: V.Ambience | null = null
  private tone = 'center'
  private inGame = false
  private hidden = false
  private timers: number[] = []
  private lastPlayed = new Map<string, number>()
  private suspendTimer: number | undefined
  /** Recently requested sounds, newest last (for debugging). */
  recent: string[] = []

  constructor() {
    if (typeof window === 'undefined') return
    const unlock = () => {
      if (this.settings.enabled) this.unlock()
    }
    window.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', unlock, { capture: true })
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      this.apply()
    })
  }

  // --- settings (shaped for useSyncExternalStore) ---

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getSettings = () => this.settings

  private update(patch: Partial<SoundSettings>) {
    this.settings = { ...this.settings, ...patch }
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings))
    } catch {
      /* storage unavailable */
    }
    this.listeners.forEach((f) => f())
    this.apply()
  }

  setEnabled(on: boolean) {
    this.update({ enabled: on })
    if (on) {
      this.unlock()
      // A soft confirmation so people know it's working.
      window.setTimeout(() => this.play('chat'), 120)
    }
  }

  setVolume(volume: number) {
    this.update({ volume: Math.min(1, Math.max(0, volume)) })
  }

  setAmbience(on: boolean) {
    this.update({ ambience: on })
  }

  // --- game context ---

  /** Ambience only plays on the game screen. */
  setInGame(on: boolean) {
    this.inGame = on
    this.apply()
  }

  /** The tone of the district the team is in (see voices.ts TONES). */
  setTone(tone: string) {
    if (tone === this.tone) return
    this.tone = tone
    if (this.amb && this.ctx) this.amb.setTone(tone, this.ctx.currentTime)
  }

  // --- playback ---

  play(name: SoundName, delay = 0) {
    const ctx = this.ctx
    const live = !!ctx && this.settings.enabled && ctx.state === 'running'
    this.recent.push(live ? name : `${name} (muted)`)
    if (this.recent.length > 40) this.recent.shift()
    if (!live) return
    // Don't stack the same sound when several updates arrive at once.
    const now = performance.now()
    if (now - (this.lastPlayed.get(name) ?? -1e9) < 250) return
    this.lastPlayed.set(name, now)
    VOICES[name](ctx!, { dry: this.sfx, wet: this.wet }, ctx!.currentTime + 0.03 + delay, this.res)
  }

  // --- internals ---

  private unlock() {
    if (!this.ctx && !this.build()) return
    if (this.ctx!.state === 'suspended') void this.ctx!.resume().then(() => this.apply())
    this.apply()
  }

  private build(): boolean {
    const Ctor: typeof AudioContext | undefined = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctor) return false
    const ctx = new Ctor({ latencyHint: 'interactive' })
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -8
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    limiter.connect(ctx.destination)
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(limiter)
    this.sfx = ctx.createGain()
    this.sfx.connect(this.master)
    this.ambBus = ctx.createGain()
    this.ambBus.gain.value = 0
    this.ambBus.connect(this.master)
    const reverb = ctx.createConvolver()
    reverb.buffer = V.impulse(ctx)
    this.wet = ctx.createGain()
    this.wet.connect(reverb).connect(this.master)
    this.res = { noise: V.noiseBuffer(ctx), brown: V.brownBuffer(ctx) }
    this.ctx = ctx
    return true
  }

  private apply() {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const on = this.settings.enabled
    this.master.gain.setTargetAtTime(on ? this.settings.volume : 0, t, 0.08)

    const wantAmb = on && this.settings.ambience && this.inGame
    if (wantAmb && !this.amb) {
      this.amb = V.ambience(ctx, this.ambBus, this.res)
      this.amb.setTone(this.tone, t, true)
      this.startWeather()
    } else if (!wantAmb && this.amb) {
      this.amb.stop(t)
      this.amb = null
      this.stopWeather()
    }
    // Background sits well under the effects.
    this.ambBus.gain.setTargetAtTime(wantAmb && !this.hidden ? 0.5 : 0, t, 0.6)

    // Stop burning CPU while muted.
    window.clearTimeout(this.suspendTimer)
    if (!on && ctx.state === 'running') {
      this.suspendTimer = window.setTimeout(() => {
        if (!this.settings.enabled) void ctx.suspend()
      }, 600)
    } else if (on && ctx.state === 'suspended') {
      void ctx.resume()
    }
  }

  private startWeather() {
    const bus = () => ({ dry: this.ambBus, wet: this.wet })
    const drip = () => {
      if (!this.amb || !this.ctx) return
      if (!this.hidden) V.drip(this.ctx, bus(), this.ctx.currentTime + 0.01, rand(0.4, 1))
      this.timers.push(window.setTimeout(drip, rand(90, 650)))
    }
    const horn = () => {
      if (!this.amb || !this.ctx) return
      const near = V.toneIsNearWater(this.tone)
      if (!this.hidden) V.foghorn(this.ctx, bus(), this.ctx.currentTime + 0.05, near ? 1 : 0.4)
      this.timers.push(window.setTimeout(horn, near ? rand(40e3, 90e3) : rand(90e3, 180e3)))
    }
    this.timers.push(window.setTimeout(drip, 400))
    this.timers.push(window.setTimeout(horn, rand(8e3, 20e3)))
  }

  private stopWeather() {
    this.timers.forEach((id) => window.clearTimeout(id))
    this.timers = []
  }
}

export const sound = new SoundEngine()

// Debugging hook: inspect `recent`, or render every sound to a buffer.
if (typeof window !== 'undefined') {
  ;(window as any).__nightShiftSound = {
    engine: sound,
    renderDemo: () => import('./demo').then((m) => m.renderDemo()),
  }
}
