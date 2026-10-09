import { motion } from "framer-motion";
import { CircleAlert, ArrowRight } from "lucide-react";
import { SectionHead, SectionNote, useInViewOnce } from "../components/ui";
import { useMotion } from "../lib/motion";

const LIMITS = [
  {
    title: "Reported incidents only",
    body: "The model learns what was recorded. Under-reporting — especially near-misses and uninjured pedestrians — is invisible to it.",
  },
  {
    title: "A 2017 data jump",
    body: "The source dataset shows a reporting discontinuity around 2017. Long-run trends across that seam should be read with suspicion.",
  },
  {
    title: "Small low-history sample",
    body: "Only about 90 low-history cells became blackspots in the test year. A few cells either way would move the metrics.",
  },
  {
    title: "One city",
    body: "Houston's road mix, climate and reporting habits shaped these weights. Nothing here transfers automatically.",
  },
];

const NEXT = [
  {
    title: "OpenStreetMap road features",
    body: "Add geometry the crash table lacks: lane counts, speed limits, crossings and junction types per cell.",
  },
  {
    title: "More cities",
    body: "Re-run the identical backtest in three different road networks before calling the lift real.",
  },
  {
    title: "A dashboard",
    body: "Ship the ranking as a weekly-refreshed tool with audit feedback loops, so scores improve with use.",
  },
];

/**
 * Limits — deliberately the plainest section on the page.
 * Slow, low-contrast-motion fade only: honesty over spectacle.
 */
export default function Limits() {
  const { ref, inView } = useInViewOnce<HTMLDivElement>();
  const { reduced } = useMotion();

  return (
    <section id="limits" className="scroll-mt-20 bg-ivory">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-24 lg:px-8 lg:py-32">
        <SectionHead
          kicker="Limits & next steps"
          title="What it cannot do — yet."
          lede="A decision-support tool that overstates itself is worse than none. So, plainly:"
        />

        <motion.div
          ref={ref}
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ duration: reduced ? 0.4 : 1.6, ease: "easeOut" }}
          className="mt-14 grid gap-10 lg:grid-cols-2"
        >
          <div>
            <p className="mb-5 flex items-center gap-2 text-[12px] font-semibold tracking-[0.18em] text-brick uppercase">
              <span className="h-px w-8 bg-brick/50" aria-hidden="true" /> Honest limits
            </p>
            <ul className="grid gap-4">
              {LIMITS.map((l) => (
                <li key={l.title} className="card flex items-start gap-4 p-5">
                  <CircleAlert className="mt-0.5 h-[18px] w-[18px] flex-none text-brick/80" strokeWidth={1.5} aria-hidden="true" />
                  <div>
                    <p className="text-[15px] font-semibold text-navy">{l.title}</p>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink/65">{l.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-5 flex items-center gap-2 text-[12px] font-semibold tracking-[0.18em] text-teal uppercase">
              <span className="h-px w-8 bg-teal/50" aria-hidden="true" /> Next steps
            </p>
            <ul className="grid gap-4">
              {NEXT.map((n) => (
                <li key={n.title} className="card flex items-start gap-4 p-5">
                  <ArrowRight className="mt-0.5 h-[18px] w-[18px] flex-none text-teal" strokeWidth={1.5} aria-hidden="true" />
                  <div>
                    <p className="text-[15px] font-semibold text-navy">{n.title}</p>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink/65">{n.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-6 rounded-xl border border-navy/10 bg-white p-5 text-[13.5px] leading-relaxed text-ink/70">
              Until those land, the right mental model is a <strong className="font-semibold text-navy">triage list</strong>:
              a defensible order in which to send human experts, with reasons attached — never an automated verdict.
            </p>
          </div>
        </motion.div>

        <SectionNote />
      </div>
    </section>
  );
}
