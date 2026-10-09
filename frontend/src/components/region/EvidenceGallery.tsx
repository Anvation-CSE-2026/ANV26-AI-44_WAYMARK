import { useEffect, useRef, useState } from 'react'
import type { Evidence } from '../../lib/types.ops'
import { AuthedImage, GeoChip, StaleChip } from '../ops/bits'
import { fmtDate } from '../ops/util'

const KIND_LABEL = { before: 'Before', during: 'During', after: 'After' } as const

function Lightbox({ items, start, compare, onClose }: { items: Evidence[]; start: number; compare: boolean; onClose: () => void }) {
  const [i, setI] = useState(start)
  const closeRef = useRef<HTMLButtonElement>(null)
  const before = [...items].reverse().find((e) => e.kind === 'before')
  const after = [...items].reverse().find((e) => e.kind === 'after')
  useEffect(() => {
    closeRef.current?.focus()
  }, [])
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (!compare && e.key === 'ArrowRight') setI((n) => (n + 1) % items.length)
    else if (!compare && e.key === 'ArrowLeft') setI((n) => (n - 1 + items.length) % items.length)
  }
  const cur = items[i]
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={compare ? 'Compare before and after photos' : 'Photo viewer'}
      onKeyDown={onKey}
      className="fixed inset-0 z-[3000] flex flex-col bg-navy/95 p-3 text-ivory"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{compare ? 'Before and after' : `${KIND_LABEL[cur.kind]} photo ${i + 1} of ${items.length}`}</p>
        <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg border border-white/40 px-3 py-1.5 font-semibold hover:bg-white/10">
          Close ✕
        </button>
      </div>
      {compare ? (
        <div className="mt-3 grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-2">
          {([['Before', before], ['After', after]] as const).map(([label, ev]) => (
            <figure key={label} className="flex min-h-0 flex-col">
              <figcaption className="mb-1 font-semibold">{label}{ev?.caption ? ` · ${ev.caption}` : ''}</figcaption>
              {ev ? (
                <AuthedImage url={ev.file_url} alt={`${label} photo${ev.caption ? `: ${ev.caption}` : ''}`} className="max-h-[75vh] w-full flex-1 rounded-lg object-contain" />
              ) : (
                <p className="rounded-lg bg-white/10 p-6 text-center">No {label.toLowerCase()} photo yet.</p>
              )}
            </figure>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex min-h-0 flex-1 items-center justify-center gap-2">
          {items.length > 1 && (
            <button type="button" aria-label="Previous photo" onClick={() => setI((n) => (n - 1 + items.length) % items.length)} className="rounded-full border border-white/40 px-3 py-2 text-xl hover:bg-white/10">‹</button>
          )}
          <figure className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
            <AuthedImage url={cur.file_url} alt={`${KIND_LABEL[cur.kind]} photo${cur.caption ? `: ${cur.caption}` : ''}`} className="max-h-[75vh] max-w-full rounded-lg object-contain" />
            <figcaption className="mt-2 text-center text-sm">
              {cur.caption && <span className="block font-semibold">{cur.caption}</span>}
              {fmtDate(cur.created_at)} · uploaded by {cur.uploaded_by}
            </figcaption>
          </figure>
          {items.length > 1 && (
            <button type="button" aria-label="Next photo" onClick={() => setI((n) => (n + 1) % items.length)} className="rounded-full border border-white/40 px-3 py-2 text-xl hover:bg-white/10">›</button>
          )}
        </div>
      )}
    </div>
  )
}

/** Thumbnails grouped by kind, with location / old-photo chips, a lightbox and a before/after compare view. */
export function EvidenceGallery({ evidence }: { evidence: Evidence[] }) {
  const [view, setView] = useState<{ index: number; compare: boolean } | null>(null)
  const hasBoth = evidence.some((e) => e.kind === 'before') && evidence.some((e) => e.kind === 'after')
  if (evidence.length === 0) return <p className="text-navy/70">No photos yet.</p>
  return (
    <div className="space-y-3">
      {hasBoth && (
        <button type="button" onClick={() => setView({ index: 0, compare: true })} className="rounded-lg border border-navy/25 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-ivory-200">
          Compare before and after
        </button>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {evidence.map((e, i) => (
          <li key={e.id} className="space-y-1">
            <button
              type="button"
              onClick={() => setView({ index: i, compare: false })}
              aria-label={`Open ${KIND_LABEL[e.kind]} photo${e.caption ? `: ${e.caption}` : ''}`}
              className="block w-full overflow-hidden rounded-lg border border-navy/15"
            >
              <AuthedImage url={e.thumb_url} alt={`${KIND_LABEL[e.kind]} photo${e.caption ? `: ${e.caption}` : ''}`} className="aspect-[4/3] w-full object-cover" />
            </button>
            <p className="text-sm font-semibold">{KIND_LABEL[e.kind]}{e.caption ? <span className="font-normal text-navy/70"> · {e.caption}</span> : null}</p>
            <div className="flex flex-wrap gap-1">
              <GeoChip flag={e.geo_flag} />
              {e.stale_photo && <StaleChip />}
            </div>
          </li>
        ))}
      </ul>
      {view && <Lightbox items={evidence} start={view.index} compare={view.compare} onClose={() => setView(null)} />}
    </div>
  )
}
