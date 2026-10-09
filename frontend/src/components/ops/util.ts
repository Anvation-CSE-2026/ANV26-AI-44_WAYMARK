import { useEffect, useState } from 'react'
import { opsApi } from '../../lib/opsApi'
import type { EffectsOut, MeasureStatus } from '../../lib/types.ops'

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export const STATUS_META: Record<MeasureStatus, { label: string; icon: string; chip: string }> = {
  planned: { label: 'Planned', icon: '○', chip: 'border-navy/30 bg-navy/5 text-navy' },
  in_progress: { label: 'In progress', icon: '◐', chip: 'border-amber/60 bg-amber/15 text-[#8A5410]' },
  evidence_submitted: { label: 'Evidence submitted', icon: '◕', chip: 'border-teal/50 bg-teal/15 text-teal' },
  verified: { label: 'Verified', icon: '●', chip: 'border-teal bg-teal text-white' },
  cancelled: { label: 'Cancelled', icon: '✕', chip: 'border-brick/40 bg-brick/10 text-brick' },
}

export const STATUS_ORDER: MeasureStatus[] = ['planned', 'in_progress', 'evidence_submitted', 'verified']

/** Measure categories and weights (read once per screen). */
export function useEffects(): EffectsOut | null {
  const [fx, setFx] = useState<EffectsOut | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    opsApi
      .effects(ctrl.signal)
      .then(setFx)
      .catch(() => undefined) // the screens work without it; labels fall back to the category id
    return () => ctrl.abort()
  }, [])
  return fx
}

export const categoryLabel = (fx: EffectsOut | null, id: string): string =>
  fx?.categories.find((c) => c.id === id)?.label ?? id.replace(/_/g, ' ')
