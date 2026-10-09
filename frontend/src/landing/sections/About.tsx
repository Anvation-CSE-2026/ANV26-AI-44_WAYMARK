import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { CircleDollarSign, HeartHandshake, Leaf } from "lucide-react";
import { useInViewOnce } from "../components/ui";
import { useMotion, EASE } from "../lib/motion";

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
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className="tilt-card card relative h-full transition-transform duration-300 ease-out">
      <span className="glare" aria-hidden="true" />
      {children}
    </div>
  );
}

const IMPACT_CARDS = [
  {
    icon: HeartHandshake,
    tint: "text-brick",
    bg: "bg-brick/8 border-brick/15",
    title: "Social",
    body: "Earlier audits where people actually walk and cycle. The engine frames prevention as care — flagging elevated risk before injuries accumulate, not blame after they do.",
  },
  {
    icon: CircleDollarSign,
    title: "Economic",
    tint: "text-brass",
    bg: "bg-brass/10 border-brass/25",
    body: "Audit hours are finite. Ranking by expected risk — not just by history — sends crews where a visit is most likely to change something, and stops re-auditing what is already understood.",
  },
  {
    icon: Leaf,
    title: "Environmental",
    tint: "text-teal",
    bg: "bg-teal/10 border-teal/20",
    body: "The preventive toolkit it recommends — lighting, crossings, drainage, calmer corridors — is the same one that makes walking and cycling viable. Safety and liveability share the fix.",
  },
] as const;

export default function About() {
  const { ref, inView } = useInViewOnce<HTMLDivElement>();
  const { reduced } = useMotion();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        void video.play().catch(() => {});
      } else {
        video.pause();
      }
    }, { threshold: 0.45 });

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="about" className="scroll-mt-20 bg-[#f1eee7]">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-24 lg:px-8 lg:py-32">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <p className="kicker">About WAYMARK</p>
            <h2 className="mt-3 font-serif text-4xl leading-[1.12] font-semibold text-navy text-balance sm:text-[44px]">
              A clearer way to prioritize road-safety audits.
            </h2>
            <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-ink/80">
              WAYMARK helps teams explore emerging road risk, understand the signals behind each score, and focus limited audit resources where they may matter most.
            </p>
          </div>
          <div className="mx-auto w-full max-w-[620px] overflow-hidden rounded-2xl border border-navy/10 bg-navy shadow-[0_20px_55px_rgba(18,32,59,0.15)]">
            <video
              ref={videoRef}
              className="block aspect-video w-full bg-navy object-contain"
              muted
              playsInline
              preload="metadata"
              aria-label="WAYMARK overview video"
            >
              <source src="/media/waymark-about.mp4" type="video/mp4" />
              Your browser does not support the video element.
            </video>
          </div>
        </div>

        <div ref={ref} className="mt-14 grid gap-6 md:grid-cols-3" style={{ perspective: "1400px" }}>
          {IMPACT_CARDS.map(({ icon: Icon, tint, bg, title, body }, i) => (
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
                  <h3 className="mt-5 font-serif text-[24px] font-semibold text-navy">{title}</h3>
                  <p className="mt-3 text-[16px] leading-[1.65] text-ink/70">{body}</p>
                </div>
              </TiltCard>
            </motion.div>
          ))}
        </div>
        <p className="mt-8 text-center text-[16px] leading-relaxed text-ink/70">
          The system recommends <em className="font-serif text-navy">where to investigate</em> — humans decide what action to take.
        </p>
      </div>
    </section>
  );
}
