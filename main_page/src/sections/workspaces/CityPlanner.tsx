import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wrench, ArrowRight, PiggyBank, Info } from "lucide-react";
import { SectionHead, SectionNote } from "../../components/ui";
import { useMotion, EASE } from "../../lib/motion";
import { tierOf, TIER_META } from "../../data/engine";
import { INTERVENTIONS, PLANNER_PORTFOLIO, WATCH_BAND, interventionShift, type Intervention } from "../../data/roles";
import { cn } from "../../utils/cn";

const SCALE_MAX = 36; // % shown on the dumbbell track

/**
 * +1 feature for City Planners — bundle corridor upgrades and preview the
 * simulated shift on the priority portfolio, before budget season. Reductions
 * are illustrative engineering priors (matched to each cell's SHAP factors),
 * clearly labelled as simulation, not measurement.
 */
export default function CityPlanner() {
  const { reduced } = useMotion();
  const [on, setOn] = useState<string[]>([]);

  const chosen: Intervention[] = INTERVENTIONS.filter((iv) => on.includes(iv.key));
  const anyOn = chosen.length > 0;

  const rows = useMemo(
    () =>
      PLANNER_PORTFOLIO.map((c) => {
        const base = c.baseline * 100;
        const post = Math.max(0.4, base + interventionShift(c, chosen));
        return { cell: c, base, post };
      }),
    [chosen],
  );

  const stats = useMemo(() => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mb = mean(rows.map((r) => r.base));
    const mp = mean(rows.map((r) => r.post));
    return {
      mb,
      mp,
      watchBase: rows.filter((r) => r.base >= WATCH_BAND * 100).length,
      watchPost: rows.filter((r) => r.post >= WATCH_BAND * 100).length,
    };
  }, [rows]);

  const toggle = (key: string) => setOn((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const x = (v: number) => `${Math.min(100, (v / SCALE_MAX) * 100)}%`;

  return (
    <section id="workspace" className="scroll-mt-20 bg-white">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-24 lg:px-8 lg:py-32">
        <SectionHead
          kicker="Signed in · City Planner — your +1 feature"
          title="Intervention Studio."
          lede="Bundle upgrades and see the priority portfolio move — simulated before/after on the same cells the map ranks. Scenario simulation, not a live forecast; priors, not measured effects."
        />

        <div className="mt-14 grid items-start gap-6 lg:grid-cols-[0.85fr_1.3fr]">
          {/* intervention switches */}
          <div className="grid content-start gap-4">
            {INTERVENTIONS.map((iv) => {
              const active = on.includes(iv.key);
              const hits = PLANNER_PORTFOLIO.filter((c) =>
                c.factors.some((f) => iv.matches.includes(f.name.toLowerCase())),
              ).length;
              return (
                <button
                  key={iv.key}
                  role="switch"
                  aria-checked={active}
                  onClick={() => toggle(iv.key)}
                  className={cn(
                    "card flex items-start gap-4 p-5 text-left transition-all duration-300",
                    active && "border-teal/50 shadow-[var(--shadow-lift)]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-xl border transition-colors",
                      active ? "border-teal/40 bg-teal/12 text-teal" : "border-navy/12 bg-ivory text-ink/50",
                    )}
                  >
                    <Wrench className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <span className="flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold text-navy">{iv.label}</span>
                      <span className="font-semibold text-teal tabular-nums">{iv.pts.toFixed(1)} pts</span>
                    </span>
                    <span className="mt-1 block text-[12.5px] text-ink/55">
                      {iv.detail} · directly addresses {hits} of {PLANNER_PORTFOLIO.length} portfolio cells
                    </span>
                  </span>
                </button>
              );
            })}

            <div className="rounded-xl border border-brass/40 bg-brass/8 p-4 text-[12px] leading-relaxed text-[#6d4d17]">
              <p className="flex gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={1.8} aria-hidden="true" />
                Simulated reductions are illustrative engineering priors matched to each cell's SHAP factors — cells
                whose risk is driven by the treated mechanism respond fully, others partially. Not measured effects.
              </p>
            </div>

            {/* portfolio chips */}
            <AnimateChips anyOn={anyOn} stats={stats} />
          </div>

          {/* dumbbell before/after */}
          <div className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] font-semibold tracking-[0.16em] text-ink/50 uppercase">
                Priority portfolio · {PLANNER_PORTFOLIO.length} cells (illustrative subset)
              </p>
              <div className="flex items-center gap-4 text-[11.5px] font-medium text-ink/60">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-navy/35" aria-hidden="true" /> Baseline</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal" aria-hidden="true" /> Simulated after</span>
              </div>
            </div>

            <div className="mt-6 grid gap-4" role="img" aria-label={`Before-after chart. Portfolio mean ${stats.mb.toFixed(1)} percent baseline versus ${stats.mp.toFixed(1)} percent simulated.`}>
              {rows.map(({ cell, base, post }) => {
                const tier = TIER_META[tierOf(cell)];
                return (
                  <div key={cell.id} className="grid grid-cols-[minmax(0,150px)_1fr] items-center gap-4">
                    <p className="truncate font-mono text-[11.5px] text-ink/70" title={cell.id}>
                      {cell.id}
                      <span className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: tier.hex }} aria-hidden="true" />
                    </p>
                    <div className="relative h-7">
                      {/* track + watch band marker */}
                      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-navy/10" aria-hidden="true" />
                      <span
                        className="absolute top-0 bottom-0 border-l border-dashed border-brick/40"
                        style={{ left: x(WATCH_BAND * 100) }}
                        title={`Watch band at ${(WATCH_BAND * 100).toFixed(0)}%`}
                        aria-hidden="true"
                      />
                      {/* connector */}
                      <motion.span
                        className="absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-teal/30"
                        initial={false}
                        animate={{ left: x(Math.min(base, post)), width: `calc(${x(Math.abs(base - post))} )` }}
                        transition={{ duration: reduced ? 0 : 0.8, ease: EASE.out }}
                        aria-hidden="true"
                      />
                      {/* baseline dot */}
                      <motion.span
                        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-navy/35"
                        initial={false}
                        animate={{ left: x(base) }}
                        transition={{ duration: reduced ? 0 : 0.8, ease: EASE.out }}
                        aria-hidden="true"
                      />
                      {/* simulated dot */}
                      <motion.span
                        className="absolute top-1/2 grid h-4.5 w-4.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-teal shadow"
                        initial={false}
                        animate={{ left: x(post) }}
                        transition={{ duration: reduced ? 0 : 0.8, ease: EASE.out }}
                        aria-hidden="true"
                      />
                      {/* value labels */}
                      <span className="absolute top-1/2 -translate-y-1/2 text-[10.5px] font-semibold text-ink/45 tabular-nums" style={{ left: `calc(${x(base)} - 44px)` }}>
                        {base.toFixed(1)}%
                      </span>
                      <span
                        className="absolute top-1/2 -translate-y-1/2 text-[10.5px] font-bold text-teal tabular-nums"
                        style={{ left: `calc(${x(post)} + 10px)` }}
                      >
                        {anyOn ? `${post.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-navy/8 pt-4 text-[11px] text-ink/50">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-px border-l border-dashed border-brick/50" aria-hidden="true" />
                Dashed line: audit watch band (≥{(WATCH_BAND * 100).toFixed(0)}%)
              </span>
              <span>Sequencing hint: interventions deliver deeper cuts on cells whose SHAP factors they treat.</span>
            </p>
          </div>
        </div>

        <SectionNote />
      </div>
    </section>
  );
}

function AnimateChips({ anyOn, stats }: { anyOn: boolean; stats: { mb: number; mp: number; watchBase: number; watchPost: number } }) {
  const delta = stats.mp - stats.mb;
  return (
    <div className="card grid gap-3 p-5">
      <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.16em] text-ink/50 uppercase">
        <PiggyBank className="h-4 w-4 text-brass" strokeWidth={1.7} aria-hidden="true" />
        Portfolio summary
      </p>
      {anyOn ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="rounded-lg bg-navy/5 px-3 py-1.5 font-semibold text-navy tabular-nums">{stats.mb.toFixed(1)}%</span>
            <ArrowRight className="h-3.5 w-3.5 text-ink/40" strokeWidth={2} aria-hidden="true" />
            <span className="rounded-lg bg-teal/12 px-3 py-1.5 font-semibold text-teal tabular-nums">{stats.mp.toFixed(1)}%</span>
            <span className="text-ink/55">portfolio mean ·</span>
            <span className="font-semibold text-teal tabular-nums">{delta.toFixed(1)} pts</span>
          </div>
          <p className="text-[12px] text-ink/60">
            Cells inside the audit watch band: <strong className="font-semibold text-navy">{stats.watchBase}</strong> baseline →{" "}
            <strong className="font-semibold text-teal">{stats.watchPost}</strong> simulated.
          </p>
        </>
      ) : (
        <p className="text-[12.5px] text-ink/55">Switch on an upgrade to simulate the portfolio shift.</p>
      )}
      <p className="text-[10.5px] leading-snug text-ink/40">Simulation only — feeds the same "what-if" engine as the public map.</p>
    </div>
  );
}
