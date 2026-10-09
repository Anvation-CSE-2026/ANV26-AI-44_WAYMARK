import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Database, BarChart3, ShieldCheck, ArrowDown, MousePointer2 } from "lucide-react";
import HexCanvas from "../components/HexCanvas";
import { MagneticButton } from "../components/ui";
import { useMotion, EASE } from "../lib/motion";
import { WAYMARK_APP_URL } from "../lib/appUrl";

const HEADLINE = ["Find", "road", "risk", "before", "the", "crashes", "pile", "up."];

const TRUST = [
  { icon: Database, title: "Open data", note: "US Accidents · ~169K records" },
  { icon: BarChart3, title: "Explainable AI", note: "Every score shows its reasons" },
  { icon: ShieldCheck, title: "Confidence", note: "High / Medium / Low · never hidden" },
] as const;

export default function Hero({ started }: { started: boolean }) {
  const { reduced } = useMotion();
  const secRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: secRef, offset: ["start start", "end start"] });
  const yContent = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 120]);
  const yCanvas = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -80]);
  const fade = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

  const reveal = (i: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: "112%", filter: "blur(10px)" },
    animate: started ? { opacity: 1, y: "0%", filter: "blur(0px)" } : undefined,
    transition: { duration: 1.05, ease: EASE.out, delay: 0.12 + i * 0.075 },
  });

  return (
    <section ref={secRef} id="top" className="relative flex min-h-screen flex-col overflow-hidden bg-ivory">
      {/* hex field (parallax layer) */}
      <motion.div style={{ y: yCanvas }} className="absolute inset-0" aria-hidden="true">
        <HexCanvas className="h-full w-full" />
      </motion.div>
      {/* legibility gradients */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ivory via-ivory/70 to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-ivory via-ivory/60 to-transparent" aria-hidden="true" />

      <motion.div
        style={reduced ? undefined : { y: yContent, opacity: fade }}
        className="relative z-10 mx-auto flex w-full max-w-[1320px] flex-1 flex-col justify-center px-5 pt-32 pb-16 lg:px-8"
      >
        <h1 className="max-w-[16ch] font-serif text-[clamp(44px,6.4vw,88px)] leading-[1.04] font-semibold text-navy">
          {HEADLINE.map((w, i) => (
            <span key={i} className="inline-block overflow-hidden pb-[0.12em] align-bottom">
              <motion.span className="inline-block will-change-transform" {...reveal(i + 1)}>
                {w === "crashes" || w === "pile" || w === "up." ? (
                  <em className="font-medium italic">{w}</em>
                ) : (
                  w
                )}
                {i < HEADLINE.length - 1 ? "\u00A0" : ""}
              </motion.span>
            </span>
          ))}
        </h1>

        <motion.p {...reveal(HEADLINE.length + 1)} className="mt-7 max-w-[54ch] text-[18px] leading-relaxed text-ink/80">
          An explainable risk engine that surfaces <strong className="font-semibold text-navy">emerging blackspots</strong> —
          even where crash history is thin — so audit teams know where to look{" "}
          <em className="font-serif text-navy">first</em>.
        </motion.p>

        <motion.div {...reveal(HEADLINE.length + 2)} className="mt-10 flex flex-wrap items-center gap-4">
          <MagneticButton href={WAYMARK_APP_URL} variant="solid">
            Explore the risk map
            <MousePointer2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </MagneticButton>
          <MagneticButton href="#about" variant="outline">
            About WAYMARK
          </MagneticButton>
        </motion.div>

        {/* trust strip */}
        <motion.div
          {...reveal(HEADLINE.length + 3)}
          className="mt-16 grid gap-x-8 gap-y-5 border-t border-navy/10 pt-6 sm:grid-cols-3"
        >
          {TRUST.map(({ icon: Icon, title, note }) => (
            <div key={title} className="flex items-start gap-3.5">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl border border-navy/12 bg-white/70">
                <Icon className="h-[18px] w-[18px] text-navy" strokeWidth={1.5} aria-hidden="true" />
              </span>
              <span>
                <span className="block text-[14.5px] font-semibold text-navy">{title}</span>
                <span className="mt-0.5 block text-[12.5px] text-ink/55">{note}</span>
              </span>
            </div>
          ))}
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={started ? { opacity: 1 } : undefined}
        transition={{ delay: 2, duration: 1 }}
        className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-ink/45"
        aria-hidden="true"
      >
        <ArrowDown className="h-4 w-4 animate-bounce [animation-duration:2.2s]" strokeWidth={1.6} />
      </motion.div>

      <p className="absolute right-5 bottom-5 z-10 hidden text-[10.5px] tracking-wide text-ink/35 lg:right-8 lg:block">
        Stylised Houston street grid · illustrative hex animation
      </p>
    </section>
  );
}
