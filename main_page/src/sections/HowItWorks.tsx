import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motion } from "framer-motion";
import { SectionHead, SectionNote } from "../components/ui";
import { useMotion } from "../lib/motion";
import { METRICS } from "../data/engine";

gsap.registerPlugin(ScrollTrigger);

/* ── looping micro-icons (each animation explains its step) ── */

function IconIngest({ still }: { still: boolean }) {
  // data stream trickling into a tray
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden="true">
      {[10, 24, 38].map((x, i) => (
        <motion.circle
          key={x}
          cx={x}
          cy={6}
          r="2"
          fill="#b8893b"
          animate={still ? undefined : { cy: [6, 32], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.7, repeat: Infinity, delay: i * 0.4, ease: "easeIn" }}
        />
      ))}
      <path d="M6 34 h36 M10 34 v6 h28 v-6" fill="none" stroke="#12203b" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 40 h16" stroke="#2a7f8e" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconPrepare({ still }: { still: boolean }) {
  // raw stream settles into hex cells
  const hexes = [
    { x: 12, y: 20, c: "#2a7f8e" },
    { x: 24, y: 13, c: "#d98a2b" },
    { x: 36, y: 20, c: "#b3412f" },
  ];
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden="true">
      {hexes.map((h, i) => (
        <motion.polygon
          key={i}
          points={miniHex(h.x, h.y, 8.4)}
          fill="none"
          stroke={h.c}
          strokeWidth="1.6"
          style={{ originX: `${h.x}px`, originY: `${h.y}px` }}
          animate={still ? undefined : { scale: [0.35, 1, 1, 0.35], opacity: [0.25, 1, 1, 0.25] }}
          transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.5, ease: [0.34, 1.3, 0.64, 1] }}
        />
      ))}
      <path d="M8 38 h32" stroke="#12203b" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function IconModel({ still }: { still: boolean }) {
  // decision branches growing
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden="true">
      {["M24 44 V26", "M24 26 C24 18 14 18 12 8", "M24 26 C24 16 34 16 36 6", "M24 26 C24 22 28 22 30 14"].map((d, i) => (
        <motion.path
          key={d}
          d={d}
          fill="none"
          stroke={i === 0 ? "#12203b" : "#2a7f8e"}
          strokeWidth="1.6"
          strokeLinecap="round"
          animate={still ? { pathLength: 1 } : { pathLength: [0, 1, 1], opacity: [0.4, 1, 1] }}
          transition={{ duration: 2.8, repeat: Infinity, delay: i * 0.35, times: [0, 0.6, 1], ease: "easeOut" }}
        />
      ))}
      <circle cx="24" cy="44" r="2.4" fill="#b8893b" />
    </svg>
  );
}

function IconExplain({ still }: { still: boolean }) {
  // SHAP bars pushing out (red up-risk, blue down-risk)
  const bars = [
    { y: 12, w: 15, c: "#b3412f", d: 0 },
    { y: 21, w: 10, c: "#b3412f", d: 0.25 },
    { y: 30, w: 8, c: "#2f5583", d: 0.5 },
    { y: 39, w: 5, c: "#2f5583", d: 0.7 },
  ];
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden="true">
      <path d="M24 6 v38" stroke="#12203b" strokeWidth="1" opacity="0.35" />
      {bars.map((b, i) => (
        <motion.rect
          key={i}
          x={24}
          y={b.y - 3}
          height="6"
          rx="3"
          fill={b.c}
          animate={still ? { width: b.w, x: b.c === "#2f5583" ? 24 - b.w : 24 } : { width: [0, b.w + 2, b.w], x: b.c === "#2f5583" ? [24, 24 - b.w - 2, 24 - b.w] : 24 }}
          transition={{ duration: 2.2, repeat: Infinity, delay: b.d, times: [0, 0.55, 0.75], ease: "easeOut" }}
        />
      ))}
    </svg>
  );
}

function IconAct({ still }: { still: boolean }) {
  // map pin dropping onto the map
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden="true">
      <ellipse cx="24" cy="38" rx="13" ry="4" fill="none" stroke="#12203b" strokeWidth="1.4" opacity="0.5" />
      <motion.ellipse
        cx="24"
        cy="38"
        rx="6"
        ry="2"
        fill="none"
        stroke="#b3412f"
        strokeWidth="1.2"
        animate={still ? undefined : { rx: [4, 11], ry: [1.2, 3.4], opacity: [0.9, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
      />
      <motion.g
        animate={still ? undefined : { y: [-12, 0, 0], opacity: [0, 1, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, times: [0, 0.45, 1], ease: [0.34, 1.4, 0.64, 1] }}
      >
        <path d="M24 14 c-4.6 0 -8 3.4 -8 7.6 C16 26.6 24 36 24 36 s8 -9.4 8 -14.4 C32 17.4 28.6 14 24 14 Z" fill="none" stroke="#b3412f" strokeWidth="1.7" />
        <circle cx="24" cy="21.6" r="2.6" fill="#b3412f" />
      </motion.g>
    </svg>
  );
}

function miniHex(cx: number, cy: number, s: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((60 * k - 90) * Math.PI) / 180;
    pts.push(`${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

/* ── pipeline definition ── */

const STEPS = [
  {
    n: "01",
    title: "Ingest",
    body: `US Accidents dataset — about ${(METRICS.houstonCrashes / 1000).toFixed(0)}k Houston-area crash records, cleaned and de-duplicated.`,
    Icon: IconIngest,
  },
  {
    n: "02",
    title: "Prepare",
    body: "The city is cut into H3 hex cells; each cell gets history features — past counts, night share, rain share, visibility.",
    Icon: IconPrepare,
  },
  {
    n: "03",
    title: "Model",
    body: `LightGBM learns what precedes a blackspot. A history-only baseline keeps the model honest. Backtest: train ${METRICS.trainWindow}, test ${METRICS.testWindow}.`,
    Icon: IconModel,
  },
  {
    n: "04",
    title: "Explain",
    body: "SHAP shows which factors pushed each score up or down, and every cell carries a confidence label — thin history stays Low by design.",
    Icon: IconExplain,
  },
  {
    n: "05",
    title: "Act",
    body: "A ranked risk map with suggested preventive actions: audit first where risk is elevated and history is thin.",
    Icon: IconAct,
  },
];

const CHIPS = ["Python", "pandas", "H3", "LightGBM", "SHAP", "Folium"];

export default function HowItWorks() {
  const { reduced } = useMotion();
  const secRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const sec = secRef.current;
    if (!sec || reduced) return;
    const ctx = gsap.context(() => {
      // connecting line draws as you scroll through the section
      const line = sec.querySelector<SVGPathElement>(".pipe-line");
      if (line) {
        const len = line.getTotalLength();
        gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
        gsap.to(line, {
          strokeDashoffset: 0,
          ease: "none",
          scrollTrigger: { trigger: sec.querySelector(".pipe-grid"), start: "top 78%", end: "bottom 42%", scrub: 0.5 },
        });
      }
      // cards flip in 3D
      gsap.utils.toArray<HTMLElement>(".pipe-card").forEach((card, i) => {
        gsap.fromTo(
          card,
          { rotateY: -78, opacity: 0, transformPerspective: 900 },
          {
            rotateY: 0,
            opacity: 1,
            duration: 1.05,
            delay: i * 0.09,
            ease: "expo.out",
            scrollTrigger: { trigger: card, start: "top 86%", once: true },
          },
        );
      });
    }, sec);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section ref={secRef} id="how" className="scroll-mt-20 bg-ivory">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-24 lg:px-8 lg:py-32">
        <SectionHead
          kicker="How it works"
          title="From raw road data to actionable risk."
          lede="Five steps, fully inspectable — collect, analyze, explain, prioritize, act. Nothing reaches the map without an explanation and a confidence label attached."
        />

        <div className="pipe-grid relative mt-16">
          {/* connecting line (desktop) */}
          <svg className="absolute -top-7 left-0 hidden h-6 w-full lg:block" preserveAspectRatio="none" viewBox="0 0 1000 24" aria-hidden="true">
            <path d="M0 12 H1000" fill="none" stroke="rgba(18,32,59,0.1)" strokeWidth="1.5" />
            <path className="pipe-line" d="M0 12 H1000" fill="none" stroke="#b8893b" strokeWidth="1.5" />
          </svg>

          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5" style={{ perspective: "1200px" }}>
            {STEPS.map(({ n, title, body, Icon }, i) => (
              <li key={n} className="pipe-card card group relative flex flex-col p-6" style={{ transformStyle: "preserve-3d" }}>
                <span className="absolute -top-7 left-6 hidden h-6 w-6 items-center justify-center lg:flex" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rotate-45 border border-brass bg-ivory transition-colors group-hover:bg-brass" />
                </span>
                <div className="flex items-center justify-between">
                  <Icon still={reduced} />
                  <span className="font-serif text-[15px] text-brass italic">{n}</span>
                </div>
                <h3 className="mt-5 font-serif text-[21px] font-semibold text-navy">{title}</h3>
                <p className="mt-2.5 flex-1 text-[13.5px] leading-relaxed text-ink/70">{body}</p>
                {i === 0 && (
                  <span className="sr-only">Step one: ingest the US Accidents dataset.</span>
                )}
              </li>
            ))}
          </ol>
        </div>

        {/* tech chips */}
        <div className="mt-12 flex flex-wrap items-center gap-2.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.2em] text-ink/45 uppercase">Built with</span>
          {CHIPS.map((c) => (
            <span key={c} className="rounded-full border border-navy/15 bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-ink/75">
              {c}
            </span>
          ))}
        </div>

        <SectionNote />
      </div>
    </section>
  );
}
