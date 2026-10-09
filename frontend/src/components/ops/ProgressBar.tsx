import { motion, useReducedMotion } from 'framer-motion'
import type { MeasureStatus } from '../../lib/types.ops'
import { STATUS_META } from './util'

/** Status shown by an icon and words, never by colour alone. */
export function StatusChip({ status }: { status: MeasureStatus }) {
  const m = STATUS_META[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${m.chip}`}>
      <span aria-hidden="true">{m.icon}</span>
      {m.label}
    </span>
  )
}

interface Props {
  label: string
  /** 0-100 */
  value: number
  /** Optional help text under the bar. */
  hint?: string
  /** `segmented` draws one segment per measure, filled in by how far it has got. */
  variant?: 'solid' | 'segmented'
  segments?: { id: number; title: string; fill: number }[]
}

/** Accessible progress bar: role="progressbar", a text alternative, and animation off under reduced motion. */
export function ProgressBar({ label, value, hint, variant = 'solid', segments = [] }: Props) {
  const reduce = useReducedMotion()
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const text = `${label} ${pct}%`
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold" id={`pb-${label.replace(/\W+/g, '-')}`}>
          {label}
        </span>
        <span className="font-serif text-xl font-bold" aria-hidden="true">
          {pct}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={text}
        aria-valuetext={text}
        className="mt-1.5 h-4 overflow-hidden rounded-full bg-navy/10"
      >
        {variant === 'segmented' && segments.length > 0 ? (
          <div className="flex h-full gap-0.5">
            {segments.map((s) => (
              <div key={s.id} title={s.title} className="relative h-full flex-1 overflow-hidden bg-navy/10">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-teal"
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${Math.round(s.fill * 100)}%` }}
                  transition={reduce ? { duration: 0 } : { duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            ))}
          </div>
        ) : (
          <motion.div
            className="h-full rounded-full bg-teal"
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={reduce ? { duration: 0 } : { duration: 0.6, ease: 'easeOut' }}
          />
        )}
      </div>
      {hint && <p className="mt-1 text-sm text-navy/70">{hint}</p>}
    </div>
  )
}
