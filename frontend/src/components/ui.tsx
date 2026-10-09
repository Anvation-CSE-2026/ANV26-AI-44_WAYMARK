import type { ReactNode } from 'react'
import type { CheckStatus, Confidence } from '../lib/api'
import { LogoMark } from './Logo'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[12px] border border-navy/10 bg-white shadow-card ${className}`}>{children}</div>
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-8">
      {eyebrow && <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-brass-700">{eyebrow}</p>}
      <h1 className="text-4xl font-bold leading-tight text-navy md:text-5xl">{title}</h1>
      {children && <div className="mt-3 max-w-3xl text-lg leading-relaxed text-navy/80">{children}</div>}
    </header>
  )
}

export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 py-10 md:py-14 ${className}`}>{children}</div>
}

const confidenceStyles: Record<Confidence, string> = {
  High: 'bg-teal/15 text-teal border-teal/40',
  Medium: 'bg-navy/10 text-navy border-navy/30',
  Low: 'bg-amber/15 text-[#8A5410] border-amber/50',
}

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold ${confidenceStyles[value]}`}
    >
      {value} confidence
    </span>
  )
}

const statusStyles: Record<CheckStatus, { cls: string; icon: string; label: string }> = {
  PASS: { cls: 'bg-teal/15 text-teal border-teal/40', icon: '✓', label: 'Pass' },
  WARN: { cls: 'bg-amber/15 text-[#8A5410] border-amber/60', icon: '!', label: 'Warning' },
  FAIL: { cls: 'bg-brick/10 text-brick border-brick/50', icon: '✕', label: 'Fail' },
}

export function StatusBadge({ status }: { status: CheckStatus }) {
  const s = statusStyles[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-bold ${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span>
      <span>{status}</span>
      <span className="sr-only"> ({s.label})</span>
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-navy/10 ${className}`} />
}

export function SkeletonBlock({ lines = 4 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-5 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[12px] border border-brick/40 bg-brick/10 px-4 py-3 text-brick">
      <span aria-hidden="true" className="text-lg font-bold">
        !
      </span>
      <p className="flex-1 font-medium">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-brick/50 bg-white px-3 py-1.5 text-sm font-semibold text-brick hover:bg-brick/10"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-navy/25 bg-ivory-200/60 px-6 py-10 text-center">
      <LogoMark size={36} className="mx-auto mb-3 opacity-60" />
      <p className="font-serif text-xl font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-navy/75">{children}</div>}
    </div>
  )
}

export function LogoLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3">
      <LogoMark size={56} className="animate-pulse" />
      <p className="font-serif text-lg font-semibold tracking-wide">{label}…</p>
    </div>
  )
}
