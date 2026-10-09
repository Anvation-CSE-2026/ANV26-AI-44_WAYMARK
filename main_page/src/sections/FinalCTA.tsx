import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { MagneticButton, useInViewOnce } from "../components/ui";
import { useMotion, EASE } from "../lib/motion";
import { scrollToId } from "../lib/scroll";
import { WAYMARK_APP_URL } from "../lib/appUrl";

function hexPts(cx: number, cy: number, s: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((60 * k - 90) * Math.PI) / 180;
    pts.push(`${cx + s * Math.cos(a)},${cy + s * Math.sin(a)}`);
  }
  return pts.join(" ");
}

export default function FinalCTA() {
  const { ref, inView } = useInViewOnce<HTMLDivElement>();
  const { reduced } = useMotion();

  return (
    <section className="relative overflow-hidden bg-navy text-ivory">
      {/* faint hex constellation */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {[
          [0.86, 0.24, 46],
          [0.93, 0.62, 70],
          [0.1, 0.78, 54],
          [0.76, 0.84, 30],
        ].map(([fx, fy, s], i) => (
          <motion.polygon
            key={i}
            points={hexPts(fx * 100, fy * 100, s / 10)}
            transform={`scale(10)`}
            fill="none"
            stroke="rgba(250,247,242,0.07)"
            strokeWidth="0.12"
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : undefined}
            transition={{ duration: 1.4, delay: 0.3 + i * 0.15 }}
          />
        ))}
      </svg>

      <div ref={ref} className="relative mx-auto w-full max-w-[1320px] px-5 py-24 text-center lg:px-8 lg:py-32">
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 30, filter: "blur(6px)" }}
          animate={inView ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
          transition={{ duration: 1, ease: EASE.out }}
        >
          <p className="kicker">Ready when you are</p>
          <h2 className="mx-auto mt-4 max-w-[20ch] font-serif text-[clamp(34px,4.6vw,58px)] leading-[1.08] font-semibold text-balance">
            Find the roads that <em className="font-medium italic text-brass-soft">need attention</em> next.
          </h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-[16.5px] leading-relaxed text-ivory/65">
            Turn complex road-safety data into clear, explainable priorities — and let human experts make the final call.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <MagneticButton href={WAYMARK_APP_URL} variant="light">
              Explore WAYMARK
              <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </MagneticButton>
            <button
              onClick={() => scrollToId("how", reduced)}
              className="rounded-xl border border-ivory/30 px-6 py-3 text-[15px] font-semibold text-ivory transition-colors hover:border-brass hover:text-brass-soft"
            >
              View methodology
            </button>
          </div>
        </motion.div>

        <p className="mx-auto mt-16 max-w-[720px] border-t border-ivory/12 pt-5 text-[13px] tracking-wide text-ivory/45">
          Decision support only. Human experts decide. Indicative result: one city, one backtest.
        </p>
      </div>
    </section>
  );
}
