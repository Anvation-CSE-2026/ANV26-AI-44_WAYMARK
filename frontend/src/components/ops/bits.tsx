import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { opsApi } from '../../lib/opsApi'
import type { GeoFlag } from '../../lib/types.ops'

export function PlaceholderNotice({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <p role="note" className="rounded-lg border border-amber/60 bg-amber/10 px-3 py-2 text-sm text-[#6b4210]">
      <strong>Placeholder weights.</strong> The effect weights behind the adjusted risk estimate are placeholders until a
      domain owner replaces them in <code>backend/config/effects.json</code>. Treat the adjusted numbers as illustrative.
    </p>
  )
}

export function EstimateNote() {
  return (
    <p className="text-sm text-navy/70">
      The adjusted index is an overlay estimate, not a re-run of the risk model. Credit comes only from verified
      measures.
    </p>
  )
}

const GEO: Record<GeoFlag, { icon: string; text: string; cls: string }> = {
  ok: { icon: '✓', text: 'Location matches the cells', cls: 'border-teal/50 bg-teal/10 text-teal' },
  far: { icon: '!', text: 'Taken far from the cells', cls: 'border-amber/60 bg-amber/15 text-[#8A5410]' },
  missing: { icon: '–', text: 'No location in photo', cls: 'border-navy/25 bg-navy/5 text-navy/80' },
}

export function GeoChip({ flag }: { flag: GeoFlag }) {
  const g = GEO[flag]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${g.cls}`}>
      <span aria-hidden="true">{g.icon}</span>
      {g.text}
    </span>
  )
}

export function StaleChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber/60 bg-amber/15 px-2 py-0.5 text-xs font-semibold text-[#8A5410]">
      <span aria-hidden="true">⏱</span>Old photo
    </span>
  )
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="font-serif text-xl font-bold">
      {children}
    </h3>
  )
}

/** A photo behind authentication: fetch with the token, show through an object URL. */
export function AuthedImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const ctrl = new AbortController()
    let made: string | null = null
    opsApi
      .evidenceImage(url, ctrl.signal)
      .then((b) => {
        made = URL.createObjectURL(b)
        setSrc(made)
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException)) setFailed(true)
      })
    return () => {
      ctrl.abort()
      if (made) URL.revokeObjectURL(made)
    }
  }, [url])
  if (failed) return <div className={`flex items-center justify-center bg-navy/10 text-sm text-navy/60 ${className ?? ''}`}>Photo unavailable</div>
  if (!src) return <div aria-hidden="true" className={`animate-pulse bg-navy/10 ${className ?? ''}`} />
  return <img src={src} alt={alt} className={className} />
}
