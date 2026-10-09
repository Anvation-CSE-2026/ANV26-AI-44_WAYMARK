import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
    <div className="rounded-lg bg-ivory-200/80 px-2.5 py-1.5 text-center">
      <p className="text-lg font-bold leading-none">{fmtInt(value)}</p>
      <p className="mt-1 text-[0.7rem] font-semibold uppercase leading-tight tracking-wide text-navy/60">{label}</p>
    </div>
  )
}

interface FilterCardProps {
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
    <Card className="p-4">
      <h2 className="font-serif text-xl font-bold">Explore cells</h2>

      {summary && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Chip label="Cells scored" value={summary.cells_scored} />
          <Chip label="Low history" value={summary.low_history_cells} />
          <Chip label="Emerging risk" value={summary.emerging_risk_cells} />
        </div>
      )}

      <div className="mt-4 space-y-4">
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
            <span>Max past crashes</span>
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
          <span className="font-medium">Emerging-risk cells only</span>
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
            Search locality or region
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

      <p className="mt-3 text-sm text-navy/70" aria-live="polite">
        Showing {fmtInt(shown)} of {fmtInt(total)} cells
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
    <Card className="p-4">
      <h2 className="font-serif text-xl font-bold">What-if</h2>
      <p className="mt-0.5 text-sm font-semibold uppercase tracking-wide text-brass-700">
        Scenario simulation, not a live forecast
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Scenario conditions">
        <Toggle id="w-night" label="Night" checked={scenario.night} onChange={(v) => onChange({ ...scenario, night: v })} />
        <Toggle id="w-rain" label="Rain" checked={scenario.rain} onChange={(v) => onChange({ ...scenario, rain: v })} />
        <Toggle
          id="w-vis"
          label="Low visibility"
          checked={scenario.lowVis}
          onChange={(v) => onChange({ ...scenario, lowVis: v })}
        />
      </div>
      <div className="mt-3 text-sm" aria-live="polite">
        {!active && <p className="text-navy/70">Switch on a condition to recolour the map and compare each cell with its baseline.</p>}
        {active && loading && <p className="text-navy/70">Running scenario…</p>}
        {active && error && <p className="font-medium text-brick">{error}</p>}
        {active && !loading && !error && (
          <dl className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt>Average change, all cells</dt>
              <dd className="font-bold">{fmtPts(meanAll)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Average change, emerging-risk cells</dt>
              <dd className="font-bold">{fmtPts(meanEmerging)}</dd>
            </div>
          </dl>
        )}
      </div>
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
      <div className="mt-1 flex justify-between text-sm text-navy/80">
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
    <Card className="p-4">
      <h2 className="font-serif text-xl font-bold">Legend</h2>
      {scenarioMode ? (
        <>
          <GradientBar stops={DELTA_STOPS} left="Lower under scenario" right="Higher under scenario" />
          <p className="mt-2 text-sm text-navy/75">Colour shows the change from baseline. Grouped hexagons show the mean change.</p>
        </>
      ) : (
        <>
          <div role="group" aria-label="Colour hexagons by" className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-navy/5 p-1 text-sm font-semibold">
            {([
              ['score', 'Risk score'],
              ['emerging', 'Emerging risk'],
              ['adjusted', 'Adjusted risk (estimate)'],
              ['projection', 'Progress projection'],
              ['incidents', 'Incident activity'],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={colorMode === m}
                onClick={() => onColorMode(m)}
                className={`rounded-md px-2 py-1.5 ${colorMode === m ? 'bg-navy text-ivory' : 'text-navy hover:bg-navy/10'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {colorMode === 'score' ? (
            <GradientBar stops={SCORE_STOPS} left="Lower score (0)" right="Higher score (100)" />
          ) : colorMode === 'adjusted' ? (
            <>
              <GradientBar stops={SCORE_STOPS} left="Lower adjusted score (0)" right="Higher adjusted score (100)" />
              <p className="mt-2 text-sm text-navy/80">
                <strong>Overlay estimate, not a model re-run.</strong> A cell's score is lowered only by{' '}
                <em>verified</em> measures (combined multiplicatively{creditCap ? `, capped at ${Math.round(creditCap * 100)}%` : ''}).
                Cells with no verified measure look the same as in Risk score.
              </p>
              {placeholderWeights && (
                <p role="note" className="mt-2 rounded-md border border-amber/60 bg-amber/10 px-2 py-1.5 text-sm text-[#6b4210]">
                  <strong>Placeholder weights:</strong> the effect sizes are not yet domain-validated.
                </p>
              )}
            </>
          ) : colorMode === 'projection' ? (
            <>
              <GradientBar stops={SCORE_STOPS} left="Lower projection (0)" right="Higher projection (100)" />
              <p className="mt-2 text-sm text-navy/80">
                <strong>Progress projection, not confirmed risk reduction.</strong> Measure credit follows its current stage and combines multiplicatively, capped at {creditCap ? `${Math.round(creditCap * 100)}%` : 'the configured limit'}. Only verified measures lower adjusted risk.
              </p>
              {placeholderWeights && (
                <p role="note" className="mt-2 rounded-md border border-amber/60 bg-amber/10 px-2 py-1.5 text-sm text-[#6b4210]">
                  <strong>Placeholder weights:</strong> the effect sizes are not yet domain-validated.
                </p>
              )}
            </>
          ) : colorMode === 'incidents' ? (
            <>
              <GradientBar stops={SCORE_STOPS} left="No reports" right="More reports" />
              <p className="mt-2 text-sm text-navy/80"><strong>Reported activity, not a risk score.</strong> Pending and confirmed reports are counted separately; the historical model score does not change.</p>
            </>
          ) : (
            <>
              <GradientBar stops={SCORE_STOPS} left="Lower vs similar history" right="Higher vs similar history" />
              <ul className="mt-2 space-y-1.5 text-sm">
                <Swatch color="#8A93A6" label="Not flagged as emerging risk" />
              </ul>
            </>
          )}
          <ul className="mt-2 space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border-[3px] border-navy" />
              Dark outline: emerging-risk cell (elevated risk, recommend a site audit)
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 border-brass bg-navy text-xs font-bold text-sun">◆</span>
              Diamond marker: cell with action-plan measures
            </li>
          </ul>
        </>
      )}
      <div className="mt-3">
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
      <p className="mt-2 text-sm text-navy/75">Zoom out for grouped hexagons, in for single cells, closer for real crash points.</p>
    </Card>
  )
}

export interface RegionTarget {
  kind: string
  key: string
  label: string
}

/** "Region report": jump from the selected region (or locality, or cell) to its analysis page. */
export function RegionCard({ target }: { target: RegionTarget | null }) {
  return (
    <Card className="p-4">
      <h2 className="font-serif text-xl font-bold">Region report</h2>
      {target ? (
        <>
          <p className="mt-1 text-sm text-navy/80">
            Analyse <strong>{target.label}</strong>: headline index, hotspots, trends and a downloadable PDF, then ask the
            assistant and track the action plan.
          </p>
          <Link
            to={`/region/${encodeURIComponent(target.key)}?kind=${encodeURIComponent(target.kind)}&generate=1`}
            className="mt-3 inline-flex rounded-lg bg-navy px-4 py-2 font-semibold text-ivory hover:bg-navy-800"
          >
            Generate analysis report
          </Link>
        </>
      ) : (
        <p className="mt-1 text-sm text-navy/75">
          Click a grouped hexagon to open a region, search for a locality, or select a cell. A report button appears here.
        </p>
      )}
    </Card>
  )
}
