import { useRef, type ReactNode, type PointerEvent } from "react";
import { motion } from "framer-motion";
import { HeartHandshake, CircleDollarSign, Leaf, Building2, Map as MapIcon, Shield, Info } from "lucide-react";
import { SectionHead, SectionNote, useInViewOnce } from "../components/ui";
import { useMotion, EASE } from "../lib/motion";

/** Card that tilts toward the cursor with a brass glare sheen. */
function TiltCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ref.current.style.transform = `perspective(900px) rotateY(${(px - 0.5) * 9}deg) rotateX(${(0.5 - py) * 7}deg) translateY(-3px)`;
    ref.current.style.setProperty("--gx", `${px * 100}%`);
    ref.current.style.setProperty("--gy", `${py * 100}%`);
  };
  const onLeave = () => {
    if (!ref.current) return;
    ref.current.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg) translateY(0)";
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="tilt-card card relative h-full transition-transform duration-300 ease-out"
    >
      <span className="glare" aria-hidden="true" />
      {children}
    </div>
  );
}

const CARDS = [
  {
    icon: HeartHandshake,
    tint: "text-brick",
    bg: "bg-brick/8 border-brick/15",
    title: "Social",
    body: "Earlier audits where people actually walk and cycle. The engine frames prevention as care — flagging elevated risk before injuries accumulate, not blame after they do.",
  },
  {
    icon: CircleDollarSign,
    tint: "text-brass",
    bg: "bg-brass/10 border-brass/25",
    title: "Economic",
    body: "Audit hours are finite. Ranking by expected risk — not just by history — sends crews where a visit is most likely to change something, and stops re-auditing what is already understood.",
  },
  {
    icon: Leaf,
    tint: "text-teal",
    bg: "bg-teal/10 border-teal/20",
    title: "Environmental",
    body: "The preventive toolkit it recommends — lighting, crossings, drainage, calmer corridors — is the same one that makes walking and cycling viable. Safety and liveability share the fix.",
  },
] as const;

const AUDIENCE = [
  { icon: Building2, label: "Road authorities", note: "prioritise site audits" },
  { icon: MapIcon, label: "City planners", note: "target corridor upgrades" },
  { icon: Shield, label: "Traffic police", note: "focus preventive presence" },
] as const;

const INTERVENTION_CHIPS = [
  "Improve street lighting",
  "Review road geometry",
  "Add signage",
  "Improve pedestrian infrastructure",
  "Adjust traffic controls",
  "Investigate drainage",
  "Conduct targeted road-safety audits",
] as const;

export default function Impact() {
  const { ref, inView } = useInViewOnce<HTMLDivElement>();
  const { reduced } = useMotion();

  return (
    <section id="impact" className="scroll-mt-20 bg-white">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-24 lg:px-8 lg:py-32">
        <SectionHead
          kicker="Impact"
          title="What earlier audits would buy."
          lede="No invented savings figures — just the mechanism, stated plainly."
        />

        <div ref={ref} className="mt-14 grid gap-6 md:grid-cols-3" style={{ perspective: "1400px" }}>
          {CARDS.map(({ icon: Icon, tint, bg, title, body }, i) => (
            <motion.div
              key={title}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 34 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.85, delay: i * 0.12, ease: EASE.out }}
              className="h-full"
            >
              <TiltCard>
                <div className="p-7">
                  <span className={`grid h-11 w-11 place-items-center rounded-xl border ${bg}`}>
                    <Icon className={`h-5 w-5 ${tint}`} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 font-serif text-[22px] font-semibold text-navy">{title}</h3>
                  <p className="mt-3 text-[14px] leading-relaxed text-ink/70">{body}</p>
                </div>
              </TiltCard>
            </motion.div>
          ))}
        </div>

        {/* audience row */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.9, delay: 0.35, ease: EASE.out }}
          className="mt-12 rounded-xl border border-navy/10 bg-ivory p-6 sm:p-7"
        >
          <p className="text-[11px] font-semibold tracking-[0.2em] text-ink/45 uppercase">Built for</p>
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            {AUDIENCE.map(({ icon: Icon, label, note }) => (
              <div key={label} className="flex items-center gap-3.5">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-navy text-ivory">
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <div className="leading-tight">
                  <p className="text-[15px] font-semibold text-navy">{label}</p>
                  <p className="mt-0.5 text-[12px] text-ink/55">{note}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 flex items-start gap-2 border-t border-navy/8 pt-4 text-[13px] text-ink/60">
            <Info className="mt-0.5 h-4 w-4 flex-none text-brass" strokeWidth={1.7} aria-hidden="true" />
            Decision support: it prioritises where to act and does not guarantee prevention.
          </p>
        </motion.div>

        {/* preventive action */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.9, delay: 0.45, ease: EASE.out }}
          className="mt-12"
        >
          <h3 className="font-serif text-[26px] font-semibold text-navy">From risk score to action.</h3>
          <div className="mt-5 flex flex-wrap gap-2.5" role="list" aria-label="Recommended preventive interventions">
            {INTERVENTION_CHIPS.map((chip) => (
              <span
                key={chip}
                role="listitem"
                className="flex items-center gap-2.5 rounded-full border border-navy/12 bg-ivory px-4 py-2 text-[13px] font-medium text-ink/75"
              >
                <span className="h-1.5 w-1.5 rotate-45 bg-brass" aria-hidden="true" />
                {chip}
              </span>
            ))}
          </div>
          <p className="mt-5 max-w-2xl text-[14px] leading-relaxed text-ink/65">
            The system recommends <em className="font-serif text-navy">where to investigate</em> — humans decide what
            action to take.
          </p>
        </motion.div>

        <SectionNote />
      </div>
    </section>
  );
}
