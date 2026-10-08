import * as V from './voices'

/**
 * Renders the ambience in three districts and then every sound effect into
 * one mono buffer, offline, for listening and level checks. Loaded only on
 * demand (window.__nightShiftSound.renderDemo()).
 */
export async function renderDemo(sampleRate = 22050) {
  const seconds = 75
  const ctx = new OfflineAudioContext(1, sampleRate * seconds, sampleRate)
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -8
  limiter.knee.value = 6
  limiter.ratio.value = 12
  limiter.connect(ctx.destination)
  const master = ctx.createGain()
  master.gain.value = 0.7
  master.connect(limiter)
  const reverb = ctx.createConvolver()
  reverb.buffer = V.impulse(ctx)
  const wet = ctx.createGain()
  wet.connect(reverb).connect(master)
  const ambBus = ctx.createGain()
  ambBus.gain.value = 0.5
  ambBus.connect(master)
  const res = { noise: V.noiseBuffer(ctx), brown: V.brownBuffer(ctx) }
  const bus = { dry: master, wet }

  const segments: { name: string; start: number; end: number }[] = []
  let t = 0.3

  const amb = V.ambience(ctx, ambBus, res)
  for (const tone of ['center', 'poor', 'industrial']) {
    const start = t
    amb.setTone(tone, t, true)
    for (let d = t + 0.2; d < t + 6; d += 0.25 + Math.random() * 0.4) V.drip(ctx, { dry: ambBus, wet }, d, 0.8)
    if (tone === 'industrial') V.foghorn(ctx, { dry: ambBus, wet }, t + 0.8)
    t += 6
    segments.push({ name: `ambience:${tone}`, start, end: t })
  }
  amb.stop(t)
  t += 1.5

  const sfx: [string, V.Voice][] = [
    ['travel', V.travel], ['rustle', V.rustle], ['typewriter', V.typewriter], ['phone', V.phone],
    ['chapter', V.chapter], ['chat', V.chat], ['join', V.join], ['stamp', V.stamp], ['wrong', V.wrong],
    ['stamp', V.stamp], ['solved', V.solved], ['failed', V.failed],
  ]
  for (const [name, voice] of sfx) {
    const start = t
    const end = voice(ctx, bus, t, res)
    segments.push({ name, start, end })
    t = end + 0.7
  }

  const rendered = await ctx.startRendering()
  const data = rendered.getChannelData(0).subarray(0, Math.ceil(t * sampleRate))
  const pcm = new Int16Array(data.length)
  let clipped = 0
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (Math.abs(v) >= 1) clipped++
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
  }
  let bin = ''
  const bytes = new Uint8Array(pcm.buffer)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { sampleRate, segments, clipped, pcm16: btoa(bin) }
}
