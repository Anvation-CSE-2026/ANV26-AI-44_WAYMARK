import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Play,
  Square,
  ExternalLink,
  Hexagon,
  TriangleAlert,
  ArrowDownRight,
  ArrowUpRight,
  MoonStar,
  CloudRain,
  CloudFog,
  Info,
  SlidersHorizontal,
  CheckCheck,
} from "lucide-react";
import HoustonMap from "../components/HoustonMap";
import MapCursor from "../components/MapCursor";
import { HexIris, SectionHead, SectionNote, useCountUp } from "../components/ui";
import { useMotion, EASE } from "../lib/motion";
import {
  ALL_CELLS,
  METRICS,
  PERCENTILE_LINE,
  SUGGESTED_ACTIONS,
  TOUR_STEPS,
  isEmerging,
  scenarioScore,
  tierOf,
  type CellScore,
  type Confidence,
  type ScenarioKey,
} from "../data/engine";
import { cn } from "../utils/cn";

/* ─────────────────────────── small pieces ─────────────────────────── */

function ConfidenceBadge({ value }: { value: Confidence }) {
  const styles: Record<Confidence, string> = {
    High: "border-navy/25 bg-navy/5 text-navy",
    Medium: "border-teal/30 bg-teal/10 text-teal",
    Low: "border-amber/40 bg-amber/15 text-[#8a5510]",
  };
  const note: Record<Confidence, string> = {
    High: "solid history",
    Medium: "moderate history",
    Low: "little history — treat with care",
  };
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", styles[value])}
      title={note[value]}
    >
      <Hexagon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      {value} confidence
    </span>
  );
}

function ShapChart({ cell }: { cell: CellScore }) {
  if (!cell.factors.length) {
    return (
      <p className="text-[11.5px] leading-relaxed text-ink/50">
        Feature contribution data was not exported for this cell.
      </p>
    );
  }
  const max = Math.max(...cell.factors.map((f) => Math.abs(f.value)));
  return (
    <div role="img" aria-label={`Why this score: factors for cell ${cell.id}. ${cell.factors.map((f) => `${f.name} ${f.value > 0 ? "pushes up" : "pushes down"} by ${Math.abs(f.value)} points`).join("; ")}.`}>
      {cell.factors.map((f, i) => {
        const up = f.value >= 0;
        const w = (Math.abs(f.value) / max) * (up ? 58 : 40);
        return (
          <div key={f.name} className="grid grid-cols-[128px_1fr] items-center gap-3 py-[5px]">
            <p className="truncate text-right text-[12px] text-ink/70" title={f.name}>
              {f.name}
            </p>
            <div className="relative h-[18px]">
              <span className="absolute top-0 bottom-0 left-[42%] w-px bg-navy/15" aria-hidden="true" />
              <motion.div
                key={cell.id + f.name}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.9, delay: 0.1 + i * 0.09, ease: EASE.springy }}
                className={cn("absolute top-1 h-[10px] rounded-full", up ? "bg-brick" : "bg-steel")}
                style={
                  up
                    ? { left: "42%", width: `${w}%`, transformOrigin: "left center" }
                    : { right: "58%", width: `${w}%`, transformOrigin: "right center" }
                }
              />
              <span
                className="absolute top-0 text-[10.5px] font-medium text-ink/55"
                style={up ? { left: `calc(42% + ${w}% + 6px)` } : { right: `calc(58% + ${w}% + 6px)` }}
              >
                {up ? "+" : "−"}
                {Math.abs(f.value).toFixed(1)}
              </span>
            </div>
          </div>
        );
      })}
      <p className="mt-1 text-[10.5px] text-ink/45">
        Brick bars push the score up, blue bars pull it down. SHAP contributions, illustrative units.
      </p>
    </div>
  );
}

function ActionList({ cell }: { cell: CellScore }) {
  return (
    <ul className="grid gap-2">
      {SUGGESTED_ACTIONS.map((a, i) => (
        <li key={a} className="flex items-start gap-2.5 text-[13.5px] text-ink/80">
          <span className="mt-[1px] grid h-[18px] w-[18px] flex-none place-items-center rounded-md border border-teal/40 bg-teal/10">
            <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
              <motion.path
                key={cell.id + a}
                d="M2 6.4 L5 9 L10 3.4"
                fill="none"
                stroke="#2a7f8e"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.35 + i * 0.16, ease: "easeOut" }}
              />
            </svg>
          </span>
          {a}
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────── detail card ─────────────────────────── */

function DetailCard({ cell, scenario, scenarioOn }: { cell: CellScore; scenario: Partial<Record<ScenarioKey, boolean>>; scenarioOn: boolean }) {
  const score = scenarioScore(cell, scenario);
  const pct = useCountUp(score * 100, { duration: 1.1 });
  const emerging = isEmerging(cell) || !!cell.demo;
  const tier = tierOf(cell);
  const elevated = emerging ? tier >= 1 : cell.baseline >= 0.18;
  const percentileText = cell.demo
    ? PERCENTILE_LINE
    : `Riskier than ${(cell.percentile * 100).toFixed(cell.percentile > 0.98 ? 1 : 0)}% of cells with similar history`;

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-semibold tracking-[0.18em] text-ink/45 uppercase">Selected cell</p>
          <p className="mt-1 font-mono text-[12.5px] break-all text-navy">{cell.id}</p>
        </div>
        <ConfidenceBadge value={cell.confidence} />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3 border-b border-navy/8 pb-4">
        <div aria-live="polite">
          <p className="font-serif text-[46px] leading-none font-semibold text-navy tabular-nums">
            {pct.toFixed(1)}
            <span className="text-[24px] text-ink/50">%</span>
          </p>
          <p className="mt-2 max-w-[24ch] text-[11.5px] leading-snug text-ink/55">
            modelled chance of ≥{METRICS.blackspotThreshold} crashes next year · {cell.pastCrashes} past crash
            {cell.pastCrashes === 1 ? "" : "es"} on record
          </p>
        </div>
        <p className="max-w-[15ch] text-right text-[11.5px] leading-snug font-medium text-brass">{percentileText}</p>
      </div>

      {elevated ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-brass/45 bg-brass/10 px-3.5 py-2.5">
          <TriangleAlert className="h-4 w-4 flex-none text-brass" strokeWidth={1.8} aria-hidden="true" />
          <p className="text-[13px] font-semibold text-[#6d4d17]">Elevated risk — recommend a site audit</p>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-navy/12 bg-navy/[0.03] px-3.5 py-2.5">
          <Info className="h-4 w-4 flex-none text-ink/50" strokeWidth={1.8} aria-hidden="true" />
          <p className="text-[13px] font-medium text-ink/65">Lower relative risk — routine monitoring</p>
        </div>
      )}

      <div className="mt-5">
        <p className="mb-2 text-[12px] font-semibold tracking-[0.14em] text-ink/50 uppercase">Why this score?</p>
        <ShapChart cell={cell} />
      </div>

      <div className="mt-5">
        <p className="mb-2.5 text-[12px] font-semibold tracking-[0.14em] text-ink/50 uppercase">Suggested preventive actions</p>
        <ActionList cell={cell} />
      </div>

      <a
        href={`https://www.google.com/maps?q=${cell.lat},${cell.lng}`}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex items-center gap-1.5 self-start rounded-lg border border-navy/15 px-3 py-2 text-[12.5px] font-semibold text-navy transition-colors hover:border-brass hover:bg-brass/10"
      >
        Open in Google Maps
        <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      </a>

      {scenarioOn && (
        <p className="mt-4 rounded-lg bg-paper px-3 py-2 text-[11.5px] leading-snug text-ink/65">
          Scenario simulation, not a live forecast: this cell moves from {(cell.baseline * 100).toFixed(1)}% to{" "}
          {(score * 100).toFixed(1)}% under the active toggles.
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────── what-if panel ─────────────────────────── */

const TOGGLES: Array<{ key: ScenarioKey; title: string; desc: string; icon: typeof MoonStar }> = [
  { key: "night", title: "Night", desc: "more night exposure", icon: MoonStar },
  { key: "rain", title: "Rain", desc: "more rain exposure", icon: CloudRain },
  { key: "lowvis", title: "Low visibility", desc: "worse visibility (lower visibility value)", icon: CloudFog },
];

function WhatIfPanel({
  scenario,
  onToggle,
  cell,
  scenarioOn,
}: {
  scenario: Partial<Record<ScenarioKey, boolean>>;
  onToggle: (k: ScenarioKey, v: boolean) => void;
  cell: CellScore;
  scenarioOn: boolean;
}) {
  const base = cell.baseline * 100;
  const scen = scenarioScore(cell, scenario) * 100;
  const delta = scen - base;
  const bar = (v: number) => `${Math.min(100, (v / 40) * 100)}%`;

  return (
    <div className="border-t border-navy/10 bg-paper/70 px-5 py-5 lg:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-serif text-[22px] font-semibold text-navy">What if?</h3>
          <span className="rounded-full border border-brass/50 bg-brass/12 px-3 py-1 text-[11px] font-semibold text-[#6d4d17]">
            Scenario simulation, not a live forecast
          </span>
        </div>
        <p className="text-[11.5px] text-ink/50">Toggles recolour the map · decreases are shown, never hidden</p>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1.25fr_0.9fr]">
        {/* toggles */}
        <div className="grid content-start gap-3.5">
          {TOGGLES.map(({ key, title, desc, icon: Icon }) => (
            <div key={key} className="flex items-center gap-3">
              <button
                role="switch"
                aria-checked={!!scenario[key]}
                aria-label={`${title} scenario`}
                onClick={() => onToggle(key, !scenario[key])}
                className="fx-switch"
              />
              <Icon className="h-4 w-4 text-ink/45" strokeWidth={1.6} aria-hidden="true" />
              <div className="leading-tight">
                <p className="text-[13.5px] font-semibold text-navy">{title}</p>
                <p className="text-[11.5px] text-ink/55">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* baseline vs scenario */}
        <div className="rounded-xl border border-navy/10 bg-white p-4">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-ink/45 uppercase">
            Selected cell {cell.id.slice(0, 9)}… · baseline vs scenario
          </p>
          {scenarioOn ? (
            <div className="mt-3 grid gap-3" role="img" aria-label={`Baseline ${base.toFixed(1)} percent, scenario ${scen.toFixed(1)} percent`}>
              {[
                { label: "Baseline", v: base, color: "#12203b" },
                { label: "Scenario", v: scen, color: "#b8893b" },
              ].map((r) => (
                <div key={r.label} className="grid grid-cols-[74px_1fr_52px] items-center gap-3">
                  <p className="text-[12px] font-medium text-ink/70">{r.label}</p>
                  <div className="h-2.5 overflow-hidden rounded-full bg-navy/8">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: r.color }}
                      initial={false}
                      animate={{ width: bar(r.v) }}
                      transition={{ duration: 0.9, ease: EASE.out }}
                    />
                  </div>
                  <p className="text-right text-[12.5px] font-semibold text-navy tabular-nums">{r.v.toFixed(1)}%</p>
                </div>
              ))}
              <p className="flex items-center gap-1.5 text-[12px] text-ink/70">
                {delta >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-brick" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-teal" strokeWidth={2} aria-hidden="true" />
                )}
                <span className="font-semibold text-navy tabular-nums">
                  {delta >= 0 ? "+" : "−"}
                  {Math.abs(delta).toFixed(1)} pts
                </span>
                {delta < 0 && <span>· Lower under this scenario: recorded conditions already include it.</span>}
                {delta >= 0 && <span>· moves are illustrative deltas, not a new forecast.</span>}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink/55">
              Switch on a stressor to simulate how scores shift. Deltas come from the scenario columns of the embedded
              cell table.
            </p>
          )}
        </div>

        {/* summary chips */}
        <div className="grid content-start gap-2.5">
          <AnimatePresence mode="popLayout">
            {scenarioOn ? (
              <motion.div
                key="on"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: EASE.out }}
                className="grid gap-2.5"
              >
                <div className="rounded-xl border border-navy/10 bg-white px-4 py-3">
                  <p className="font-serif text-[22px] leading-none font-semibold text-navy tabular-nums">
                    +{METRICS.scenarioMeanShiftAll.toFixed(1)} pts
                  </p>
                  <p className="mt-1 text-[11.5px] text-ink/55">mean change across all {METRICS.cellsScored.toLocaleString("en-US")} cells</p>
                </div>
                <div className="rounded-xl border border-brass/40 bg-brass/10 px-4 py-3">
                  <p className="font-serif text-[22px] leading-none font-semibold text-[#6d4d17] tabular-nums">
                    +{METRICS.scenarioMeanShiftEmerging.toFixed(1)} pts
                  </p>
                  <p className="mt-1 text-[11.5px] text-ink/60">mean change across the {METRICS.emergingRiskCells} emerging-risk cells</p>
                </div>
                <p className="text-[11px] leading-snug text-ink/50">
                  Some cells score lower under a scenario — that is reported plainly, e.g. where recorded conditions
                  already include it.
                </p>
              </motion.div>
            ) : (
              <motion.p
                key="off"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[12px] leading-relaxed text-ink/50"
              >
                Summary chips appear here when a scenario is active. Night dims the basemap; rain adds streaks; low
                visibility adds fog — the marker colours and sizes follow the simulated scores.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── main section ─────────────────────────── */

const CONF_OPTS: Array<"All" | Confidence> = ["All", "High", "Medium", "Low"];

export default function LivePreview() {
  const { reduced } = useMotion();
  const [scenario, setScenario] = useState<Partial<Record<ScenarioKey, boolean>>>({});
  const [confidence, setConfidence] = useState<"All" | Confidence>("All");
  const [maxPast, setMaxPast] = useState(6);
  const [emergingOnly, setEmergingOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(ALL_CELLS[0].id);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);

  const scenarioOn = !!(scenario.night || scenario.rain || scenario.lowvis);

  const filtered = useMemo(
    () =>
      ALL_CELLS.filter(
        (c) =>
          (confidence === "All" || c.confidence === confidence) &&
          c.pastCrashes <= maxPast &&
          (!emergingOnly || isEmerging(c) || !!c.demo),
      ),
    [confidence, maxPast, emergingOnly],
  );

  // keep the selection valid as filters change
  useEffect(() => {
    if (filtered.length && !filtered.some((c) => c.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  // guided tour
  useEffect(() => {
    if (tourStep === null) return;
    setSelectedId(TOUR_STEPS[tourStep].cellId);
    const t = window.setTimeout(
      () => setTourStep((s) => (s === null ? null : s + 1 >= TOUR_STEPS.length ? null : s + 1)),
      reduced ? 999999 : 5600,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTourStep(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [tourStep, reduced]);

  const selected = useMemo(() => ALL_CELLS.find((c) => c.id === selectedId) ?? ALL_CELLS[0], [selectedId]);

  const onToggle = (k: ScenarioKey, v: boolean) => setScenario((s) => ({ ...s, [k]: v }));

  return (
    <section id="preview" className="scroll-mt-20 bg-paper/60">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-24 lg:px-8 lg:py-32">
        <SectionHead
          kicker="Live preview"
          title="The working prototype, in your browser."
          lede="A snapshot of the Houston scoring run. Blue dots are top-scoring cells; teal, amber and brick dots are emerging-risk cells banded by their percentile among cells with similar crash history. The 45 markers shown are an illustrative subset — the three guided-tour cells are real rows from the run."
        />

        <HexIris className="mt-14">
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 70, rotateX: 9, transformPerspective: 1400 }}
            whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ duration: 1.15, ease: EASE.out }}
            className="overflow-hidden rounded-xl border border-navy/12 bg-white shadow-[var(--shadow-lift)]"
          >
            {/* window chrome */}
            <div className="flex items-center gap-3 border-b border-navy/10 bg-ivory px-4 py-2.5">
              <span className="flex gap-1.5" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-brass/60" />
              </span>
              <span className="hidden min-w-0 flex-1 items-center justify-center sm:flex">
                <span className="truncate rounded-md border border-navy/10 bg-white px-3 py-1 font-mono text-[11px] text-ink/55">
                  risk-engine.preview/houston · embedded snapshot of cell_scores.csv
                </span>
              </span>
              <button
                onClick={() => setTourStep((s) => (s === null ? 0 : null))}
                className={cn(
                  "ml-auto inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-colors",
                  tourStep !== null ? "bg-brick text-ivory hover:bg-brick/90" : "bg-navy text-ivory hover:bg-navy-soft",
                )}
                aria-pressed={tourStep !== null}
              >
                {tourStep !== null ? (
                  <>
                    <Square className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Stop tour
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> Demo mode
                  </>
                )}
              </button>
            </div>

            {/* body */}
            <div className="grid lg:grid-cols-[minmax(0,1fr)_392px]">
              {/* map column */}
              <div
                ref={mapWrapRef}
                className={cn("relative h-[400px] min-h-[320px] sm:h-[480px] lg:h-[600px]", !reduced && "cursor-none")}
                role="application"
                aria-label="Map of Houston showing scored hex cells. Use the filters and markers to explore; every marker is a focusable button."
              >
                <HoustonMap
                  cells={filtered}
                  scenario={scenario}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onTilesFailed={() => setTilesFailed(true)}
                />

                {/* scenario overlays (above tiles, below markers) */}
                <AnimatePresence>
                  {scenario.night && (
                    <motion.div key="night" className="map-fx" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} aria-hidden="true">
                      <div className="map-fx fx-night" />
                      <div className="map-fx fx-stars" />
                    </motion.div>
                  )}
                  {scenario.rain && (
                    <motion.div key="rain" className="map-fx fx-rain" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} aria-hidden="true" />
                  )}
                  {scenario.lowvis && (
                    <motion.div key="fog" className="map-fx fx-fog" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9 }} aria-hidden="true" />
                  )}
                </AnimatePresence>

                {/* friendly tile fallback notice */}
                {tilesFailed && (
                  <div className="absolute top-3 left-1/2 z-[705] -translate-x-1/2 cursor-auto rounded-lg border border-navy/15 bg-ivory/95 px-3.5 py-2 text-[11.5px] font-medium text-ink/70 shadow-[var(--shadow-card)]">
                    Map tiles unavailable — showing the hex-grid fallback. Markers remain faithful.
                  </div>
                )}

                {/* legend */}
                <div className="absolute bottom-3 left-3 z-[610] max-w-[220px] cursor-auto rounded-lg border border-navy/10 bg-white/92 p-3 text-[11px] leading-relaxed shadow-[var(--shadow-card)] backdrop-blur-sm">
                  <p className="mb-1.5 font-semibold tracking-[0.14em] text-ink/50 uppercase">Legend</p>
                  <p className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-steel" aria-hidden="true" /> Top-scoring cells</p>
                  <p className="mt-1 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-teal" aria-hidden="true" /> Emerging · watch list</p>
                  <p className="mt-1 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber" aria-hidden="true" /> Emerging · elevated</p>
                  <p className="mt-1 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-brick" aria-hidden="true" /> Emerging · audit first</p>
                  <p className="mt-1.5 text-ink/45">Illustrative subset · banded by percentile among similar-history cells</p>
                </div>

                {/* guided tour caption */}
                <AnimatePresence>
                  {tourStep !== null && (
                    <motion.div
                      key={tourStep}
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 12 }}
                      transition={{ duration: 0.55, ease: EASE.out }}
                      className="absolute inset-x-3 bottom-3 z-[615] mx-auto max-w-[560px] cursor-auto rounded-xl border border-navy/12 bg-navy/92 px-4 py-3.5 text-ivory shadow-[var(--shadow-lift)] backdrop-blur-sm sm:bottom-5"
                      role="status"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[13px] leading-snug">{TOUR_STEPS[tourStep].caption}</p>
                        <button
                          onClick={() => setTourStep((s) => (s === null ? null : s + 1 >= TOUR_STEPS.length ? null : s + 1))}
                          className="flex-none rounded-md border border-ivory/30 px-2.5 py-1 text-[11px] font-semibold hover:bg-ivory/10"
                        >
                          {tourStep + 1 >= TOUR_STEPS.length ? "Done" : "Next"}
                        </button>
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5" aria-hidden="true">
                        {TOUR_STEPS.map((_, i) => (
                          <span key={i} className={cn("h-1 flex-1 rounded-full", i <= tourStep ? "bg-brass" : "bg-ivory/20")} />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <MapCursor container={mapWrapRef} />
              </div>

              {/* right column: filters + detail */}
              <div className="grid content-start gap-4 border-t border-navy/10 bg-ivory/60 p-4 lg:border-t-0 lg:border-l">
                <div className="card p-4">
                  <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.14em] text-ink/50 uppercase">
                    <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" /> Filters
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Confidence filter">
                    {CONF_OPTS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setConfidence(c)}
                        aria-pressed={confidence === c}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
                          confidence === c ? "border-navy bg-navy text-ivory" : "border-navy/15 bg-white text-ink/65 hover:border-navy/35",
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <label className="mt-4 block">
                    <span className="flex justify-between text-[12px] font-medium text-ink/70">
                      Max past crashes
                      <span className="font-semibold text-navy tabular-nums">{maxPast >= 6 ? "any" : `≤ ${maxPast}`}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={6}
                      step={1}
                      value={maxPast}
                      onChange={(e) => setMaxPast(Number(e.target.value))}
                      className="risk-range mt-2 w-full"
                      style={{ ["--fill" as never]: `${(maxPast / 6) * 100}%` }}
                      aria-label="Maximum past crashes"
                    />
                  </label>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <p className="text-[12.5px] font-medium text-ink/70">
                      Emerging only
                      <span className="block text-[10.5px] font-normal text-ink/45">thin history, high percentile</span>
                    </p>
                    <button
                      role="switch"
                      aria-checked={emergingOnly}
                      aria-label="Show emerging-risk cells only"
                      onClick={() => setEmergingOnly((v) => !v)}
                      className="fx-switch"
                    />
                  </div>
                  <p className="mt-3.5 border-t border-navy/8 pt-3 text-[11px] leading-snug text-ink/50">
                    Showing <strong className={cn("font-semibold", filtered.length ? "text-navy" : "text-brick")}>{filtered.length}</strong> of{" "}
                    {ALL_CELLS.length} illustrative markers · {METRICS.cellsScored.toLocaleString("en-US")} cells scored in the
                    backtest.
                  </p>
                </div>

                {/* key forces remount so bars/ticks/count replay per selection */}
                <DetailCard key={selected.id} cell={selected} scenario={scenario} scenarioOn={scenarioOn} />
              </div>
            </div>

            {/* what-if */}
            <WhatIfPanel scenario={scenario} onToggle={onToggle} cell={selected} scenarioOn={scenarioOn} />

            {/* window footnote */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-navy/10 bg-ivory px-5 py-3 text-[11px] text-ink/50">
              <span className="inline-flex items-center gap-1.5">
                <CheckCheck className="h-3.5 w-3.5 text-teal" strokeWidth={2} aria-hidden="true" />
                Confidence badge on every cell — emerging-risk cells are Low by design.
              </span>
              <span>Scenario simulation, not a live forecast.</span>
              <span className="ml-auto">Prototype · Houston, TX · US Accidents</span>
            </div>
          </motion.div>
        </HexIris>

        <SectionNote />
      </div>
    </section>
  );
}
