import { useMemo } from 'react'

// A procedurally drawn fragment of a city street plan with sodium lamps,
// used as quiet background art outside the game.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

export default function StreetGlow({ seed = 7, className }: { seed?: number; className?: string }) {
  const { streets, lamps } = useMemo(() => {
    const r = rng(seed)
    const streets: string[] = []
    const lamps: [number, number][] = []
    const W = 1200
    const H = 800
    // A slightly skewed grid, like an old port city laid out against the shore.
    for (let i = 0; i < 14; i++) {
      const y = 40 + i * 58 + r() * 14
      const tilt = (r() - 0.5) * 60
      streets.push(`M -20 ${y} L ${W + 20} ${y + tilt}`)
      for (let k = 0; k < 6; k++) {
        if (r() < 0.55) {
          const x = r() * W
          lamps.push([x, y + (tilt * x) / W])
        }
      }
    }
    for (let i = 0; i < 18; i++) {
      const x = 30 + i * 70 + r() * 20
      const lean = (r() - 0.5) * 120
      streets.push(`M ${x} -20 L ${x + lean} ${H + 20}`)
    }
    streets.push(`M -20 ${H * 0.62} C ${W * 0.3} ${H * 0.5}, ${W * 0.6} ${H * 0.8}, ${W + 20} ${H * 0.66}`)
    return { streets, lamps }
  }, [seed])

  return (
    <svg className={className} viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="sg-lamp">
          <stop offset="0" stopColor="#f0a03c" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f0a03c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g stroke="#2a4955" strokeWidth="1.2" fill="none">
        {streets.map((d, i) => (
          <path key={i} d={d} strokeWidth={i === streets.length - 1 ? 9 : i % 5 === 0 ? 3 : 1.2} />
        ))}
      </g>
      {lamps.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={34} fill="url(#sg-lamp)" />
          <circle cx={x} cy={y} r={2.2} fill="#f6c27a" />
        </g>
      ))}
    </svg>
  )
}
