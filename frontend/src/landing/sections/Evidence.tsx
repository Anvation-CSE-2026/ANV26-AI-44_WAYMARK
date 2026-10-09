import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Scale, FileWarning, Sigma } from "lucide-react";
import { METRICS } from "../data/engine";
import { SectionHead, SectionNote, useCountUp, useInViewOnce } from "../components/ui";
import { useMotion } from "../lib/motion";
import { cn } from "../utils/cn";

gsap.registerPlugin(ScrollTrigger);

/**
 * Evidence — exact backtest values, read from METRICS (the metrics.json
 * snapshot). Bars are normalised within each metric so the two series can be
 * compared; the printed labels are always the exact numbers.
 */

const PAIRS = [
  {
    key: "auc",
    label: "AUC — ranking quality",
    hint: "higher is better · 0.5 = chance",
    history: METRICS.lowHistory.auc.history,
    model: METRICS.lowHistory.auc.model,
    fmt: (v: number) => v.toFixed(3),
    max: 0.75,
  },
  {
    key: "p5",
    label: "Precision at top 5%",
    hint: "share of flagged cells that became blackspots",
    history: METRICS.lowHistory.precisionTop5.history,
    model: METRICS.lowHistory.precisionTop5.model,
    fmt: (v: number) => `${(v * 100).toFixed(1)}%`,
    max: 0.1,
  },
  {
    key: "c10",
    label: "Capture at top 10%",
    hint: "share of future blackspots caught",
    history: METRICS.lowHistory.captureTop10.history,
    model: METRICS.lowHistory.captureTop10.model,
    fmt: (v: number) => `${(v * 100).toFixed(1)}%`,
    max: 0.28,
  },
] as const;

function BarChart() {
  const { reduced } = useMotion();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(".ev-bar").forEach((bar, i) => {
        gsap.fromTo(
          bar,
          { width: 0 },
          {
            width: bar.dataset.w ?? "0%",
            duration: 1.15,
            delay: i * 0.09,
            ease: "expo.out",
            scrollTrigger: { trigger: bar, start: "top 88%", once: true },
          },
        );
      });
    }, root);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <div
      ref={ref}
      className="card p-6 sm:p-8"
      role="img"
      aria-label={`Grouped bar chart for low-history cells. AUC: history ${METRICS.lowHistory.auc.history} versus model ${METRICS.lowHistory.auc.model}. Precision at top five percent: ${METRICS.lowHistory.precisionTop5.history} versus ${METRICS.lowHistory.precisionTop5.model}. Capture at top ten percent: ${METRICS.lowHistory.captureTop10.history} versus ${METRICS.lowHistory.captureTop10.model}.`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] font-semibold tracking-[0.16em] text-ink/50 uppercase">
          Low-history cells only (≤2 past crashes) · backtest {METRICS.trainWindow} → {METRICS.testWindow}
        </p>
        <div className="flex items-center gap-4 text-[11.5px] font-medium text-ink/60">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-6 rounded-full bg-navy/25" aria-hidden="true" /> History only</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-6 rounded-full bg-brass" aria-hidden="true" /> Our model</span>
        </div>
      </div>

      <div className="mt-7 grid gap-7">
        {PAIRS.map((row) => (
          <div key={row.key}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[14.5px] font-semibold text-navy">{row.label}</p>
              <p className="text-[11px] text-ink/45">{row.hint}</p>
            </div>
            <div className="mt-2.5 grid gap-2">
              {(
                [
                  ["History only", row.history, "bg-navy/25 text-ink/60"],
                  ["Our model", row.model, "bg-brass text-navy"],
                ] as const
              ).map(([name, v, cls]) => (
                <div key={name} className="grid grid-cols-[92px_1fr_64px] items-center gap-3">
                  <p className="text-[11.5px] text-ink/55">{name}</p>
                  <div className="h-3.5 overflow-hidden rounded-full bg-navy/[0.06]">
                    <div
                      className={cn("ev-bar h-full rounded-full", cls.split(" ")[0])}
                      data-w={`${(v / row.max) * 100}%`}
                      style={reduced ? { width: `${(v / row.max) * 100}%` } : { width: 0 }}
                    />
                  </div>
                  <p className={cn("text-right text-[13px] font-semibold tabular-nums", name === "Our model" ? "text-navy" : "text-ink/50")}>
                    {row.fmt(v)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 border-t border-navy/8 pt-4 text-[11px] text-ink/45">
        Bars are scaled per metric for legibility; labels are the exact backtest values. Definition: blackspot = ≥
        {METRICS.blackspotThreshold} crashes in the following year.
      </p>
    </div>
  );
}

function TwoXCallout() {
  const { ref, inView } = useInViewOnce<HTMLDivElement>();
  const v = useCountUp(2, { duration: 1.5, active: inView }); // counts up to the exact reported "~2×"
  return (
    <div ref={ref} className="card relative overflow-hidden p-6 sm:p-8">
      <div className="absolute -top-10 -right-10 h-36 w-36 rounded-full bg-brass/10" aria-hidden="true" />
      <p className="text-[12px] font-semibold tracking-[0.16em] text-ink/50 uppercase">Capture · top 10% of low-history cells</p>
      <p className="mt-4 font-serif text-[76px] leading-none font-semibold text-navy tabular-nums" aria-label="About two times more">
        ~{v.toFixed(1).replace(/\.0$/, "")}×
      </p>
      <p className="mt-4 max-w-[30ch] text-[15px] leading-relaxed text-ink/75">
        more future blackspots found in the top 10% of low-history cells —{" "}
        <span className="font-semibold text-navy">
          {(METRICS.lowHistory.captureTop10.history * 100).toFixed(1)}% → {(METRICS.lowHistory.captureTop10.model * 100).toFixed(1)}%
        </span>{" "}
        capture.
      </p>
    </div>
  );
}

export default function Evidence() {
  const { reduced } = useMotion();
  const [underline, setUnderline] = useState(false);
  const { ref: caveatInViewRef, inView } = useInViewOnce<HTMLDivElement>();

  useEffect(() => {
    if (inView) {
      const t = window.setTimeout(() => setUnderline(true), reduced ? 0 : 350);
      return () => window.clearTimeout(t);
    }
  }, [inView, reduced]);

  return (
    <section id="evidence" className="scroll-mt-20 bg-ivory">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-24 lg:px-8 lg:py-32">
        <SectionHead
          kicker="Evidence"
          title="Does it beat crash history alone?"
          lede={`We backtested honestly: train on ${METRICS.trainWindow}, test on ${METRICS.testWindow}. Exactly where history runs out, the model earns its keep — and exactly overall, it doesn't claim miracles.`}
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <BarChart />
          <div className="grid content-start gap-6">
            <TwoXCallout />

            {/* calm tie card */}
            <div className="card flex items-start gap-4 p-6">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl border border-navy/12 bg-ivory">
                <Scale className="h-[18px] w-[18px] text-navy" strokeWidth={1.5} aria-hidden="true" />
              </span>
              <div>
                <p className="font-serif text-[19px] font-semibold text-navy">Overall, the model and history tie.</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink/70">
                  Across all {METRICS.cellsScored.toLocaleString("en-US")} cells, AUC is{" "}
                  <strong className="font-semibold text-navy">{METRICS.overall.aucModel.toFixed(2)}</strong> (model) vs{" "}
                  <strong className="font-semibold text-navy">{METRICS.overall.aucHistory.toFixed(2)}</strong> (history). The win is
                  specific: low-history cells, where audits otherwise never look.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* gold caveat — never hidden */}
        <div
          ref={caveatInViewRef}
          className="mt-8 rounded-xl border border-brass/40 bg-[#f7ecd9] p-6 sm:p-7"
        >
          <div className="flex items-start gap-4">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl border border-brass/50 bg-white/60">
              <FileWarning className="h-[18px] w-[18px] text-[#8a5510]" strokeWidth={1.5} aria-hidden="true" />
            </span>
            <div className="max-w-3xl">
              <p className="font-serif text-[19px] font-semibold text-[#5e4212]">Read this before believing any of it.</p>
              <p className="mt-2 text-[14px] leading-relaxed text-[#6d5220]">
                <span className="relative inline-block">
                  One city, one backtest, about {METRICS.lowHistoryBlackspots} blackspot cells.
                  <svg className="absolute -bottom-1 left-0 h-[6px] w-full" viewBox="0 0 300 6" preserveAspectRatio="none" aria-hidden="true">
                    <path
                      d="M2 4 C 80 1.5, 220 1.5, 298 3.5"
                      fill="none"
                      stroke="#b8893b"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeDasharray="300"
                      strokeDashoffset={underline ? 0 : 300}
                      style={{ transition: reduced ? "none" : "stroke-dashoffset 1.6s cubic-bezier(0.16,1,0.3,1)" }}
                    />
                  </svg>
                </span>{" "}
                Small samples swing. These numbers are <em>indicative, not proof</em> — they justify a wider study, not a rollout.
              </p>
              <p className="mt-3 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-[#8a5510] uppercase">
                <Sigma className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Indicative result · one city · one backtest
              </p>
            </div>
          </div>
        </div>

        <SectionNote />
      </div>
    </section>
  );
}
