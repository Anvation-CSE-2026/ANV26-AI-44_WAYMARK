import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, PanelRightClose, PanelRightOpen, SlidersHorizontal } from 'lucide-react'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import { useSearchParams } from 'react-router-dom'
import { cellToParent } from 'h3-js'
import 'leaflet/dist/leaflet.css'
import { api } from '../lib/api'
import type { CellDetail, CellLite, PlaceSearchItem, WhatIf } from '../lib/api'
import { useApi } from '../hooks/useApi'
import { DEMO_CELLS } from '../lib/demo'
import { baseLayers } from '../lib/tiles'
import { Legend, FilterCard, RegionCard, WhatIfCard } from '../components/map/Controls'
import type { ColorMode, Filters, RegionTarget, Scenario } from '../components/map/Controls'
import { BaseMapSwitch } from '../components/map/BaseMapSwitch'
import { DemoTour } from '../components/map/DemoTour'
import { DetailPanel } from '../components/map/DetailPanel'
import { CrashLayer, FitOnce, FitToBounds, FlyController, HexLayer, WorldLimits } from '../components/map/MapLayers'
import type { FlyTarget, LevelInfo } from '../components/map/MapLayers'
import { Card, ErrorBanner } from '../components/ui'
import { useAuth } from '../context/auth'
import { opsApi } from '../lib/opsApi'
import { IncidentLayer } from '../components/map/IncidentLayer'
import { IncidentReportDialog } from '../components/map/IncidentReportDialog'

const BASE_LAYERS = baseLayers()
const HOUSTON: [number, number] = [29.7604, -95.3698]
const DEFAULT_FILTERS: Filters = { confidence: 'All', maxPast: Number.POSITIVE_INFINITY, emergingOnly: false }
const NO_SCENARIO: Scenario = { night: false, rain: false, lowVis: false }

export default function MapPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('cell')

  const cellsQ = useApi(api.cells, [])
  const summaryQ = useApi(api.summary, [])
  const cells = useMemo(() => cellsQ.data ?? [], [cellsQ.data])
  const cellsById = useMemo(() => new Map(cells.map((c) => [c.cell_id, c])), [cells])

  // ---- filters
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const maxPastLimit = useMemo(() => cells.reduce((m, c) => Math.max(m, c.n_past_crashes), 0), [cells])
  const filtered = useMemo(
    () =>
      cells.filter(
        (c) =>
          (filters.confidence === 'All' || c.confidence === filters.confidence) &&
          c.n_past_crashes <= filters.maxPast &&
          (!filters.emergingOnly || c.emerging_risk),
      ),
    [cells, filters],
  )
  const [region, setRegion] = useState<{ id: string; res: number } | null>(null)
  const [placeSearch, setPlaceSearch] = useState<PlaceSearchItem | null>(null)
  // Region view: only the cells whose H3 parent is the chosen region.
  const regionCells = useMemo(() => {
    if (!region) return filtered
    return filtered.filter((c) => {
      try {
        return cellToParent(c.cell_id, region.res) === region.id
      } catch {
        return false
      }
    })
  }, [filtered, region])
  const regionIds = useMemo(() => (region ? new Set(regionCells.map((c) => c.cell_id)) : null), [region, regionCells])
  const placeIds = useMemo(() => (placeSearch ? new Set(placeSearch.cell_ids) : null), [placeSearch])
  const displayedCells = useMemo(
    () => (placeIds ? filtered.filter((c) => placeIds.has(c.cell_id)) : region ? regionCells : filtered),
    [filtered, placeIds, region, regionCells],
  )

  // What stays vivid: the selected region, otherwise just the selected cell. Everything else fades.
  const highlightIds = useMemo(
    () => regionIds ?? (selectedId ? new Set([selectedId]) : null),
    [regionIds, selectedId],
  )

  // ---- what-if scenario
  const [scenario, setScenario] = useState<Scenario>(NO_SCENARIO)
  const scenarioActive = scenario.night || scenario.rain || scenario.lowVis
  const scenarioLabel = [scenario.night && 'Night', scenario.rain && 'Rain', scenario.lowVis && 'Low visibility']
    .filter(Boolean)
    .join(' + ')
  const whatIfQ = useApi<WhatIf | null>(
    (signal) =>
      scenarioActive ? api.whatif(scenario.night, scenario.rain, scenario.lowVis, signal) : Promise.resolve(null),
    [scenario.night, scenario.rain, scenario.lowVis],
    { keepPrevious: true },
  )
  const whatIf = scenarioActive ? whatIfQ.data : null

  const scenarioStats = useMemo(() => {
    if (!whatIf) return { all: null as number | null, emerging: null as number | null }
    let sumAll = 0
    let nAll = 0
    for (const w of whatIf.byCell.values()) {
      if (w.baseline === null || w.scenario === null) continue
      sumAll += w.scenario - w.baseline
      nAll++
    }
    let sumEm = 0
    let nEm = 0
    for (const c of cells) {
      if (!c.emerging_risk) continue
      const w = whatIf.byCell.get(c.cell_id)
      if (!w || w.baseline === null || w.scenario === null) continue
      sumEm += w.scenario - w.baseline
      nEm++
    }
    return { all: nAll ? sumAll / nAll : null, emerging: nEm ? sumEm / nEm : null }
  }, [whatIf, cells])

  // ---- base map (Light / Dark / Satellite), remembered in this browser
  const [baseName, setBaseName] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('waymark.basemap')
      if (saved && BASE_LAYERS.some((l) => l.name === saved)) return saved
    } catch {
      /* storage unavailable */
    }
    return BASE_LAYERS[0].name
  })
  const base = BASE_LAYERS.find((l) => l.name === baseName) ?? BASE_LAYERS[0]
  const pickBase = (name: string) => {
    setBaseName(name)
    try {
      localStorage.setItem('waymark.basemap', name)
    } catch {
      /* storage unavailable */
    }
  }

  // ---- hexagon colouring
  const [opacity, setOpacity] = useState(0.35)
  const [colorMode, setColorMode] = useState<ColorMode>('score')
  const maxIncidentCount = useMemo(() => cells.reduce((max, c) => Math.max(max, (c.incident_pending_count ?? 0) + (c.incident_confirmed_count ?? 0)), 1), [cells])
  const [level, setLevel] = useState<LevelInfo>({ grouped: true, points: false })
  // null until the first zoomed-in view asks the backend; false = crash points not loaded yet
  const [crashesAvailable, setCrashesAvailable] = useState<boolean | null>(null)
  /** Colour value per cell: scenario change (-1..1), or a 0..1 score; null draws grey. */
  const valueFor = useCallback(
    (c: CellLite): number | null => {
      if (whatIf) {
        const w = whatIf.byCell.get(c.cell_id)
        if (!w || w.baseline === null || w.scenario === null) return null
        return Math.max(-1, Math.min(1, (w.scenario - w.baseline) / (whatIf.maxAbsDelta || 1)))
      }
      if (colorMode === 'emerging') return c.emerging_risk ? (c.history_percentile ?? 0) / 100 : null
      if (colorMode === 'adjusted') return (c.adjusted_risk_score ?? c.risk_score) / 100
      if (colorMode === 'projection') return (c.projected_risk_score ?? c.adjusted_risk_score ?? c.risk_score) / 100
      if (colorMode === 'incidents') return Math.log1p((c.incident_pending_count ?? 0) + (c.incident_confirmed_count ?? 0)) / Math.log1p(maxIncidentCount)
      return c.risk_score / 100
    },
    [whatIf, colorMode, maxIncidentCount],
  )
  const tooltipFor = useCallback(
    (c: CellLite) =>
      `${c.cell_id}${c.street_name || c.locality ? ` · ${[c.street_name, c.locality].filter(Boolean).join(', ')}` : ''} · ${c.n_past_crashes} past crashes` +
      (c.history_percentile !== null
        ? ` · riskier than ${Math.round(c.history_percentile)}% of cells with similar history`
        : '') +
      (colorMode === 'adjusted' && c.adjusted_risk_score !== null
        ? ` · baseline ${c.risk_score.toFixed(1)} → verified adjusted ${c.adjusted_risk_score.toFixed(1)}`
        : '') +
      (colorMode === 'projection'
        ? ` · baseline ${c.risk_score.toFixed(1)} → progress projection ${(c.projected_risk_score ?? c.risk_score).toFixed(1)} (estimate)`
        : '') +
      (colorMode === 'incidents'
        ? ` · ${c.incident_confirmed_count ?? 0} confirmed and ${c.incident_pending_count ?? 0} pending reports`
        : ''),
    [colorMode],
  )

  // ---- selection and navigation
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null)
  const pendingFly = useRef<string | null>(selectedId)
  const flyNonce = useRef(0)
  const [fitEnabled] = useState(!selectedId)

  const selectCell = useCallback(
    (id: string | null, fly = true) => {
      // Picking a single cell highlights just that cell, so leave region view.
      if (id && region) setRegion(null)
      if (id) setPlaceSearch(null)
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (id) p.set('cell', id)
          else p.delete('cell')
          return p
        },
        { replace: id === null },
      )
      if (id && fly) {
        const c = cellsById.get(id)
        if (c) setFlyTarget({ lat: c.lat, lng: c.lng, nonce: ++flyNonce.current })
        else pendingFly.current = id
      }
      if (id) setRightPaneOpen(true)
    },
    [cellsById, setParams, region],
  )

  const detailQ = useApi<CellDetail | null>(
    (signal) => (selectedId ? api.cell(selectedId, signal) : Promise.resolve(null)),
    [selectedId],
  )
  const detail = detailQ.data

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return
      cellsQ.reload()
      if (selectedId) detailQ.reload()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible)
    // The map and selected-cell queries remount on route entry; this listener covers returning to a hidden tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (detail && pendingFly.current === detail.cell_id) {
      pendingFly.current = null
      setFlyTarget({ lat: detail.lat, lng: detail.lng, nonce: ++flyNonce.current })
    }
  }, [detail])

  const selectedPos = useMemo<[number, number] | null>(() => {
    if (detail) return [detail.lat, detail.lng]
    const c = selectedId ? cellsById.get(selectedId) : undefined
    return c ? [c.lat, c.lng] : null
  }, [detail, selectedId, cellsById])

  // ---- demo mode
  const [demoStep, setDemoStep] = useState<number | null>(null)
  const goStep = useCallback(
    (n: number) => {
      setDemoStep(n)
      selectCell(DEMO_CELLS[n])
    },
    [selectCell],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
      if (e.key === 'Escape') {
        if (demoStep !== null) setDemoStep(null)
        else if (selectedId) selectCell(null)
        else if (region) setRegion(null)
      } else if (demoStep !== null && !typing) {
        if (e.key === 'ArrowRight' && demoStep < DEMO_CELLS.length - 1) goStep(demoStep + 1)
        if (e.key === 'ArrowLeft' && demoStep > 0) goStep(demoStep - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [demoStep, selectedId, selectCell, goStep, region])

  // Where the "Region report" card sends you: the open region, the searched locality, or the area around the cell.
  const reportTarget = useMemo<RegionTarget | null>(() => {
    if (region) return { kind: 'h3_parent', key: region.id, label: `region ${region.id} (H3 resolution ${region.res})` }
    if (placeSearch) return { kind: 'locality', key: `${placeSearch.kind}:${placeSearch.name}`, label: placeSearch.name }
    if (selectedId) {
      try {
        return { kind: 'h3_parent', key: cellToParent(selectedId, 7), label: 'the area around this cell' }
      } catch {
        return null
      }
    }
    return null
  }, [region, placeSearch, selectedId])

  const [leftPaneOpen, setLeftPaneOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  const [rightPaneOpen, setRightPaneOpen] = useState(true)
  const [pickIncidentMode, setPickIncidentMode] = useState(false)
  const [incidentPoint, setIncidentPoint] = useState<[number, number] | null>(null)
  const [incidentRefreshKey, setIncidentRefreshKey] = useState(0)
  const isTrafficPolice = user?.role === 'community'
  const demoDetail = demoStep !== null && detail?.cell_id === DEMO_CELLS[demoStep] ? detail : null
  const searchPlaces = useCallback(
    (query: string, prefix = false, signal?: AbortSignal) => api.places(query, signal, prefix),
    [],
  )
  const selectPlace = (place: PlaceSearchItem) => {
    setRegion(null)
    setFilters(DEFAULT_FILTERS)
    setScenario(NO_SCENARIO)
    setDemoStep(null)
    setPlaceSearch(place)
    if (selectedId) selectCell(null, false)
  }

  return (
    <div className="relative h-[calc(100dvh-4rem)] min-h-[320px] w-full overflow-hidden" role="region" aria-label="Map of scored cells in Houston">
      <p className="sr-only">
        Map markers cannot be reached with the keyboard. Use the locality search field, or the Audit list page, to open
        a cell.
      </p>

      <MapContainer
        center={HOUSTON}
        zoom={10}
        preferCanvas
        zoomControl={false}
        className="absolute inset-0 z-0"
        scrollWheelZoom
        maxBoundsViscosity={1}
      >
        <TileLayer
          key={base.name}
          url={base.url}
          attribution={base.attribution}
          maxZoom={base.maxZoom}
          noWrap
          bounds={[
            [-85.05, -180],
            [85.05, 180],
          ]}
        />
        <WorldLimits />
        <ZoomControl position="bottomright" />
        <FitToBounds
          bounds={placeSearch ? [[placeSearch.south, placeSearch.west], [placeSearch.north, placeSearch.east]] : null}
        />
        <HexLayer
          cells={displayedCells}
          highlightIds={highlightIds}
          fillOpacity={opacity}
          forceNative={!!region}
          onPickRegion={(id, res, point) => {
            if (pickIncidentMode && point) { setIncidentPoint(point); setPickIncidentMode(false); return }
            setPlaceSearch(null)
            setRegion({ id, res })
            selectCell(null, false)
          }}
          valueFor={valueFor}
          scenarioMode={!!whatIf}
          tooltipFor={tooltipFor}
          selectedId={selectedId}
          selected={selectedPos}
          onSelect={(id, point) => {
            if (pickIncidentMode && point) { setIncidentPoint(point); setPickIncidentMode(false); return }
            selectCell(id)
          }}
          onLevel={setLevel}
          centerPoints={crashesAvailable === false}
        />
        <CrashLayer enabled={!level.grouped} onAvailable={setCrashesAvailable} cellIds={placeIds ?? highlightIds} />
        <IncidentLayer enabled={true} pickMode={pickIncidentMode} refreshKey={incidentRefreshKey}
          onPick={(lat, lng) => { if (pickIncidentMode) { setIncidentPoint([lat, lng]); setPickIncidentMode(false) } }} />
        <FlyController target={flyTarget} />
        <FitOnce cells={cells} enabled={fitEnabled} />
      </MapContainer>

      {/* Base map switch */}
      <div className="absolute right-2 top-2 z-[1000] md:left-1/2 md:right-auto md:top-4 md:-translate-x-1/2">
        <BaseMapSwitch names={BASE_LAYERS.map((l) => l.name)} value={base.name} onChange={pickBase} />
      </div>

      {isTrafficPolice && <button type="button" onClick={() => setPickIncidentMode((v) => !v)} aria-pressed={pickIncidentMode}
        aria-label={pickIncidentMode ? 'Cancel incident location selection' : 'Report a crash or near miss'}
        className={`absolute bottom-4 left-2 z-[1050] inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold shadow-card md:bottom-auto md:left-auto md:right-4 md:top-16 ${pickIncidentMode ? 'bg-brass text-navy' : 'bg-navy text-ivory'}`}>
        <MapPin aria-hidden="true" className="h-4 w-4" /> {pickIncidentMode ? 'Cancel report' : 'Report incident'}
      </button>}
      {pickIncidentMode && <p role="status" className="pointer-events-none absolute left-1/2 top-14 z-[1040] -translate-x-1/2 rounded-full bg-navy px-3 py-2 text-center text-xs font-semibold text-ivory shadow-card md:top-24">Tap map to place report</p>}

      {/* Map status and details control stay together in the top-right control row. */}
      <div className="absolute right-2 top-14 z-[1060] flex max-w-[calc(100%-1rem)] items-center gap-2 md:right-4 md:top-4">
        {region ? (
          <button
            type="button"
            onClick={() => setRegion(null)}
            className="max-w-[min(55vw,24rem)] truncate rounded-full bg-brass px-3 py-1.5 text-xs font-semibold text-navy shadow-card hover:brightness-95 sm:text-sm"
          >
            {regionCells.length} cells · All regions ×
          </button>
        ) : placeSearch ? (
          <button
            type="button"
            onClick={() => setPlaceSearch(null)}
            title={`${placeSearch.name} · ${displayedCells.length} cells · Clear`}
            className="max-w-[min(55vw,24rem)] truncate rounded-full bg-brass px-3 py-1.5 text-xs font-semibold text-navy shadow-card hover:brightness-95 sm:text-sm"
          >
            {placeSearch.name} · {displayedCells.length} cells · Clear ×
          </button>
        ) : (
          <div className="max-w-[min(55vw,18rem)] truncate rounded-full bg-navy/90 px-3 py-1.5 text-xs font-semibold text-ivory shadow-card sm:text-sm">
            {level.points
              ? crashesAvailable === false
                ? 'Cells · crash points unavailable'
                : 'Cells + crash points'
              : level.grouped
                ? 'Grouped cells · zoom to open'
                : 'Single cells · zoom for crashes'}
          </div>
        )}
        {(reportTarget || selectedId) && <button type="button" onClick={() => {
          const opening = !rightPaneOpen
          setRightPaneOpen(opening)
          if (opening && window.matchMedia('(max-width: 767px)').matches) setLeftPaneOpen(false)
        }} aria-expanded={rightPaneOpen}
          aria-label={rightPaneOpen ? 'Hide map details' : selectedId ? 'Show cell details' : 'Show region report'}
          title={rightPaneOpen ? 'Hide details' : selectedId ? 'Cell details' : 'Region report'}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-navy/20 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy shadow-card sm:text-sm">
          {rightPaneOpen ? <PanelRightClose aria-hidden="true" className="h-4 w-4" /> : <PanelRightOpen aria-hidden="true" className="h-4 w-4" />} {rightPaneOpen ? 'Hide' : selectedId ? 'Details' : 'Report'}
        </button>}
      </div>

      {!leftPaneOpen && <button
        type="button"
        onClick={() => {
          setLeftPaneOpen(true)
          if (window.matchMedia('(max-width: 767px)').matches) setRightPaneOpen(false)
        }}
        aria-expanded={false}
        aria-label="Show map filters and legend"
        title="Filters and legend"
        className="absolute left-2 top-2 z-[1060] inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-ivory shadow-card"
      >
        <SlidersHorizontal aria-hidden="true" className="h-4 w-4" /> Filters
      </button>}

      {/* Left column: filters, what-if, legend */}
      <div
        className={`pointer-events-none absolute inset-x-2 top-14 z-[1000] ${selectedId || reportTarget ? 'max-h-[36dvh]' : 'max-h-[70dvh]'} space-y-3 overflow-y-auto md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:max-h-none md:w-[22rem] ${leftPaneOpen ? 'block' : 'hidden'}`}
      >
        <div className="pointer-events-auto">
          <FilterCard
            onCollapse={() => setLeftPaneOpen(false)}
            summary={summaryQ.data}
            filters={filters}
            onChange={setFilters}
            maxPastLimit={maxPastLimit}
            shown={displayedCells.length}
            total={cells.length}
            onPlaceSearch={searchPlaces}
            onPlaceSelect={selectPlace}
          />
        </div>
        <div className="pointer-events-auto">
          <WhatIfCard
            scenario={scenario}
            onChange={setScenario}
            loading={whatIfQ.loading}
            error={whatIfQ.error}
            meanAll={scenarioStats.all}
            meanEmerging={scenarioStats.emerging}
            active={scenarioActive}
          />
        </div>
        {!reportTarget && (
          <div className="pointer-events-auto">
            <RegionCard target={null} />
          </div>
        )}
        <div className="pointer-events-auto">
          <Legend
            scenarioMode={!!whatIf}
            colorMode={colorMode}
            onColorMode={setColorMode}
            opacity={opacity}
            onOpacity={setOpacity}
            placeholderWeights={summaryQ.data?.placeholder_weights ?? true}
            creditCap={summaryQ.data?.credit_cap ?? null}
          />
        </div>
      </div>

      {(reportTarget || selectedId) && rightPaneOpen && (
        <div className={`pointer-events-none absolute inset-x-2 z-[1000] flex flex-col gap-3 md:inset-x-auto md:right-4 md:w-[26rem] ${
          selectedId ? 'bottom-2 h-[55dvh] max-h-[520px] min-h-[280px] md:bottom-4 md:top-16 md:h-auto md:max-h-none' : 'top-24 bottom-2 md:top-16'
        }`}>
          {reportTarget && (
            <div className="pointer-events-auto shrink-0">
              <RegionCard target={reportTarget} compact />
            </div>
          )}
          {selectedId && (
            <div className="pointer-events-auto min-h-0 flex-1">
              <DetailPanel
                key={selectedId}
                cellId={selectedId}
                detail={detail}
                loading={detailQ.loading}
                error={detailQ.error}
                onRetry={detailQ.reload}
                onClose={() => selectCell(null)}
                scenario={whatIf ? (whatIf.byCell.get(selectedId) ?? null) : null}
                scenarioLabel={scenarioLabel}
              />
            </div>
          )}
        </div>
      )}

      {/* Demo card */}
      {demoStep !== null && (
        <div className="absolute inset-x-2 top-14 z-[1060] md:inset-x-auto md:bottom-4 md:left-[25rem] md:right-[29rem] md:top-auto">
          <DemoTour
            step={demoStep}
            detail={demoDetail}
            loading={!demoDetail && detailQ.loading}
            error={detailQ.error}
            onPrev={() => goStep(Math.max(0, demoStep - 1))}
            onNext={() => goStep(Math.min(DEMO_CELLS.length - 1, demoStep + 1))}
            onExit={() => setDemoStep(null)}
          />
        </div>
      )}

      {incidentPoint && <IncidentReportDialog point={incidentPoint} onClose={() => setIncidentPoint(null)} onSubmit={async (body) => {
        await opsApi.createIncident(body)
        setIncidentRefreshKey((n) => n + 1)
        cellsQ.reload()
        if (selectedId) detailQ.reload()
        setColorMode('incidents')
      }} />}

      {/* Loading / error / empty states */}
      {cellsQ.loading && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-[1100] -translate-x-1/2 rounded-xl border border-navy/10 bg-white/95 px-4 py-2 shadow-card" role="status" aria-live="polite">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-navy"><span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-brass" />Loading map cells…</span>
        </div>
      )}
      {cellsQ.error && (
        <div className="absolute left-1/2 top-4 z-[1100] w-[min(40rem,calc(100%-2rem))] -translate-x-1/2">
          <ErrorBanner message={cellsQ.error} onRetry={cellsQ.reload} />
        </div>
      )}
      {!cellsQ.loading && !cellsQ.error && displayedCells.length === 0 && (
        <div className="absolute left-1/2 top-1/2 z-[1000] w-[min(26rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2">
          <Card className="p-5 text-center">
            <p className="font-serif text-xl font-bold">
              {cells.length === 0 ? 'No cells in the database yet' : placeSearch ? `No scored cells found in ${placeSearch.name}` : 'No cells match these filters'}
            </p>
            <p className="mt-1 text-navy/75">
              {cells.length === 0
                ? 'This backend has no scored cells loaded. Import the project dataset into its database, then reload this page.'
                : placeSearch ? 'Try another locality or clear the search.' : 'Loosen a filter to see cells again.'}
            </p>
            {cells.length > 0 && !placeSearch && (
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="mt-3 rounded-lg bg-navy px-4 py-2 font-semibold text-ivory hover:bg-navy-800"
              >
                Reset filters
              </button>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
