import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Radio, MoonStar, Sun, Timer, ArrowUpRight, Minus } from "lucide-react";
import { SectionHead, SectionNote } from "../../components/ui";
import { useMotion, EASE } from "../../lib/motion";
import { tierOf, TIER_META } from "../../data/engine";
import { AUDIT_CANDIDATES, DEPOT, kmBetween, nightWeight, nextShiftStart, presenceScore } from "../../data/roles";
import { cn } from "../../utils/cn";

const SCALE_MAX = 36;
const PATROL_KMH = 30;

const fmtClock = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/**
 * +1 feature for Traffic Police — a clock-aware presence planner. Nowhere does
 * it claim a crash "will" happen: it re-weights the same elevated-risk scores
 * by night exposure for the hours a crew is actually on shift. Live values
 * derive from the device clock and the embedded cell snapshot.
 */
export default function TrafficPolice() {
  const { reduced } = useMotion();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const w = nightWeight(now);
  const night = w > 0;

  const rows = useMemo(
    () =>
      AUDIT_CANDIDATES.map((c) => ({ cell: c, live: presenceScore(c, w), base: c.baseline * 100 }))
        .sort((a, b) => b.live - a.live)
        .slice(0, 6),
    [w],
  );

  const untilShift = nextShiftStart(now).getTime() - now.getTime();
  const hourFrac = (now.getHours() + now.getMinutes() / 60) / 24;

  return (
    <section id="workspace" className="scroll-mt-20 bg-white">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-24 lg:px-8 lg:py-32">
        <SectionHead
          kicker="Signed in · Traffic Police — your +1 feature"
          title="Live Shift Radar."
          lede="The same elevated-risk cells, re-weighted for the hours you're actually outside. Night exposure ramps in at dusk and out at dawn — the ranking follows your clock, live. Presence is preventive deterrence; nothing here predicts that a crash will happen."
        />

        {/* live status bar */}
        <div className="card mt-14 flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
          <span className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brick opacity-60 [animation-duration:1.6s]" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brick" />
            </span>
            <span className="text-[12px] font-bold tracking-[0.22em] text-brick uppercase">Live</span>
          </span>
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-navy tabular-nums">
            <Radio className="h-4 w-4 text-ink/40" strokeWidth={1.7} aria-hidden="true" />
            as of {fmtClock(now)}
          </p>
          <p
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold",
              night ? "border-navy/25 bg-navy text-ivory" : "border-amber/40 bg-amber/12 text-[#8a5510]",
            )}
          >
            {night ? <MoonStar className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" /> : <Sun className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
            {w === 1 ? "Night weight ×1.00 — full exposure" : w === 0 ? "Daylight — watch-list mode" : `Transition · night weight ×${w.toFixed(2)}`}
          </p>
          <p className="ml-auto flex items-center gap-2 text-[12.5px] text-ink/60 tabular-nums">
            <Timer className="h-4 w-4 text-brass" strokeWidth={1.7} aria-hidden="true" />
            next night window (18:00) in <span className="font-semibold text-navy">{fmtCountdown(untilShift)}</span>
          </p>
        </div>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.35fr_0.75fr]">
          {/* ranked presence points */}
          <div className="card p-6">
            <p className="text-[12px] font-semibold tracking-[0.16em] text-ink/50 uppercase">
              Recommended presence points · re-ranked {night ? "for now" : "(they will re-weight at dusk)"}
            </p>
            <ol className="mt-5 grid gap-4">
              {rows.map(({ cell, live, base }, i) => {
                const tier = TIER_META[tierOf(cell)];
                const d = live - base;
                const eta = (kmBetween(DEPOT, cell) / PATROL_KMH) * 60;
                return (
                  <motion.li
                    key={cell.id}
                    layout
                    transition={{ duration: reduced ? 0 : 0.5, ease: EASE.out }}
                    className="grid grid-cols-[26px_1fr] items-start gap-3"
                  >
                    <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-navy font-serif text-[12px] font-semibold text-ivory">
                      {i + 1}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-[12.5px] font-semibold text-navy">{cell.id}</span>
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: tier.hex }} title={tier.label} aria-hidden="true" />
                        {Math.abs(d) < 0.05 ? (
                          <span className="flex items-center gap-1 text-[11px] font-medium text-ink/45">
                            <Minus className="h-3 w-3" strokeWidth={2} aria-hidden="true" /> daylight — no night weight
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-brick tabular-nums">
                            <ArrowUpRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />+{d.toFixed(1)} pts right now (night weight)
                          </span>
                        )}
                        <span className="ml-auto text-[11px] text-ink/45 tabular-nums">≈{Math.round(eta)} min from depot</span>
                      </div>
                      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-navy/8">
                        <motion.div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ background: tier.hex }}
                          initial={false}
                          animate={{ width: `${Math.min(100, (live / SCALE_MAX) * 100)}%` }}
                          transition={{ duration: reduced ? 0 : 0.7, ease: EASE.out }}
                        />
                        <span
                          className="absolute inset-y-0 w-px bg-navy/50"
                          style={{ left: `${Math.min(100, (base / SCALE_MAX) * 100)}%` }}
                          title={`Baseline ${base.toFixed(1)}%`}
                          aria-hidden="true"
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-ink/50 tabular-nums">
                        presence priority {live.toFixed(1)} · baseline {base.toFixed(1)} · confidence {cell.confidence}
                      </p>
                    </div>
                  </motion.li>
                );
              })}
            </ol>
            <p className="mt-6 border-t border-navy/8 pt-4 text-[11.5px] leading-relaxed text-ink/50">
              Presence points are deterrence-oriented suggestions derived from elevated-risk scores — they do not
              predict that a crash will happen at any location. Connect a weather feed later to weight rain the same
              way the clock weights night.
            </p>
          </div>

          {/* 24h strip + explainer */}
          <div className="grid content-start gap-5">
            <div className="card p-5">
              <p className="text-[12px] font-semibold tracking-[0.16em] text-ink/50 uppercase">Your clock · 24h</p>
              <div className="relative mt-4 h-11 overflow-hidden rounded-lg border border-navy/10" aria-hidden="true">
                {/* daylight base */}
                <span className="absolute inset-0 bg-amber/14" />
                {/* night bands 18→24 & 0→6, dusk/dawn ramps */}
                <span className="absolute inset-y-0 left-0 w-[25%] bg-navy/85" />
                <span className="absolute inset-y-0 right-0 w-[25%] bg-navy/85" />
                <span className="absolute inset-y-0 w-[8.33%] bg-gradient-to-r from-navy/85 to-transparent" style={{ left: "20.8%" }} />
                <span className="absolute inset-y-0 w-[8.33%] bg-gradient-to-l from-navy/85 to-transparent" style={{ right: "29.2%" }} />
                {/* now marker */}
                <span className="absolute inset-y-0 w-[2px] bg-brick" style={{ left: `${hourFrac * 100}%` }} />
                <span className="absolute top-1 h-2 w-2 -translate-x-1/2 rotate-45 bg-brick" style={{ left: `${hourFrac * 100}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] font-medium text-ink/45 tabular-nums">
                {["00", "06", "12", "18", "24"].map((h) => (
                  <span key={h}>{h}:00</span>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-ink/55">
                The brick marker is now. Night weight is ×1.00 in the dark bands and ramps through dusk (17:00–19:00)
                and dawn (05:00–07:00).
              </p>
            </div>

            <div className="rounded-xl border border-brass/40 bg-brass/8 p-5">
              <p className="text-[12px] font-semibold tracking-[0.16em] text-[#8a5510] uppercase">On shift now?</p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink/70">
                {w === 1
                  ? "Full night weight is active — the top cells earn their positions on exposure, not on sirens. Short, visible presence passes are the deterrent."
                  : w === 0
                    ? "Daylight: the list holds tonight's order in preview. It will re-weight automatically as dusk approaches."
                    : "Exposure is ramping — the ranking is moving minute by minute; re-check before each pass."}
              </p>
            </div>
          </div>
        </div>

        <SectionNote />
      </div>
    </section>
  );
}
