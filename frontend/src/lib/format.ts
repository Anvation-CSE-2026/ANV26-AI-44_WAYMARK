export const fmtInt = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US')

export const fmtNum = (v: number | null | undefined, digits = 3): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits)

/** Probability (0-1) as a percentage string. */
export const fmtProb = (p: number | null | undefined): string => {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—'
  return `${(p * 100).toFixed(p < 0.1 ? 2 : 1)}%`
}

/** Difference of two probabilities as signed percentage points. */
export const fmtPts = (delta: number | null | undefined): string => {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return '—'
  return `${delta >= 0 ? '+' : '−'}${Math.abs(delta * 100).toFixed(2)} pts`
}

export const prettyFeature = (f: string): string => f.replace(/_/g, ' ')

export const prettyModelFeature = (f: string): string => ({
  n_acc: 'Past crashes in this cell',
  n_recent: 'Recent crashes (last 2 years)',
  mean_sev: 'Average crash severity',
  share_night: 'Share of crashes at night',
  share_rain: 'Share of crashes in rain',
  mean_vis: 'Average visibility (miles)',
  nb_acc: 'Crashes in neighbouring cells',
  Junction: 'Junction nearby',
  Crossing: 'Pedestrian crossing nearby',
  Traffic_Signal: 'Traffic signal nearby',
  Stop: 'Stop sign nearby',
  Give_Way: 'Give-way sign nearby',
  Railway: 'Railway crossing nearby',
  Roundabout: 'Roundabout nearby',
  Bump: 'Speed bump nearby',
  Traffic_Calming: 'Traffic-calming feature nearby',
  Station: 'Station nearby',
  Amenity: 'Amenity nearby',
}[f] ?? prettyFeature(f))

export const MAP_PALETTE = {
  navy: '#12203B',
  brass: '#B8893B',
  teal: '#2A7F8E',
  amber: '#D98A2B',
  brick: '#B3412F',
  sun: '#E8C547',
  slate: '#8A93A6',
} as const
