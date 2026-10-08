// Every sound in the game is synthesized here with the Web Audio API: no audio
// files, nothing to download or license. Each voice schedules itself on any
// BaseAudioContext (live or offline) starting at time `t` and returns the time
// it finishes.

export interface Res {
  noise: AudioBuffer // white noise
  brown: AudioBuffer // low rumbling noise
}

export interface Bus {
  dry: AudioNode
  wet: AudioNode // send into the reverb
}

export type Voice = (ctx: BaseAudioContext, bus: Bus, t: number, res: Res) => number

const rand = (a: number, b: number) => a + Math.random() * (b - a)

// ---- buffers -----------------------------------------------------------------

export function noiseBuffer(ctx: BaseAudioContext, seconds = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}

export function brownBuffer(ctx: BaseAudioContext, seconds = 6): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  let peak = 0
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    d[i] = last
    peak = Math.max(peak, Math.abs(last))
  }
  // Normalize, and fade the ends together so the loop doesn't click.
  const fade = Math.floor(ctx.sampleRate * 0.05)
  for (let i = 0; i < len; i++) {
    let v = (d[i] / peak) * 0.9
    if (i < fade) v *= i / fade
    if (i > len - fade) v *= (len - i) / fade
    d[i] = v
  }
  return buf
}

/** A small, dark room: exponentially decaying stereo noise. */
export function impulse(ctx: BaseAudioContext, seconds = 2.4, decay = 3.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return buf
}

// ---- helpers -----------------------------------------------------------------

function g(ctx: BaseAudioContext, value = 1): GainNode {
  const n = ctx.createGain()
  n.gain.value = value
  return n
}

function filt(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  return f
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, t: number, stop: number): OscillatorNode {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  o.start(t)
  o.stop(stop)
  return o
}

/** Attack to `peak`, then an exponential decay. */
function env(p: AudioParam, t: number, peak: number, attack: number, decay: number) {
  p.setValueAtTime(0.0001, t)
  p.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack)
  p.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

function noise(ctx: BaseAudioContext, buf: AudioBuffer, t: number, dur: number): AudioBufferSourceNode {
  const s = ctx.createBufferSource()
  s.buffer = buf
  const room = Math.max(0, buf.duration - dur - 0.01)
  s.start(t, rand(0, room), dur)
  return s
}

function out(ctx: BaseAudioContext, bus: Bus, wet: number): GainNode {
  const o = g(ctx)
  o.connect(bus.dry)
  if (wet > 0) o.connect(g(ctx, wet)).connect(bus.wet)
  return o
}

/** A struck bell or chime: decaying sine partials. */
function bell(ctx: BaseAudioContext, bus: Bus, t: number, freqs: number[], amps: number[], decay: number, wet = 0.3) {
  const o = out(ctx, bus, wet)
  freqs.forEach((f, i) => {
    const gn = g(ctx, 0)
    env(gn.gain, t, amps[i], 0.002, decay / (1 + i * 0.6))
    osc(ctx, 'sine', f, t, t + decay + 0.1).connect(gn).connect(o)
  })
}

/** A felt-hammer piano note, a little out of tune, like one in a hotel bar. */
function piano(ctx: BaseAudioContext, bus: Bus, t: number, freq: number, vel: number, dur: number, wet = 0.35) {
  const o = out(ctx, bus, wet)
  const lp = filt(ctx, 'lowpass', Math.min(5000, freq * 7))
  lp.connect(o)
  const partials = [1, 0.5, 0.26, 0.13, 0.07, 0.03]
  partials.forEach((a, i) => {
    const n = i + 1
    const gn = g(ctx, 0)
    env(gn.gain, t, vel * a, 0.004, dur / Math.sqrt(n))
    osc(ctx, 'sine', freq * n * (1 + 0.0004 * n * n), t, t + dur + 0.1).connect(gn).connect(lp)
  })
}

// ---- sound effects -------------------------------------------------------------

/** A burst of typing and the carriage bell: new evidence. */
export const typewriter: Voice = (ctx, bus, t, res) => {
  let time = t
  const keys = 7 + Math.floor(Math.random() * 4)
  for (let i = 0; i < keys; i++) {
    const space = i > 0 && i % 5 === 0
    const bp = filt(ctx, 'bandpass', space ? rand(700, 950) : rand(2200, 3800), space ? 1.2 : 1.8)
    const gn = g(ctx, 0)
    env(gn.gain, time, space ? 0.35 : 0.5, 0.001, 0.035)
    noise(ctx, res.noise, time, 0.05).connect(bp).connect(gn).connect(bus.dry)
    const thunk = g(ctx, 0)
    env(thunk.gain, time, 0.2, 0.001, 0.05)
    osc(ctx, 'sine', rand(120, 170), time, time + 0.08).connect(thunk).connect(bus.dry)
    time += rand(0.055, 0.12)
  }
  const bt = time + 0.12
  bell(ctx, bus, bt, [2093, 4196, 6310], [0.14, 0.045, 0.015], 1.0, 0.25)
  return bt + 1.0
}

/** Paper being unfolded: opening a document. */
export const rustle: Voice = (ctx, bus, t, res) => {
  const dur = 0.9
  const hp = filt(ctx, 'highpass', 700)
  const bp = filt(ctx, 'bandpass', rand(2600, 3400), 0.6)
  const gn = g(ctx, 0)
  gn.gain.setValueAtTime(0.0001, t)
  let tt = t
  for (let i = 0; i < 5; i++) {
    tt += rand(0.03, 0.07)
    gn.gain.linearRampToValueAtTime(rand(0.16, 0.34), tt)
    tt += rand(0.02, 0.05)
    gn.gain.linearRampToValueAtTime(0.02, tt)
  }
  gn.gain.linearRampToValueAtTime(0.0001, tt + 0.05)
  noise(ctx, res.noise, t, dur).connect(hp).connect(bp).connect(gn).connect(bus.dry)
  return tt + 0.06
}

/** A car door, then an old V8 pulling away: travel. */
export const travel: Voice = (ctx, bus, t, res) => {
  // latch
  const cg = g(ctx, 0)
  env(cg.gain, t, 0.22, 0.001, 0.02)
  noise(ctx, res.noise, t, 0.03).connect(filt(ctx, 'bandpass', 3200, 2)).connect(cg).connect(bus.dry)
  // the door
  const thump = osc(ctx, 'sine', 115, t + 0.01, t + 0.45)
  thump.frequency.exponentialRampToValueAtTime(42, t + 0.2)
  const tg = g(ctx, 0)
  env(tg.gain, t + 0.01, 0.75, 0.004, 0.28)
  thump.connect(tg).connect(bus.dry)
  const ng = g(ctx, 0)
  env(ng.gain, t + 0.01, 0.3, 0.003, 0.1)
  noise(ctx, res.noise, t + 0.01, 0.14).connect(filt(ctx, 'lowpass', 500)).connect(ng).connect(bus.dry)
  // the engine
  const et = t + 0.45
  const lp = filt(ctx, 'lowpass', 240, 1.2)
  lp.frequency.setValueAtTime(240, et)
  lp.frequency.linearRampToValueAtTime(420, et + 1.6)
  const eg = g(ctx, 0)
  eg.gain.setValueAtTime(0.0001, et)
  eg.gain.linearRampToValueAtTime(0.14, et + 0.3)
  eg.gain.setValueAtTime(0.14, et + 1.0)
  eg.gain.exponentialRampToValueAtTime(0.0001, et + 2.0)
  lp.connect(eg).connect(bus.dry)
  for (const [mul, detune] of [[1, 0], [1.5, 7]] as const) {
    const e = osc(ctx, 'sawtooth', 34 * mul, et, et + 2.1)
    e.detune.value = detune
    e.frequency.linearRampToValueAtTime(30 * mul, et + 0.3)
    e.frequency.exponentialRampToValueAtTime(70 * mul, et + 1.7)
    e.connect(lp)
  }
  return et + 2.1
}

/** An old desk telephone's bell: the city directory. */
export const phone: Voice = (ctx, bus, t) => {
  const o = out(ctx, bus, 0.2)
  const gn = g(ctx, 0)
  gn.connect(o)
  const freqs = [1180, 1530, 2950]
  const amps = [0.11, 0.08, 0.025]
  const end = t + 1.3
  freqs.forEach((f, i) => osc(ctx, 'sine', f, t, end).connect(g(ctx, amps[i])).connect(gn))
  const strikes = 18
  const step = 0.047
  gn.gain.setValueAtTime(0.0001, t)
  for (let k = 0; k < strikes; k++) {
    const tk = t + k * step
    gn.gain.setValueAtTime(1, tk)
    gn.gain.exponentialRampToValueAtTime(0.15, tk + 0.04)
  }
  gn.gain.exponentialRampToValueAtTime(0.0001, t + strikes * step + 0.35)
  return end
}

/** A low minor chord on a bar piano: a new chapter. */
export const chapter: Voice = (ctx, bus, t) => {
  ;[110, 164.81, 261.63].forEach((f, i) => piano(ctx, bus, t + i * 0.05, f, 0.26, 5))
  piano(ctx, bus, t + 0.45, 659.25, 0.07, 3.5, 0.6)
  return t + 5.2
}

/** A rubber stamp hitting the desk: the report is filed. */
export const stamp: Voice = (ctx, bus, t, res) => {
  const o = osc(ctx, 'sine', 140, t, t + 0.3)
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12)
  const og = g(ctx, 0)
  env(og.gain, t, 0.85, 0.002, 0.2)
  o.connect(og).connect(bus.dry)
  const ng = g(ctx, 0)
  env(ng.gain, t, 0.45, 0.001, 0.07)
  noise(ctx, res.noise, t, 0.1).connect(filt(ctx, 'lowpass', 900)).connect(ng).connect(bus.dry)
  const kg = g(ctx, 0)
  env(kg.gain, t, 0.4, 0.001, 0.06)
  noise(ctx, res.noise, t, 0.08).connect(filt(ctx, 'bandpass', 650, 5)).connect(kg).connect(bus.dry)
  return t + 0.35
}

/** Case closed. */
export const solved: Voice = (ctx, bus, t) => {
  ;[261.63, 329.63, 392, 523.25].forEach((f, i) => piano(ctx, bus, t + i * 0.14, f, 0.2, 3))
  ;[130.81, 196, 329.63].forEach((f) => piano(ctx, bus, t + 0.62, f, 0.14, 5))
  return t + 5.6
}

/** The last report failed. */
export const failed: Voice = (ctx, bus, t) => {
  const drone = osc(ctx, 'sine', 65.41, t, t + 4.6)
  const dg = g(ctx, 0)
  dg.gain.setValueAtTime(0.0001, t)
  dg.gain.linearRampToValueAtTime(0.12, t + 0.8)
  dg.gain.exponentialRampToValueAtTime(0.0001, t + 4.5)
  drone.connect(dg).connect(out(ctx, bus, 0.3))
  ;[311.13, 293.66, 207.65].forEach((f, i) => piano(ctx, bus, t + i * 0.45, f, 0.17, 3.5))
  return t + 4.8
}

/** A report was wrong, but there are attempts left. */
export const wrong: Voice = (ctx, bus, t) => {
  piano(ctx, bus, t, 87.31, 0.26, 2.5)
  piano(ctx, bus, t + 0.35, 82.41, 0.26, 2.8)
  return t + 3.2
}

/** A teammate joined the agency. */
export const join: Voice = (ctx, bus, t) => {
  bell(ctx, bus, t, [880, 1320, 1760], [0.1, 0.05, 0.02], 1.6, 0.45)
  bell(ctx, bus, t + 0.16, [1320, 1980], [0.08, 0.03], 1.4, 0.45)
  return t + 1.8
}

/** A chat message from a teammate. */
export const chat: Voice = (ctx, bus, t) => {
  bell(ctx, bus, t, [1318.5, 1975.5], [0.06, 0.02], 0.4, 0.2)
  return t + 0.5
}

// ---- weather ---------------------------------------------------------------------

/** A single raindrop on something hard. */
export function drip(ctx: BaseAudioContext, bus: Bus, t: number, level = 1) {
  const f = rand(1400, 3200)
  const o = osc(ctx, 'sine', f, t, t + 0.08)
  o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.04)
  const gn = g(ctx, 0)
  env(gn.gain, t, 0.022 * level, 0.001, 0.05)
  o.connect(gn).connect(bus.dry)
}

/** A ship's horn out in the fog. */
export function foghorn(ctx: BaseAudioContext, bus: Bus, t: number, level = 1): number {
  const o = out(ctx, bus, 0.55)
  const lp = filt(ctx, 'lowpass', 360, 1.5)
  const gn = g(ctx, 0)
  lp.connect(gn).connect(o)
  ;[86, 86.7, 172.3].forEach((f, i) => {
    const x = osc(ctx, 'sawtooth', f, t, t + 4.6)
    x.frequency.setValueAtTime(f, t + 2.4)
    x.frequency.linearRampToValueAtTime(f * 0.94, t + 4.3)
    x.connect(g(ctx, i === 2 ? 0.3 : 1)).connect(lp)
  })
  const peak = 0.07 * level
  gn.gain.setValueAtTime(0.0001, t)
  gn.gain.linearRampToValueAtTime(peak, t + 0.7)
  gn.gain.setValueAtTime(peak, t + 2.4)
  gn.gain.exponentialRampToValueAtTime(0.0001, t + 4.4)
  return t + 4.5
}

// ---- ambience --------------------------------------------------------------------

/**
 * District tone -> [rain, harbor, lamp hum and traffic]. The hum is the sound of
 * working streetlights; where the lamps are dark ("poor"), it's gone.
 */
const TONES: Record<string, [number, number, number]> = {
  center: [0.8, 0.25, 1],
  none: [0.8, 0.2, 0.7],
  wealthy: [0.7, 0.15, 0.35],
  industrial: [0.8, 0.75, 0.45],
  poor: [1, 0.55, 0],
}

export function toneIsNearWater(tone: string) {
  return tone === 'poor' || tone === 'industrial'
}

export interface Ambience {
  setTone(tone: string, t: number, immediate?: boolean): void
  stop(t: number): void
}

export function ambience(ctx: BaseAudioContext, dest: AudioNode, res: Res): Ambience {
  const t0 = ctx.currentTime
  const sources: AudioScheduledSourceNode[] = []
  const loop = (buf: AudioBuffer) => {
    const s = ctx.createBufferSource()
    s.buffer = buf
    s.loop = true
    s.start(t0, rand(0, buf.duration))
    sources.push(s)
    return s
  }
  const lfo = (freq: number, depth: number, param: AudioParam) => {
    const o = ctx.createOscillator()
    o.frequency.value = freq
    o.connect(g(ctx, depth)).connect(param)
    o.start(t0)
    sources.push(o)
  }

  const rainG = g(ctx, 0)
  const harborG = g(ctx, 0)
  const cityG = g(ctx, 0)
  for (const n of [rainG, harborG, cityG]) n.connect(dest)

  // Rain: a body of filtered noise and a high hiss, swelling in gusts.
  const rainMod = g(ctx, 1)
  rainMod.connect(rainG)
  loop(res.noise).connect(filt(ctx, 'highpass', 500)).connect(filt(ctx, 'lowpass', 5200)).connect(g(ctx, 0.05)).connect(rainMod)
  loop(res.noise).connect(filt(ctx, 'bandpass', 4000, 0.4)).connect(g(ctx, 0.022)).connect(rainMod)
  lfo(0.061, 0.3, rainMod.gain)

  // Harbor: slow swells of low water against pilings.
  const harborMod = g(ctx, 1)
  harborMod.connect(harborG)
  loop(res.brown).connect(filt(ctx, 'lowpass', 260)).connect(g(ctx, 0.5)).connect(harborMod)
  lfo(0.085, 0.55, harborMod.gain)

  // City: the 120 Hz buzz of street lamps and distant traffic.
  for (const [f, a] of [[120, 0.012], [240, 0.004], [360, 0.0015]] as const) {
    const o = ctx.createOscillator()
    o.frequency.value = f
    o.connect(g(ctx, a)).connect(cityG)
    o.start(t0)
    sources.push(o)
  }
  loop(res.brown).connect(filt(ctx, 'bandpass', 180, 0.5)).connect(g(ctx, 0.25)).connect(cityG)

  return {
    setTone(tone, t, immediate = false) {
      const [r, h, c] = TONES[tone] ?? TONES.center
      const tc = immediate ? 0.05 : 1.5
      rainG.gain.setTargetAtTime(r, t, tc)
      harborG.gain.setTargetAtTime(h, t, tc)
      cityG.gain.setTargetAtTime(c, t, tc)
    },
    stop(t) {
      for (const n of [rainG, harborG, cityG]) n.gain.setTargetAtTime(0, t, 0.4)
      for (const s of sources) s.stop(t + 2.5)
    },
  }
}
