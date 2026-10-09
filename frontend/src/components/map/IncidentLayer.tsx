import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { api } from '../../lib/api'
import type { IncidentReport } from '../../lib/api'

interface Props {
  enabled: boolean
  pickMode: boolean
  refreshKey: number
  onPick: (lat: number, lng: number) => void
}

function IncidentPoints({ reports }: { reports: IncidentReport[] }) {
  const map = useMap()
  useEffect(() => {
    const group = L.layerGroup().addTo(map)
    for (const report of reports) {
      const color = report.status === 'confirmed' ? '#2A7F8E' : report.status === 'pending' ? '#B8893B' : '#8b2635'
      const marker = L.circleMarker([report.lat, report.lng], {
        radius: report.kind === 'crash' ? 7 : 6, color: '#17243d', weight: 1.5,
        fillColor: color, fillOpacity: 0.95,
      })
      marker.bindTooltip(`${report.kind === 'near_miss' ? 'Near miss' : 'Reported crash'} · ${report.status}${report.severity ? ` · severity ${report.severity}` : ''}${report.note ? ` · ${report.note}` : ''}`, { direction: 'top', sticky: true })
      group.addLayer(marker)
    }
    return () => { map.removeLayer(group) }
  }, [map, reports])
  return null
}

export function IncidentLayer({ enabled, pickMode, refreshKey, onPick }: Props) {
  const map = useMap()
  const [reports, setReports] = useState<IncidentReport[]>([])
  const [loadNonce, setLoadNonce] = useState(0)
  const pickRef = useRef(onPick)
  const requestRef = useRef<AbortController | null>(null)
  const timerRef = useRef<number | null>(null)
  useEffect(() => { pickRef.current = onPick }, [onPick])

  const reload = useCallback(async () => {
    if (!enabled && !pickMode) return
    const b = map.getBounds()
    const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    try { setReports(await api.incidents(bbox, controller.signal)) } catch { if (!controller.signal.aborted) setReports([]) }
  }, [enabled, pickMode, map])

  useMapEvents({
    moveend: () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setLoadNonce((n) => n + 1), 180)
    },
    click: (event) => { if (pickMode) pickRef.current(event.latlng.lat, event.latlng.lng) },
  })

  useEffect(() => { void reload() }, [reload, refreshKey, loadNonce])
  useEffect(() => {
    const refreshOnReturn = () => { if (document.visibilityState === 'visible') setLoadNonce((n) => n + 1) }
    document.addEventListener('visibilitychange', refreshOnReturn)
    return () => document.removeEventListener('visibilitychange', refreshOnReturn)
  }, [])
  useEffect(() => () => {
    requestRef.current?.abort()
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])
  const visible = useMemo(() => enabled ? reports.filter((r) => r.status !== 'rejected') : [], [enabled, reports])
  return enabled ? <IncidentPoints reports={visible} /> : null
}
