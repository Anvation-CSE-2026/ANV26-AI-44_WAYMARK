/** Colour ramps for the hexagon map. Green = lower, yellow = middle, red = higher. */
export type Stop = readonly [number, string]

/** Risk score (0-1) or history percentile (0-1): green, light green, yellow, orange, red. */
export const SCORE_STOPS: readonly Stop[] = [
  [0, '#3E9B57'],
  [0.3, '#A3C644'],
  [0.55, '#E8C547'],
  [0.78, '#E08A2B'],
  [1, '#C73A2B'],
]

/** Scenario change (-1 to 1): teal = lower, grey = about the same, yellow to brick = higher. */
export const DELTA_STOPS: readonly Stop[] = [
  [-1, '#2A7F8E'],
  [-0.08, '#86B6BE'],
  [0, '#CBD2DC'],
  [0.4, '#E8C547'],
  [0.7, '#D98A2B'],
  [1, '#B3412F'],
]

export const NO_DATA_COLOR = '#8A93A6'

const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]

export function rampColor(stops: readonly Stop[], t: number): string {
  const lo = stops[0][0]
  const hi = stops[stops.length - 1][0]
  const x = Math.min(hi, Math.max(lo, t))
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i]
    if (x <= x1) {
      const [x0, c0] = stops[i - 1]
      const f = x1 === x0 ? 0 : (x - x0) / (x1 - x0)
      const a = hex(c0)
      const b = hex(c1)
      const m = a.map((v, k) => Math.round(v + (b[k] - v) * f))
      return `rgb(${m[0]},${m[1]},${m[2]})`
    }
  }
  return stops[stops.length - 1][1]
}

export function gradientCss(stops: readonly Stop[]): string {
  const lo = stops[0][0]
  const hi = stops[stops.length - 1][0]
  const parts = stops.map(([x, c]) => `${c} ${(((x - lo) / (hi - lo)) * 100).toFixed(0)}%`)
  return `linear-gradient(to right, ${parts.join(', ')})`
}
