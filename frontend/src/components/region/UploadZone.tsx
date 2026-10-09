import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { ApiError } from '../../lib/api'
import { opsApi } from '../../lib/opsApi'
import type { EvidenceKind } from '../../lib/types.ops'
import { downscaleIfLarge } from '../../lib/image'

type ItemState = 'queued' | 'uploading' | 'done' | 'error'
interface Item {
  id: number
  file: File
  state: ItemState
  pct: number
  error?: string
}

const KINDS: { id: EvidenceKind; label: string }[] = [
  { id: 'before', label: 'Before' },
  { id: 'during', label: 'During' },
  { id: 'after', label: 'After' },
]

/** Drag-drop, camera and multi-file photo upload with progress and per-file retry. */
export function UploadZone({
  measureId,
  suggestKind,
  onUploaded,
}: {
  measureId: number
  /** The kind to preselect (the first required kind that has no photo yet). */
  suggestKind: EvidenceKind
  onUploaded: () => void
}) {
  const [kind, setKind] = useState<EvidenceKind>(suggestKind)
  const [caption, setCaption] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const [running, setRunning] = useState(false)
  const next = useRef(0)

  const add = (files: FileList | File[] | null) => {
    if (!files) return
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    setItems((all) => [...all, ...picked.map((file) => ({ id: ++next.current, file, state: 'queued' as const, pct: 0 }))])
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    add(e.dataTransfer.files)
  }

  const update = (id: number, patch: Partial<Item>) => setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)))

  const uploadAll = async () => {
    setRunning(true)
    let anyDone = false
    for (const it of items) {
      if (it.state !== 'queued' && it.state !== 'error') continue
      update(it.id, { state: 'uploading', pct: 0, error: undefined })
      try {
        const blob = await downscaleIfLarge(it.file)
        await opsApi.uploadEvidence(measureId, blob, it.file.name, kind, caption, (pct) => update(it.id, { pct }))
        update(it.id, { state: 'done', pct: 100 })
        anyDone = true
      } catch (e) {
        update(it.id, { state: 'error', error: e instanceof ApiError ? e.message : 'The upload failed. Try again.' })
      }
    }
    setRunning(false)
    if (anyDone) {
      setCaption('')
      onUploaded()
    }
  }

  const pending = items.filter((i) => i.state === 'queued' || i.state === 'error').length

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <fieldset>
          <legend className="text-sm font-semibold">Photo type</legend>
          <div className="mt-1 flex gap-1 rounded-lg bg-navy/5 p-1">
            {KINDS.map((k) => (
              <label key={k.id} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-brass ${kind === k.id ? 'bg-navy text-ivory' : 'hover:bg-navy/10'}`}>
                <input type="radio" name={`kind-${measureId}`} value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} className="sr-only" />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-semibold">
          Caption (optional)
          <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} className="mt-1 w-full rounded-lg border border-navy/25 px-3 py-2 font-normal" />
        </label>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-[12px] border-2 border-dashed p-4 text-center ${dragging ? 'border-brass bg-brass/10' : 'border-navy/25 bg-ivory-200/50'}`}
      >
        <p className="font-semibold">Drop photos here</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <label className="cursor-pointer rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-ivory focus-within:outline focus-within:outline-[3px] focus-within:outline-brass hover:bg-navy-800">
            Take a photo
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
          </label>
          <label className="cursor-pointer rounded-lg border border-navy/30 bg-white px-3 py-2 text-sm font-semibold focus-within:outline focus-within:outline-[3px] focus-within:outline-brass hover:bg-ivory-200">
            Choose photos
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
          </label>
        </div>
        <p className="mt-2 text-xs text-navy/65">JPEG, PNG or WebP. Photos with location data let the system check where they were taken. Uploading never changes the adjusted risk; only a verified measure does.</p>
      </div>

      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Photos to upload">
          {items.map((it) => (
            <li key={it.id} className="rounded-lg border border-navy/15 bg-white px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{it.file.name}</span>
                <span className="text-sm text-navy/70">
                  {it.state === 'queued' && 'Ready'}
                  {it.state === 'uploading' && `Uploading ${it.pct}%`}
                  {it.state === 'done' && '✓ Uploaded'}
                  {it.state === 'error' && '✕ Failed'}
                </span>
                {(it.state === 'queued' || it.state === 'error') && !running && (
                  <button type="button" onClick={() => setItems((all) => all.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.file.name}`} className="rounded px-2 text-navy/60 hover:bg-navy/10">✕</button>
                )}
              </div>
              {it.state === 'uploading' && (
                <div role="progressbar" aria-label={`Uploading ${it.file.name}`} aria-valuenow={it.pct} aria-valuemin={0} aria-valuemax={100} className="mt-1 h-2 overflow-hidden rounded-full bg-navy/10">
                  <div className="h-full bg-teal" style={{ width: `${it.pct}%` }} />
                </div>
              )}
              {it.error && <p role="alert" className="mt-1 text-sm font-semibold text-brick">{it.error}</p>}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={running || pending === 0} onClick={() => void uploadAll()} className="rounded-lg bg-brass px-4 py-2 font-semibold text-navy hover:brightness-95 disabled:opacity-50">
            {running ? 'Uploading…' : items.some((i) => i.state === 'error') ? 'Retry failed uploads' : `Upload ${pending} photo${pending === 1 ? '' : 's'} as "${kind}"`}
          </button>
          {!running && items.every((i) => i.state === 'done') && (
            <button type="button" onClick={() => setItems([])} className="rounded-lg border border-navy/25 px-4 py-2 font-semibold hover:bg-ivory-200">Clear list</button>
          )}
        </div>
      )}
    </div>
  )
}
