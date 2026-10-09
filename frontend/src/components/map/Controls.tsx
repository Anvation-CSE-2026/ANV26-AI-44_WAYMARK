import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, FileText, Info, PanelLeftClose } from 'lucide-react'
import type { Confidence, PlaceSearchItem, Summary } from '../../lib/api'
import { fmtInt, fmtPts } from '../../lib/format'
import { Card } from '../ui'
import { DELTA_STOPS, SCORE_STOPS, gradientCss } from '../../lib/ramp'

export interface Filters {
  confidence: 'All' | Confidence
  maxPast: number
  emergingOnly: boolean
}

export type ColorMode = 'score' | 'emerging' | 'adjusted' | 'projection' | 'incidents'

export interface Scenario {
  night: boolean
  rain: boolean
  lowVis: boolean
}

function Chip({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null
  return (
    <div className="rounded-lg bg-ivory-200/80 px-2 py-1.5 text-center">
      <p className="text-base font-bold leading-none">{fmtInt(value)}</p>
      <p className="mt-1 text-[0.65rem] font-semibold uppercase leading-tight tracking-wide text-navy/60">{label}</p>
    </div>
  )
}

interface FilterCardProps {
  onCollapse: () => void
  summary: Summary | null
  filters: Filters
  onChange: (f: Filters) => void
  maxPastLimit: number
  shown: number
  total: number
  onPlaceSearch: (query: string, prefix?: boolean, signal?: AbortSignal) => Promise<PlaceSearchItem[]>
  onPlaceSelect: (place: PlaceSearchItem) => void
}

export function FilterCard({
  onCollapse,
  summary,
  filters,
  onChange,
  maxPastLimit,
  shown,
  total,
  onPlaceSearch,
  onPlaceSelect,
}: FilterCardProps) {
  const [goto, setGoto] = useState('')
  const [places, setPlaces] = useState<PlaceSearchItem[]>([])
  const [recommendations, setRecommendations] = useState<PlaceSearchItem[]>([])
  const [recommendationsLoaded, setRecommendationsLoaded] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [placeError, setPlaceError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const searchFormRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const query = goto.trim()
    if (!suggestionsOpen || query.length < 2) {
      setPlaces([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      setPlaceError(null)
      try {
        const found = await onPlaceSearch(query, true, controller.signal)
        if (controller.signal.aborted) return
        setPlaces(found.slice(0, 3))
        if (!found.length) setPlaceError(`No matching region found for “${query}”.`)
      } catch (error) {
        if (controller.signal.aborted) return
        setPlaces([])
        setPlaceError(error instanceof Error ? error.message : 'Place search failed.')
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 220)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [goto, suggestionsOpen, onPlaceSearch])

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !searchFormRef.current?.contains(event.target)) setSuggestionsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [])

  const showSearchSuggestions = async () => {
    setSuggestionsOpen(true)
    if (goto.trim()) return
    if (recommendationsLoaded) {
      setPlaces(recommendations)
      return
    }
    setSearching(true)
    setPlaceError(null)
    const defaults = ['Houston', 'Harris', '77002']
    try {
      const found = await Promise.all(defaults.map(async (query) => {
        try {
          const matches = await onPlaceSearch(query, true)
          return matches.find((place) => place.name.toLowerCase() === query.toLowerCase()) ?? matches[0] ?? null
        } catch {
          return null
        }
      }))
      const seen = new Set<string>()
      const items = found.filter((place): place is PlaceSearchItem => {
        if (!place) return false
        const key = `${place.kind}:${place.name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, 3)
      setRecommendations(items)
      setRecommendationsLoaded(true)
      setPlaces(items)
      if (!items.length) setPlaceError('No recommended regions are available.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <Card className="p-3">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h2 className="font-serif text-lg font-bold">Explore cells</h2>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse filters and legend"
          title="Collapse filters"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-navy/75 transition hover:bg-navy/5 hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brass"
        >
          <PanelLeftClose aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>

      {summary && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Chip label="Cells scored" value={summary.cells_scored} />
          <Chip label="Low history" value={summary.low_history_cells} />
          <Chip label="Emerging risk" value={summary.emerging_risk_cells} />
        </div>
      )}

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="f-conf" className="block text-sm font-semibold">
            Confidence
          </label>
          <select
            id="f-conf"
            value={filters.confidence}
            onChange={(e) => onChange({ ...filters, confidence: e.target.value as Filters['confidence'] })}
            className="mt-1 w-full rounded-lg border border-navy/25 bg-white px-3 py-2"
          >
            <option value="All">All levels</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>

        <div>
          <label htmlFor="f-past" className="flex justify-between text-sm font-semibold">
            <span>Past crashes</span>
            <span className="font-bold text-brass-700">{filters.maxPast >= maxPastLimit ? 'No limit' : filters.maxPast}</span>
          </label>
          <input
            id="f-past"
            type="range"
            min={0}
            max={Math.max(1, maxPastLimit)}
            step={1}
            value={Math.min(filters.maxPast, maxPastLimit)}
            onChange={(e) => onChange({ ...filters, maxPast: Number(e.target.value) })}
            className="mt-2 w-full accent-[#B8893B]"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={filters.emergingOnly}
            onChange={(e) => onChange({ ...filters, emergingOnly: e.target.checked })}
            className="h-5 w-5 accent-[#B3412F]"
          />
          <span className="font-medium">Emerging only</span>
        </label>

        <form
          ref={searchFormRef}
          className="relative"
          onSubmit={async (e) => {
            e.preventDefault()
            const query = goto.trim()
            if (!query) return
            setSuggestionsOpen(true)
            setSearching(true)
            setPlaceError(null)
            try {
              const found = await onPlaceSearch(query, true)
              setPlaces(found.slice(0, 3))
              if (found.length === 1) onPlaceSelect(found[0])
              if (!found.length) setPlaceError(`No matching locality found for “${query}”.`)
            } catch (error) {
              setPlaces([])
              setPlaceError(error instanceof Error ? error.message : 'Place search failed.')
            } finally {
              setSearching(false)
            }
          }}
        >
          <label htmlFor="f-goto" className="block text-sm font-semibold">
            Search place
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="f-goto"
              value={goto}
              onFocus={() => void showSearchSuggestions()}
              onChange={(e) => {
                setGoto(e.target.value)
                setSuggestionsOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSuggestionsOpen(false)
              }}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestionsOpen}
              aria-controls="place-suggestions"
              placeholder="e.g. Harris County or 77002"
              className="min-w-0 flex-1 rounded-lg border border-navy/25 bg-white px-3 py-2 text-sm"
            />
            <button type="submit" disabled={searching} className="rounded-lg bg-brass px-3 py-2 font-semibold text-navy hover:bg-brass/85 disabled:opacity-60">
              {searching ? '…' : 'Go'}
            </button>
          </div>
          {suggestionsOpen && places.length > 0 && (
            <div id="place-suggestions" className="absolute inset-x-0 top-full z-[1200] mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-navy/15 bg-white p-1.5 shadow-card" role="listbox" aria-label="Matching regions">
              {places.slice(0, 3).map((place, index) => (
                <button
                  key={`${place.kind}-${place.name}`}
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => {
                    setGoto(place.name)
                    setSuggestionsOpen(false)
                    onPlaceSelect(place)
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-md border-l-4 px-2.5 py-2 text-left text-sm hover:bg-ivory-200 ${[
                    'border-l-brick', 'border-l-brass', 'border-l-teal',
                  ][index]}`}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${['bg-brick', 'bg-brass', 'bg-teal'][index]}`} aria-hidden="true" />
                  <span className="font-semibold">{place.name}</span>
                  <span className="ml-2 text-navy/60">{place.kind} · {place.cell_ids.length} cells</span>
                </button>
              ))}
            </div>
          )}
          {suggestionsOpen && searching && places.length === 0 && <p className="absolute inset-x-0 top-full z-[1200] mt-2 rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm text-navy/65 shadow-card">Finding regions…</p>}
          {placeError && <p className="mt-2 text-sm font-medium text-brick" role="status">{placeError}</p>}
        </form>
      </div>

      <p className="mt-2 text-xs font-medium text-navy/70" aria-live="polite">
        {fmtInt(shown)} / {fmtInt(total)} cells
      </p>
    </Card>
  )
}

interface ToggleProps {
  id: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}

function Toggle({ id, label, checked, onChange }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-base font-semibold transition-colors ${
        checked ? 'border-navy bg-navy text-ivory' : 'border-navy/30 bg-white hover:bg-ivory-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-3.5 w-3.5 rounded-full border ${checked ? 'border-brass bg-brass' : 'border-navy/40'}`}
      />
      {label}
    </button>
  )
}

interface WhatIfCardProps {
  scenario: Scenario
  onChange: (s: Scenario) => void
  loading: boolean
  error: string | null
  meanAll: number | null
  meanEmerging: number | null
  active: boolean
}

export function WhatIfCard({ scenario, onChange, loading, error, meanAll, meanEmerging, active }: WhatIfCardProps) {
  return (
    <Card className="p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg font-bold">What-if</h2>
        <span className="text-[10px] font-bold uppercase tracking-wide text-brass-700">Simulation</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Scenario conditions">
        <Toggle id="w-night" label="Night" checked={scenario.night} onChange={(v) => onChange({ ...scenario, night: v })} />
        <Toggle id="w-rain" label="Rain" checked={scenario.rain} onChange={(v) => onChange({ ...scenario, rain: v })} />
        <Toggle
          id="w-vis"
          label="Low visibility"
          checked={scenario.lowVis}
          onChange={(v) => onChange({ ...scenario, lowVis: v })}
        />
      </div>
      <div className="mt-2 text-sm" aria-live="polite">
        {!active && <p className="text-xs text-navy/70">Choose conditions to compare scores.</p>}
        {active && loading && <p className="text-navy/70">Running scenario…</p>}
        {active && error && <p className="font-medium text-brick">{error}</p>}
        {active && !loading && !error && (
          <dl className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt>All cells</dt>
              <dd className="font-bold">{fmtPts(meanAll)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Emerging cells</dt>
              <dd className="font-bold">{fmtPts(meanEmerging)}</dd>
            </div>
          </dl>
        )}
      </div>
      <details className="mt-2 text-xs text-navy/70">
        <summary className="flex min-h-8 cursor-pointer items-center gap-1.5 font-semibold text-navy/75"><Info aria-hidden="true" className="h-3.5 w-3.5" /> More info <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></summary>
        <p className="pb-1 pl-5">Scenario simulation only; it is not a live forecast. Scores compare each cell with its baseline.</p>
      </details>
    </Card>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-white shadow" style={{ background: color }} />
      {label}
    </li>
  )
}

function GradientBar({ stops, left, right }: { stops: readonly (readonly [number, string])[]; left: string; right: string }) {
  return (
    <div className="mt-2">
      <div aria-hidden="true" className="h-3.5 w-full rounded-full border border-white shadow" style={{ background: gradientCss(stops) }} />
      <div className="mt-1 flex justify-between text-xs text-navy/80">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  )
}

export function Legend({
  scenarioMode,
  colorMode,
  onColorMode,
  opacity,
  onOpacity,
  placeholderWeights = true,
  creditCap = null,
}: {
  scenarioMode: boolean
  colorMode: ColorMode
  onColorMode: (m: ColorMode) => void
  opacity: number
  onOpacity: (v: number) => void
  placeholderWeights?: boolean
  creditCap?: number | null
}) {
  return (
    <Card className="p-3">
      <h2 className="font-serif text-lg font-bold">Map colors</h2>
      {scenarioMode ? (
        <>
          <GradientBar stops={DELTA_STOPS} left="Lower" right="Higher" />
          <details className="mt-2 text-xs text-navy/70">
            <summary className="flex min-h-8 cursor-pointer items-center gap-1.5 font-semibold text-navy/75"><Info aria-hidden="true" className="h-3.5 w-3.5" /> More info <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></summary>
            <p className="pb-1 pl-5">Color shows change from baseline. Grouped hexagons show the mean change.</p>
          </details>
        </>
      ) : (
        <>
          <div role="group" aria-label="Colour hexagons by" className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-navy/5 p-1 text-xs font-semibold sm:text-sm">
            {([
              ['score', 'Risk score', 'Risk score'],
              ['emerging', 'Emerging risk', 'Emerging'],
              ['adjusted', 'Adjusted risk (estimate)', 'Adjusted'],
              ['projection', 'Progress projection', 'Projection'],
              ['incidents', 'Incident activity', 'Incidents'],
            ] as const).map(([m, label, shortLabel]) => (
              <button
                key={m}
                type="button"
                aria-pressed={colorMode === m}
                aria-label={`Color cells by ${label}`}
                title={label}
                onClick={() => onColorMode(m)}
                className={`rounded-md px-2 py-1.5 ${colorMode === m ? 'bg-navy text-ivory' : 'text-navy hover:bg-navy/10'}`}
              >
                {shortLabel}
              </button>
            ))}
          </div>
          {colorMode === 'score' ? (
            <GradientBar stops={SCORE_STOPS} left="Lower score (0)" right="Higher score (100)" />
          ) : colorMode === 'adjusted' ? (
            <>
            <GradientBar stops={SCORE_STOPS} left="Lower (0)" right="Higher (100)" />
              <details className="mt-2 text-xs text-navy/75">
                <summary className="flex min-h-8 cursor-pointer items-center gap-1.5 font-semibold text-navy/80"><Info aria-hidden="true" className="h-3.5 w-3.5" /> More info <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></summary>
                <p className="pb-1 pl-5">
                <strong>Overlay estimate, not a model re-run.</strong> A cell's score is lowered only by{' '}
                <em>verified</em> measures (combined multiplicatively{creditCap ? `, capped at ${Math.round(creditCap * 100)}%` : ''}).
                Cells with no verified measure look the same as in Risk score.
                </p>
              {placeholderWeights && (
                <p role="note" className="ml-5 rounded-md border border-amber/60 bg-amber/10 px-2 py-1.5 text-xs text-[#6b4210]">
                  <strong>Placeholder weights:</strong> the effect sizes are not yet domain-validated.
                </p>
              )}
              </details>
            </>
          ) : colorMode === 'projection' ? (
            <>
              <GradientBar stops={SCORE_STOPS} left="Lower (0)" right="Higher (100)" />
              <details className="mt-2 text-xs text-navy/75">
                <summary className="flex min-h-8 cursor-pointer items-center gap-1.5 font-semibold text-navy/80"><Info aria-hidden="true" className="h-3.5 w-3.5" /> More info <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></summary>
                <p className="pb-1 pl-5">
                <strong>Progress projection, not confirmed risk reduction.</strong> Measure credit follows its current stage and combines multiplicatively, capped at {creditCap ? `${Math.round(creditCap * 100)}%` : 'the configured limit'}. Only verified measures lower adjusted risk.
                </p>
              {placeholderWeights && (
                <p role="note" className="ml-5 rounded-md border border-amber/60 bg-amber/10 px-2 py-1.5 text-xs text-[#6b4210]">
                  <strong>Placeholder weights:</strong> the effect sizes are not yet domain-validated.
                </p>
              )}
              </details>
            </>
          ) : colorMode === 'incidents' ? (
            <>
              <GradientBar stops={SCORE_STOPS} left="No reports" right="More reports" />
              <details className="mt-2 text-xs text-navy/75">
                <summary className="flex min-h-8 cursor-pointer items-center gap-1.5 font-semibold text-navy/80"><Info aria-hidden="true" className="h-3.5 w-3.5" /> More info <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></summary>
                <p className="pb-1 pl-5">Reported activity is separate from risk score. Pending and confirmed reports are counted separately; reports do not change the historical model score.</p>
              </details>
            </>
          ) : (
            <>
              <GradientBar stops={SCORE_STOPS} left="Lower" right="Higher" />
              <ul className="mt-2 space-y-1 text-xs">
                <Swatch color="#8A93A6" label="Not flagged as emerging risk" />
              </ul>
            </>
          )}
          <ul className="mt-2 space-y-1 text-xs">
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border-[3px] border-navy" />
              Dark outline · emerging risk; consider a site audit
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 border-brass bg-navy text-xs font-bold text-sun">◆</span>
              Diamond · action-plan measures
            </li>
          </ul>
        </>
      )}
      <div className="mt-2">
        <label htmlFor="legend-opacity" className="flex justify-between text-sm font-semibold">
          <span>Hexagon opacity</span>
          <span className="text-brass-700">{Math.round(opacity * 100)}%</span>
        </label>
        <input
          id="legend-opacity"
          type="range"
          min="0.15"
          max="0.8"
          step="0.05"
          value={opacity}
          onChange={(e) => onOpacity(Number(e.target.value))}
          className="mt-2 w-full accent-[#B8893B]"
        />
      </div>
      <details className="mt-2 text-xs text-navy/70">
        <summary className="flex min-h-8 cursor-pointer items-center gap-1.5 font-semibold text-navy/75"><Info aria-hidden="true" className="h-3.5 w-3.5" /> More info <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></summary>
        <p className="pb-1 pl-5">Zoom out for grouped cells, in for single cells, and closer for crash points.</p>
      </details>
    </Card>
  )
}

export interface RegionTarget {
  kind: string
  key: string
  label: string
}

/** "Region report": jump from the selected region (or locality, or cell) to its analysis page. */
export function RegionCard({ target, compact = false }: { target: RegionTarget | null; compact?: boolean }) {
  return (
    <Card className={compact ? 'p-2.5 sm:p-3' : 'p-3'}>
      <h2 className={`font-serif font-bold ${compact ? 'text-base sm:text-lg' : 'text-lg'}`}>Region report</h2>
      {target ? (
        <>
          <Link
            to={`/region/${encodeURIComponent(target.key)}?kind=${encodeURIComponent(target.kind)}&generate=1`}
            aria-label={`Generate analysis report for ${target.label}`}
            title={`Generate report for ${target.label}`}
            className={`inline-flex items-center gap-2 rounded-lg bg-navy font-semibold text-ivory hover:bg-navy-800 ${compact ? 'mt-1.5 min-h-9 px-3 py-1.5 text-xs sm:text-sm' : 'mt-2 px-3 py-2 text-sm'}`}
          >
            <FileText aria-hidden="true" className="h-4 w-4" /> Generate report
          </Link>
        </>
      ) : (
        <p className="mt-1 text-xs text-navy/75">Select a region or cell to generate a report.</p>
      )}
    </Card>
  )
}
