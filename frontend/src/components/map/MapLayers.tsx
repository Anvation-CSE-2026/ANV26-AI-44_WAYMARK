import { useEffect, useMemo, useRef, useState } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { cellToBoundary, cellToLatLng, cellToParent, getResolution } from 'h3-js'
import { api } from '../../lib/api'
import type { CellLite, CrashPoint } from '../../lib/api'
import { MAP_PALETTE } from '../../lib/format'
import { DELTA_STOPS, NO_DATA_COLOR, SCORE_STOPS, rampColor } from '../../lib/ramp'

/** Cells outside the selection keep this share of the normal fill opacity (1 = no fading). */
const DIM_FACTOR = 0.7

/** Points (cell centres) appear from this zoom level. */
const POINT_ZOOM = 15

/** H3 resolution to draw at a given zoom: coarse hexagons far out, the native cells close in. */
function resolutionForZoom(zoom: number, native: number): number {
  const r = zoom < 11 ? 6 : zoom < 12 ? 7 : zoom < 14 ? 8 : native
  return Math.min(r, native)
}

const boundaryCache = new Map<string, L.LatLngTuple[]>()
function boundaryOf(id: string): L.LatLngTuple[] {
  let b = boundaryCache.get(id)
  if (!b) {
    b = cellToBoundary(id) as L.LatLngTuple[]
    boundaryCache.set(id, b)
  }
  return b
}

interface HexItem {
  id: string
  lat: number
  lng: number
  /** Mean of the colour values of the cells inside (null if none have one). */
  value: number | null
  n: number
  emerging: number
  crashes: number
  /** Cells inside that have at least one action-plan measure (1 or 0 for a single cell). */
  measures: number
  cell: CellLite | null
}

export interface LevelInfo {
  grouped: boolean
  points: boolean
}

export function FitToBounds({ bounds }: { bounds: [[number, number], [number, number]] | null }) {
  const map = useMap()
  useEffect(() => {
    if (!bounds) return
    const wide = window.innerWidth >= 768
    map.flyToBounds(bounds, {
      paddingTopLeft: [wide ? 380 : 20, 40],
      paddingBottomRight: [wide ? 440 : 20, 40],
      maxZoom: 16,
      duration: 0.9,
    })
  }, [bounds, map])
  return null
}

interface HexLayerProps {
  cells: CellLite[]
  /** Colour value per cell: 0-1 for scores, -1 to 1 for scenario change, null = no data. */
  valueFor: (c: CellLite) => number | null
  scenarioMode: boolean
  tooltipFor: (c: CellLite) => string
  selectedId: string | null
  selected: [number, number] | null
  onSelect: (id: string) => void
  onLevel?: (info: LevelInfo) => void
  /** Draw a dot at each cell centre (only used when real crash points are not loaded). */
  centerPoints?: boolean
  /** Fill opacity of the hexagons (0-1). */
  fillOpacity?: number
  /** Draw single cells at every zoom (used when one region is selected). */
  forceNative?: boolean
  /** Selected cell or region: these stay vivid, every other cell keeps its colour at lower opacity. */
  highlightIds?: ReadonlySet<string> | null
  /** Called when a grouped hexagon (a region) is clicked. */
  onPickRegion?: (id: string, res: number) => void
}

/**
 * Draws H3 hexagons coloured green / yellow / red. Zoomed out, cells are grouped into larger
 * hexagons; zoomed in, every cell is drawn; closer still, a point marks each cell centre.
 */
export function HexLayer({
  cells,
  valueFor,
  scenarioMode,
  tooltipFor,
  selectedId,
  selected,
  onSelect,
  onLevel,
  centerPoints = false,
  fillOpacity = 0.35,
  forceNative = false,
  highlightIds = null,
  onPickRegion,
}: HexLayerProps) {
  const map = useMap()
  const onSelectRef = useRef(onSelect)
  const onPickRegionRef = useRef(onPickRegion)
  useEffect(() => {
    onSelectRef.current = onSelect
    onPickRegionRef.current = onPickRegion
  }, [onSelect, onPickRegion])

  const [view, setView] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }))
  useMapEvents({
    moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }),
  })

  const native = useMemo(() => (cells.length ? getResolution(cells[0].cell_id) : 9), [cells])
  const res = forceNative ? native : resolutionForZoom(view.zoom, native)
  const grouped = res < native
  const points = !grouped && view.zoom >= POINT_ZOOM

  useEffect(() => {
    onLevel?.({ grouped, points })
  }, [grouped, points, onLevel])

  // Items to draw at this resolution (grouping happens only when the resolution changes).
  const items = useMemo<HexItem[]>(() => {
    if (!grouped) {
      return cells.map((c) => ({
        id: c.cell_id,
        lat: c.lat,
        lng: c.lng,
        value: valueFor(c),
        n: 1,
        emerging: c.emerging_risk ? 1 : 0,
        crashes: c.n_past_crashes,
        measures: c.has_measures ? 1 : 0,
        cell: c,
      }))
    }
    const acc = new Map<string, { sum: number; k: number; n: number; emerging: number; crashes: number; measures: number }>()
    for (const c of cells) {
      const parent = cellToParent(c.cell_id, res)
      let a = acc.get(parent)
      if (!a) {
        a = { sum: 0, k: 0, n: 0, emerging: 0, crashes: 0, measures: 0 }
        acc.set(parent, a)
      }
      const v = valueFor(c)
      if (v !== null) {
        a.sum += v
        a.k++
      }
      a.n++
      a.crashes += c.n_past_crashes
      if (c.emerging_risk) a.emerging++
      if (c.has_measures) a.measures++
    }
    const out: HexItem[] = []
    for (const [id, a] of acc) {
      const [lat, lng] = cellToLatLng(id)
      out.push({ id, lat, lng, value: a.k ? a.sum / a.k : null, n: a.n, emerging: a.emerging, crashes: a.crashes, measures: a.measures, cell: null })
    }
    return out
  }, [cells, valueFor, grouped, res])

  useEffect(() => {
    const group = L.layerGroup().addTo(map)
    const stops = scenarioMode ? DELTA_STOPS : SCORE_STOPS
    const area = view.bounds.pad(0.25)
    const colorOf = (v: number | null) => (v === null ? NO_DATA_COLOR : rampColor(stops, v))

    const isDim = (it: HexItem) => !!highlightIds && !!it.cell && !highlightIds.has(it.id)
    const rank = (it: HexItem) => (isDim(it) ? -10 : 0) + (it.value ?? -2)
    const visible = items.filter((it) => area.contains([it.lat, it.lng])).sort((a, b) => rank(a) - rank(b))

    for (const it of visible) {
      const dim = isDim(it)
      const fill = colorOf(it.value)
      const flagged = it.emerging > 0 && !dim
      const baseOpacity = dim ? fillOpacity * DIM_FACTOR : highlightIds ? Math.min(0.85, fillOpacity + 0.25) : fillOpacity
      const poly = L.polygon(boundaryOf(it.id), {
        color: flagged ? MAP_PALETTE.navy : '#ffffff',
        weight: dim ? 0.8 : flagged ? (grouped ? 2.5 : 3) : 1,
        opacity: dim ? 0.5 : flagged ? 0.95 : 0.7,
        fillColor: fill,
        fillOpacity: it.value === null ? baseOpacity * 0.5 : baseOpacity,
      })
      if (it.cell) {
        const c = it.cell
        poly.bindTooltip(tooltipFor(c), { direction: 'top', sticky: true })
        poly.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          onSelectRef.current(c.cell_id)
        })
      } else {
        poly.bindTooltip(
          `${it.n} cells · ${it.crashes.toLocaleString('en-US')} past crashes · ${it.emerging} emerging-risk cell${
            it.emerging === 1 ? '' : 's'
          } (click to open this region)`,
          { direction: 'top', sticky: true },
        )
        poly.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          const wide = window.innerWidth >= 768
          map.flyToBounds(poly.getBounds(), {
            paddingTopLeft: [wide ? 380 : 20, 40],
            paddingBottomRight: [40, 40],
            maxZoom: 17,
            duration: 0.9,
          })
          onPickRegionRef.current?.(it.id, res)
        })
      }
      group.addLayer(poly)

      if (points && centerPoints && it.cell && !dim) {
        const c = it.cell
        const dot = L.circleMarker([c.lat, c.lng], {
          radius: flagged ? 7 : 5,
          color: flagged ? MAP_PALETTE.navy : '#ffffff',
          weight: 2,
          fillColor: fill,
          fillOpacity: 1,
        })
        dot.bindTooltip(tooltipFor(c), { direction: 'top', sticky: true })
        dot.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          onSelectRef.current(c.cell_id)
        })
        group.addLayer(dot)
      }
    }

    // Action-plan markers: a diamond (shape, not colour alone) with a count, keyboard focusable, with a text name.
    for (const it of visible) {
      if (it.measures === 0 || isDim(it)) continue
      const label = it.cell
        ? `Cell ${it.id} has ${it.cell.measures.length} action-plan measure${it.cell.measures.length === 1 ? '' : 's'}: ${it.cell.measures
            .map((m) => `${m.title} (${m.status.replace(/_/g, ' ')})`)
            .join('; ')}`
        : `${it.measures} cell${it.measures === 1 ? '' : 's'} with action-plan measures in this group`
      const count = it.cell ? it.cell.measures.length : it.measures
      const marker = L.marker([it.lat, it.lng], {
        icon: L.divIcon({
          className: 'wm-marker',
          html: `<span class="wm-marker-badge" aria-hidden="true">◆${count > 1 ? count : ''}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        title: label,
        alt: label,
        keyboard: true,
        riseOnHover: true,
      })
      marker.bindTooltip(label, { direction: 'top' })
      if (it.cell) {
        const c = it.cell
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          onSelectRef.current(c.cell_id)
        })
      }
      group.addLayer(marker)
    }

    if (selectedId && !grouped) {
      try {
        group.addLayer(
          L.polygon(boundaryOf(selectedId), { color: MAP_PALETTE.brass, weight: 4, fill: false, interactive: false }),
        )
      } catch {
        /* not a valid H3 id: skip the outline */
      }
    }
    if (selected) {
      group.addLayer(
        L.circleMarker(selected, { radius: 14, color: MAP_PALETTE.brass, weight: 4, fill: false, interactive: false }),
      )
    }
    return () => {
      group.remove()
    }
  }, [items, view, grouped, points, centerPoints, scenarioMode, tooltipFor, selectedId, selected, map, fillOpacity, res, highlightIds])

  return null
}

/** Real crash locations from the dataset, drawn as small points once the map is zoomed in. */
export function CrashLayer({
  enabled,
  onAvailable,
  cellIds = null,
}: {
  enabled: boolean
  /** Crashes in these cells (the selection) stay vivid; all other crashes are drawn smaller and fainter. */
  cellIds?: ReadonlySet<string> | null
  /** Reports whether the backend has crash points loaded (false until pipeline/load_crashes.py is run). */
  onAvailable: (available: boolean) => void
}) {
  const map = useMap()
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }))
  const [crashes, setCrashes] = useState<CrashPoint[]>([])
  useMapEvents({ moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }) })

  const active = enabled && view.zoom >= POINT_ZOOM
  useEffect(() => {
    if (!active) {
      setCrashes([])
      return
    }
    const ctrl = new AbortController()
    const b = view.bounds.pad(0.1)
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(6)).join(',')
    api
      .crashes(bbox, ctrl.signal)
      .then((r) => {
        onAvailable(r.available)
        setCrashes(r.items)
      })
      .catch(() => {
        /* aborted or backend unreachable: keep the hexagons */
      })
    return () => ctrl.abort()
  }, [active, view, onAvailable])

  useEffect(() => {
    if (!active || crashes.length === 0) return
    const group = L.layerGroup().addTo(map)
    for (const c of crashes) {
      const dim = !!cellIds && !cellIds.has(c.cell_id)
      const dot = L.circleMarker([c.lat, c.lng], {
        radius: dim ? 3.5 : 4,
        color: '#ffffff',
        weight: dim ? 0 : 1,
        fillColor: MAP_PALETTE.navy,
        fillOpacity: dim ? 0.6 : 0.9,
        interactive: true,
      })
      const when = c.start_time ? c.start_time.slice(0, 16) : 'date not recorded'
      dot.bindTooltip(
        `Crash ${when}${c.severity ? ` · severity ${c.severity}` : ''}${c.weather ? ` · ${c.weather}` : ''}${
          c.night ? ' · night' : ''
        }`,
        { direction: 'top' },
      )
      group.addLayer(dot)
    }
    return () => {
      group.remove()
    }
  }, [active, crashes, map, cellIds])

  return null
}

/** Keeps the map to a single copy of the world: no repeated continents, no grey bands past the poles. */
export function WorldLimits() {
  const map = useMap()
  useEffect(() => {
    const world = L.latLngBounds([-85, -180], [85, 180])
    const apply = () => {
      // Smallest zoom at which the world still fills the whole map view.
      const z = map.getBoundsZoom(world, true)
      map.setMinZoom(z)
      if (map.getZoom() < z) map.setZoom(z)
    }
    map.setMaxBounds(world)
    apply()
    map.on('resize', apply)
    return () => {
      map.off('resize', apply)
    }
  }, [map])
  return null
}

export interface FlyTarget {
  lat: number
  lng: number
  nonce: number
}

/** Flies to a target, shifting it left on wide screens so the side panel does not cover it. */
export function FlyController({ target }: { target: FlyTarget | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const zoom = Math.max(map.getZoom(), 15)
    let dest = L.latLng(target.lat, target.lng)
    if (window.innerWidth >= 768) {
      const p = map.project(dest, zoom)
      p.x += 200
      dest = map.unproject(p, zoom)
    }
    if (reduce) map.setView(dest, zoom)
    else map.flyTo(dest, zoom, { duration: 1.1 })
  }, [target, map])
  return null
}

/** Fits the map to the loaded cells once. */
export function FitOnce({ cells, enabled }: { cells: CellLite[]; enabled: boolean }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || !enabled || cells.length === 0) return
    done.current = true
    const bounds = L.latLngBounds(cells.map((c) => [c.lat, c.lng] as [number, number]))
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.05))
  }, [cells, enabled, map])
  return null
}
