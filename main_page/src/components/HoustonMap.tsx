import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import gsap from "gsap";
import {
  ALL_CELLS,
  HOUSTON,
  TIER_META,
  isEmerging,
  scenarioScore,
  tierOf,
  type CellScore,
  type ScenarioKey,
} from "../data/engine";
import { useMotion } from "../lib/motion";

interface HoustonMapProps {
  cells: CellScore[];
  scenario: Partial<Record<ScenarioKey, boolean>>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTilesFailed: () => void;
}

interface MarkerStyle {
  cls: string;
  size: number;
  z: number;
  label: string;
}

function styleFor(cell: CellScore, scenario: Partial<Record<ScenarioKey, boolean>>): MarkerStyle {
  const anyScenario = !!(scenario.night || scenario.rain || scenario.lowvis);
  const score = scenarioScore(cell, scenario);
  const pct = Math.round(score * 1000) / 10;

  if (isEmerging(cell) || cell.demo) {
    // Under a scenario we re-band by the simulated score (still illustrative).
    const tier = anyScenario ? (score >= 0.28 ? 2 : score >= 0.18 ? 1 : 0) : tierOf(cell);
    const meta = TIER_META[tier];
    return {
      cls: `${meta.cls} ${tier >= 1 ? "mk-emerging" : ""}`,
      size: Math.min(17, 8 + score * 32),
      z: 1200 + tier,
      label: `Emerging-risk cell ${cell.id}, ${cell.pastCrashes} past crash${cell.pastCrashes === 1 ? "" : "es"}, ${meta.label}, confidence ${cell.confidence}, modelled probability ${pct} percent`,
    };
  }
  if (score >= 0.095) {
    return {
      cls: "mk-top",
      size: Math.min(13, 6 + score * 20),
      z: 600,
      label: `Top-scoring cell ${cell.id}, ${cell.pastCrashes} past crashes, confidence ${cell.confidence}, modelled probability ${pct} percent`,
    };
  }
  return {
    cls: "mk-dim",
    size: 6,
    z: 200,
    label: `Scored cell ${cell.id}, ${cell.pastCrashes} past crashes, confidence ${cell.confidence}`,
  };
}

/**
 * Leaflet map of Houston with the illustrative cell overlay.
 * CartoDB Positron tiles; if tiles fail, the parent is notified and a
 * friendly hex-grid fallback is shown instead (markers stay faithful).
 */
export default function HoustonMap({ cells, scenario, selectedId, onSelect, onTilesFailed }: HoustonMapProps) {
  const { reduced } = useMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<globalThis.Map<string, L.Marker>>(new globalThis.Map());
  const cellsKeyRef = useRef<string>("");
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const cellsKey = useMemo(() => cells.map((c) => c.id).join(","), [cells]);

  /* ── init map ── */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, {
      center: HOUSTON.center,
      zoom: HOUSTON.zoom,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    mapRef.current = map;

    const tiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/" rel="noreferrer">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    });

    let errors = 0;
    tiles.on("tileerror", () => {
      errors += 1;
      if (errors >= 4 && mapRef.current) {
        // Friendly fallback: swap to the hex-grid backdrop.
        mapRef.current.removeLayer(tiles);
        host.classList.add("map-fallback");
        onTilesFailed();
      }
    });
    tiles.addTo(map);

    layerRef.current = L.layerGroup().addTo(map);

    // gentle entrance of the basemap
    if (!reduced) {
      const pane = host.querySelector<HTMLElement>(".leaflet-tile-pane");
      if (pane) gsap.fromTo(pane, { opacity: 0 }, { opacity: 1, duration: 1.4, ease: "power1.out" });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── build / recolour markers ── */
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const sameSet = cellsKeyRef.current === cellsKey;
    cellsKeyRef.current = cellsKey;

    layer.clearLayers();
    const store = markersRef.current;
    store.clear();

    // anchor for the scenario ripple: bottom-centre of the map (toward the toggles)
    const anchorPt = L.point(map.getSize().x / 2, map.getSize().y);

    // cascade order: highest risk first, then from the centre outward
    const ordered = [...cells].sort((a, b) => {
      const ra = isEmerging(a) || a.demo ? 0 : 1;
      const rb = isEmerging(b) || b.demo ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const da = Math.hypot(a.lat - HOUSTON.center[0], a.lng - HOUSTON.center[1]);
      const db = Math.hypot(b.lat - HOUSTON.center[0], b.lng - HOUSTON.center[1]);
      return da - db;
    });
    const delayOf = new globalThis.Map<string, number>();
    ordered.forEach((c, i) => delayOf.set(c.id, reduced ? 0 : sameSet ? 0 : Math.min(2200, i * 42)));

    cells.forEach((cell) => {
      const st = styleFor(cell, scenario);
      const icon = L.divIcon({
        html: `<button type="button" class="cell-marker ${st.cls}" style="width:${st.size}px;height:${st.size}px" aria-label="${st.label}"></button>`,
        className: "cell-marker-wrap",
        iconSize: [st.size, st.size],
        iconAnchor: [st.size / 2, st.size / 2],
      });
      const m = L.marker([cell.lat, cell.lng], { icon, keyboard: false, zIndexOffset: st.z });
      m.on("click", () => onSelectRef.current(cell.id));
      m.addTo(layer);
      store.set(cell.id, m);
    });

    // selected ring
    if (selectedId) {
      const el = store.get(selectedId)?.getElement()?.querySelector(".cell-marker");
      el?.classList.add("mk-selected");
    }

    if (reduced) return;

    if (!sameSet) {
      // entrance cascade
      store.forEach((m, id) => {
        const el = m.getElement()?.querySelector<HTMLElement>(".cell-marker");
        if (!el) return;
        gsap.fromTo(
          el,
          { scale: 0, opacity: 0 },
          { scale: 1, opacity: 1, delay: (delayOf.get(id) ?? 0) / 1000, duration: 0.55, ease: "back.out(2)" },
        );
      });
    } else {
      // scenario change: colour/size morph rippling outward from the toggles
      store.forEach((m) => {
        const el = m.getElement()?.querySelector<HTMLElement>(".cell-marker");
        if (!el) return;
        const pt = map.latLngToContainerPoint(m.getLatLng());
        const dist = Math.min(pt.distanceTo(anchorPt), 900);
        gsap.fromTo(
          el,
          { scale: 0.45 },
          { scale: 1, delay: reduced ? 0 : (dist / 900) * 0.55, duration: 0.6, ease: "back.out(2.2)" },
        );
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, cellsKey, scenario, reduced]);

  /* ── selection ring + camera flight ── */
  useEffect(() => {
    markersRef.current.forEach((m, id) => {
      m.getElement()?.querySelector(".cell-marker")?.classList.toggle("mk-selected", id === selectedId);
    });
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const cell = ALL_CELLS.find((c) => c.id === selectedId);
    if (!cell) return;
    if (reduced) {
      map.setView([cell.lat, cell.lng], Math.max(map.getZoom(), 12));
    } else {
      map.flyTo([cell.lat, cell.lng], 13, { duration: 1.35, easeLinearity: 0.18 });
    }
  }, [selectedId, reduced]);

  return <div ref={hostRef} className="h-full w-full" data-testid="houston-map" />;
}
