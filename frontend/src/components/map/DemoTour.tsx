import type { CellDetail } from '../../lib/api'
import { DEMO_CELLS } from '../../lib/demo'
import { fmtInt } from '../../lib/format'
import { Card, Skeleton } from '../ui'

const GUIDE = [
  'Start with the headline and the confidence badge.',
  'Now read the factor chart: red bars push the score up, teal bars push it down.',
  'Finally, switch on Night, Rain or Low visibility to run a scenario simulation.',
]

interface Props {
  step: number
  detail: CellDetail | null
  loading: boolean
  error: string | null
  onPrev: () => void
  onNext: () => void
  onExit: () => void
}

export function DemoTour({ step, detail, loading, error, onPrev, onNext, onExit }: Props) {
  const last = step === DEMO_CELLS.length - 1
  const lines: string[] = []
  if (detail) {
    lines.push(`${fmtInt(detail.n_past_crashes)} past crashes are recorded in this cell.`)
    if (detail.history_percentile !== null) {
      lines.push(`The model scores it above ${Math.round(detail.history_percentile)}% of cells with similar history.`)
    }
    lines.push(
      detail.emerging_risk
        ? `Confidence is ${detail.confidence}. Elevated risk, recommend a site audit.`
        : `Confidence is ${detail.confidence}. This cell is not flagged as emerging risk.`,
    )
  }
  return (
    <Card className="border-brass/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brass-700">
          Guided demo · Step {step + 1} of {DEMO_CELLS.length}
        </p>
        <button
          type="button"
          onClick={onExit}
          className="rounded-lg border border-navy/25 px-2.5 py-1 text-sm font-semibold hover:bg-ivory-200"
        >
          Exit (Esc)
        </button>
      </div>
      <p className="mt-1 font-mono text-sm text-navy/70">{DEMO_CELLS[step]}</p>
      <div className="mt-2 min-h-[4.5rem]" aria-live="polite">
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        )}
        {error && <p className="font-medium text-brick">{error}</p>}
        {detail && (
          <p className="leading-relaxed">
            {lines.join(' ')} <span className="font-semibold">{GUIDE[step]}</span>
          </p>
        )}
      </div>
      <div className="mt-3 flex justify-between gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={step === 0}
          className="rounded-lg border border-navy/25 px-3 py-1.5 font-semibold hover:bg-ivory-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={last ? onExit : onNext}
          className="rounded-lg bg-navy px-4 py-1.5 font-semibold text-ivory hover:bg-navy-800"
        >
          {last ? 'Finish' : 'Next →'}
        </button>
      </div>
    </Card>
  )
}
