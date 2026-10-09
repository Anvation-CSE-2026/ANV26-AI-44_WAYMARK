import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { cellToParent, getResolution, isValidCell } from 'h3-js'
import { ApiError } from '../../lib/api'
import { opsApi } from '../../lib/opsApi'
import type { EffectsOut, Region } from '../../lib/types.ops'
import { Card } from '../ui'

interface CellOpt {
  cell_id: string
  locality: string | null
  risk_score: number | null
  n_past_crashes: number
}

/** "Add measure manually": pick a category, then cells from this region (best-scoring first). */
export function AddMeasureForm({
  region,
  fx,
  onCreated,
  onCancel,
}: {
  region: Region
  fx: EffectsOut | null
  onCreated: (title: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [options, setOptions] = useState<CellOpt[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    opsApi
      .cellsInBounds(region.bounds, 400, ctrl.signal, true)
      .then((all) => {
        let list = all
        if (region.kind === 'h3_parent' && isValidCell(region.key)) {
          const res = getResolution(region.key)
          list = all.filter((c) => {
            try {
              return cellToParent(c.cell_id, res) === region.key
            } catch {
              return false
            }
          })
        }
        setOptions(list.slice(0, 60))
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException)) setLoadError(e instanceof ApiError ? e.message : 'Could not load the cells.')
      })
    return () => ctrl.abort()
  }, [region])

  const cat = useMemo(() => fx?.categories.find((c) => c.id === category), [fx, category])
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (picked.size === 0) return setError('Pick at least one cell.')
    setBusy(true)
    try {
      await opsApi.createMeasure({
        region_kind: region.kind,
        region_key: region.key,
        title: title.trim(),
        category,
        cell_ids: [...picked],
        description: description.trim() || null,
        source: 'manual',
      })
      onCreated(title.trim())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The measure could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="space-y-4">
        <h3 className="font-serif text-xl font-bold">Add a measure</h3>
        <label className="block text-sm font-semibold">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} className="mt-1 w-full rounded-lg border border-navy/25 px-3 py-2 font-normal" />
        </label>
        <label className="block text-sm font-semibold">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} required className="mt-1 w-full rounded-lg border border-navy/25 bg-white px-3 py-2 font-normal">
            <option value="">Choose a category…</option>
            {fx?.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        {cat && (
          <p className="text-sm text-navy/70">
            Default owner: {cat.default_owner}. Photos asked for: {cat.evidence_required.join(' + ')}. Effect weight {cat.weight}
            {cat.placeholder ? ' (placeholder)' : ''}.
          </p>
        )}
        <label className="block text-sm font-semibold">
          Description (optional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={4000} className="mt-1 w-full rounded-lg border border-navy/25 px-3 py-2 font-normal" />
        </label>
        <fieldset>
          <legend className="text-sm font-semibold">Cells this measure covers ({picked.size} chosen)</legend>
          {loadError && <p role="alert" className="mt-1 text-sm font-semibold text-brick">{loadError}</p>}
          {!options && !loadError && <p className="mt-1 text-sm text-navy/65">Loading cells…</p>}
          {options && options.length === 0 && <p className="mt-1 text-sm text-navy/65">No cells found in this region.</p>}
          {options && options.length > 0 && (
            <ul className="mt-2 grid max-h-60 gap-1 overflow-y-auto rounded-lg border border-navy/15 bg-white p-2 sm:grid-cols-2">
              {options.map((c) => (
                <li key={c.cell_id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-ivory-200/70">
                    <input type="checkbox" checked={picked.has(c.cell_id)} onChange={() => toggle(c.cell_id)} className="h-4 w-4 accent-[#2A7F8E]" />
                    <span className="min-w-0 truncate font-mono text-sm">{c.cell_id}</span>
                    {c.locality && <span className="min-w-0 truncate text-xs text-navy/60" title={c.locality}>· {c.locality}</span>}
                    <span className="ml-auto text-xs text-navy/65">score {c.risk_score === null ? '—' : c.risk_score.toFixed(0)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-navy/60">Showing the highest-scoring cells first (up to 60).</p>
        </fieldset>
        {error && <p role="alert" className="font-semibold text-brick">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded-lg bg-navy px-4 py-2 font-semibold text-ivory hover:bg-navy-800 disabled:opacity-60">
            {busy ? 'Adding…' : 'Add to action plan'}
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg border border-navy/25 px-4 py-2 font-semibold hover:bg-ivory-200">Cancel</button>
        </div>
      </form>
    </Card>
  )
}
