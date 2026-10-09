import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FileSearch, Hourglass, ListChecks, MoveRight, ArrowDownRight } from "lucide-react";
import { METRICS, PROBLEM_DOTS } from "../data/engine";
import { SectionHead, SectionNote, useCountUp, useInViewOnce, fmtInt } from "../components/ui";
import { useMotion } from "../lib/motion";

gsap.registerPlugin(ScrollTrigger);

function Stat({ value, label, sub }: { value: number; label: string; sub?: string }) {
  const { ref, inView } = useInViewOnce<HTMLDivElement>();
  const v = useCountUp(value, { duration: 1.9, active: inView });
  return (
    <div ref={ref} className="rounded-xl border border-ivory/12 bg-white/[0.04] p-5">
      <p className="font-serif text-[40px] leading-none font-semibold text-ivory tabular-nums" aria-label={`${fmtInt(value)} — ${label}`}>
        {fmtInt(v)}
      </p>
      <p className="mt-2.5 text-[13.5px] leading-snug text-ivory/60">{label}</p>
      {sub && <p className="mt-1 text-[11.5px] tracking-wide text-brass-soft/90">{sub}</p>}
    </div>
  );
}

const POINTS = [
  {
    icon: FileSearch,
    title: "Little history looks safe on paper",
    body: `${fmtInt(METRICS.lowHistoryCells)} cells (${Math.round(
      METRICS.lowHistoryShare * 100,
    )}%) recorded ${METRICS.blackspotThreshold - 1} or fewer crashes. A history-only ranking quietly pushes them to the bottom — whatever is building there goes unseen.`,
  },
  {
    icon: Hourglass,
    title: "Reactive tools wait for crashes",
    body: `A blackspot earns its name only after ${METRICS.blackspotThreshold}+ crashes in a year. By then, people have already been hurt. The goal is an elevated-risk flag before the pile-up.`,
  },
  {
    icon: ListChecks,
    title: "Audits need prioritising",
    body: `${fmtInt(METRICS.cellsScored)} hex cells and a finite audit budget. The practical question is simple: where does the next site visit go?`,
  },
];

export default function Problem() {
  const { reduced } = useMotion();
  const secRef = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sec = secRef.current;
    if (!sec || reduced) return;

    const ctx = gsap.context(() => {
      const dots = gsap.utils.toArray<SVGCircleElement>(".pdot");
      const caption = sec.querySelector<HTMLElement>(".pcaption");
      const corridors = gsap.utils.toArray<SVGPathElement>(".pcorridor");

      const mm = gsap.matchMedia();
      mm.add(
        { isDesktop: "(min-width: 1024px)" },
        (mctx) => {
          const desktop = !!mctx.conditions?.isDesktop;

          if (desktop) {
            // Pinned, scrubbed storytelling: empty regions stay blank while
            // crash dots accumulate along corridors — then the caption lands.
            gsap.set(dots, { scale: 0, opacity: 0, transformOrigin: "50% 50%" });
            gsap.set(corridors, { opacity: 0.1 });
            gsap.set(caption, { opacity: 0, y: 14 });
            const tl = gsap.timeline({
              scrollTrigger: {
                trigger: sec,
                start: "top top",
                end: "+=135%",
                scrub: 0.7,
                pin: true,
                anticipatePin: 1,
              },
            });
            tl.to(corridors, { opacity: 0.4, duration: 0.18 }, 0.02);
            tl.to(dots, { scale: 1, opacity: 1, stagger: { each: 0.004, from: "start" }, duration: 0.6, ease: "none" }, 0.08);
            tl.to(caption, { opacity: 1, y: 0, duration: 0.22, ease: "power2.out" }, 0.72);
          } else {
            // Mobile: no pin, dots cascade once in view.
            gsap.set(dots, { scale: 0, opacity: 0, transformOrigin: "50% 50%" });
            gsap.set(caption, { opacity: 0 });
            gsap
              .timeline({ scrollTrigger: { trigger: mapRef.current, start: "top 75%", once: true } })
              .to(dots, { scale: 1, opacity: 1, stagger: { each: 0.006 }, duration: 0.8, ease: "power1.out" })
              .to(caption, { opacity: 1, duration: 0.6 }, "-=0.2");
          }
        },
      );
    }, sec);

    return () => ctx.revert();
  }, [reduced]);

  return (
    <section ref={secRef} id="problem" className="scroll-mt-20 bg-navy text-ivory">
      <div className="mx-auto flex min-h-screen w-full max-w-[1320px] flex-col justify-center px-5 py-24 lg:px-8">
        <SectionHead
          dark
          kicker="The problem"
          title="History alone misses emerging risk."
          lede="Rank streets by past crashes and you re-audit the same handful of hotspots — while the next blackspot quietly accumulates elsewhere. Scroll: watch a year of crash history pile up along a few corridors."
        />

        <div className="mt-12 grid items-stretch gap-8 lg:grid-cols-[1.15fr_1fr]">
          {/* stylised crash-dot map */}
          <div ref={mapRef} className="relative overflow-hidden rounded-xl border border-ivory/12 bg-navy-deep/80 p-4 sm:p-6">
            <div className="flex items-center justify-between pb-3">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-ivory/45 uppercase">
                One year of recorded crashes · stylised map
              </p>
              <span className="flex items-center gap-1.5 text-[11px] text-ivory/40">
                <span className="inline-block h-2 w-2 rounded-full bg-brick" aria-hidden="true" /> recorded crash
              </span>
            </div>
            <svg viewBox="0 0 100 62" className="w-full" role="img" aria-label="Stylised map: crash dots concentrate along three corridors while surrounding regions stay empty — little history is not the same as low risk.">
              {/* faint hex mesh */}
              {Array.from({ length: 7 }).map((_, r) =>
                Array.from({ length: 11 }).map((_, c) => (
                  <polygon
                    key={`${r}-${c}`}
                    points={hexPts(6 + c * 8.8 + (r % 2 ? 4.4 : 0), 5 + r * 7.6, 4)}
                    fill="none"
                    stroke="rgba(250,247,242,0.05)"
                    strokeWidth="0.25"
                  />
                )),
              )}
              <path className="pcorridor" d="M12,18.6 C 34,22 62,27 88,32.2" fill="none" stroke="#d98a2b" strokeOpacity="0.35" strokeWidth="0.5" strokeDasharray="1.4 1.2" />
              <path className="pcorridor" d="M30,5 C 34,24 38,42 42,58" fill="none" stroke="#d98a2b" strokeOpacity="0.35" strokeWidth="0.5" strokeDasharray="1.4 1.2" />
              <path className="pcorridor" d="M18,53 C 40,42 60,28 80,12.4" fill="none" stroke="#d98a2b" strokeOpacity="0.35" strokeWidth="0.5" strokeDasharray="1.4 1.2" />
              {PROBLEM_DOTS.map((d, i) => (
                <circle key={i} className="pdot" cx={d.x * 100} cy={d.y * 62} r={i % 9 === 0 ? 1.05 : 0.66} fill="#b3412f" fillOpacity={i % 9 === 0 ? 0.95 : 0.8} />
              ))}
            </svg>
            <p className="pcaption mt-4 border-l-2 border-brass pl-4 font-serif text-[19px] leading-snug text-ivory italic">
              “Little history is not the same as low risk — the empty regions simply haven’t been counted yet.”
            </p>
          </div>

          {/* points + counters */}
          <div className="flex flex-col gap-6">
            <ul className="grid gap-4">
              {POINTS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4 rounded-xl border border-ivory/10 bg-white/[0.03] p-4.5">
                  <Icon className="mt-0.5 h-5 w-5 flex-none text-brass-soft" strokeWidth={1.5} aria-hidden="true" />
                  <div>
                    <p className="text-[15.5px] font-semibold text-ivory">{title}</p>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-ivory/60">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Stat value={METRICS.cellsScored} label="hex cells scored across Houston" />
              <Stat value={METRICS.lowHistoryCells} label={`cells with ≤${METRICS.blackspotThreshold - 1} past crashes`} sub="29% of the city" />
              <Stat value={METRICS.emergingRiskCells} label="emerging-risk cells flagged" sub="all Low confidence — by design" />
            </div>
          </div>
        </div>

        {/* traditional vs emerging */}
        <div className="mt-10 grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-xl border border-ivory/12 bg-white/[0.03] p-5 opacity-85">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-ivory/45 uppercase">Traditional approach</p>
            <p className="mt-3 flex flex-wrap items-center gap-2 font-serif text-[18px] text-ivory/85">
              High crash history <MoveRight className="h-4 w-4 text-ivory/40" strokeWidth={1.6} aria-hidden="true" /> High attention
            </p>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ivory/50">
              Reactive — attention arrives only after the numbers are undeniable.
            </p>
          </div>
          <div className="hidden items-center md:flex" aria-hidden="true">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-brass/50 bg-brass/12">
              <ArrowDownRight className="h-4 w-4 text-brass-soft" strokeWidth={1.8} />
            </span>
          </div>
          <div className="rounded-xl border border-brass/50 bg-brass/10 p-5">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-brass-soft uppercase">WAYMARK</p>
            <p className="mt-3 flex flex-wrap items-center gap-2 font-serif text-[18px] text-ivory">
              Risk signals + limited history <MoveRight className="h-4 w-4 text-brass-soft" strokeWidth={1.6} aria-hidden="true" />{" "}
              <span className="text-brass-soft italic">Emerging blackspot</span>
            </p>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ivory/65">
              Proactive — elevated risk earns an audit recommendation while history is still thin.
            </p>
          </div>
        </div>

        <SectionNote dark className="hairline-light" />
      </div>
    </section>
  );
}

/** pointy-top hex points in svg viewBox units */
function hexPts(cx: number, cy: number, s: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((60 * k - 90) * Math.PI) / 180;
    pts.push(`${(cx + s * Math.cos(a)).toFixed(2)},${(cy + s * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}
