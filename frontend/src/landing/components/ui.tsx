import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { motion, useSpring } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useInView } from "framer-motion";
import { useMotion, EASE } from "../lib/motion";
import { scrollToId } from "../lib/scroll";
import { cn } from "../utils/cn";

gsap.registerPlugin(ScrollTrigger);

/* ── Count-up that always lands on the exact target value ── */
export function useCountUp(target: number, { duration = 1.6, active = true }: { duration?: number; active?: boolean } = {}) {
  const { reduced } = useMotion();
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setDisplay(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / (duration * 1000));
      const e = 1 - Math.pow(1 - p, 4);
      setDisplay(p >= 1 ? target : target * e); // exact final value
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, active, reduced]);
  return display;
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

/* ── In-view once helper ── */
export function useInViewOnce<T extends HTMLElement>(margin = "-18% 0px") {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { once: true, margin: margin as never });
  return { ref, inView };
}

/* ── Magnetic button with brass shimmer ── */
export function MagneticButton({
  children,
  href,
  variant = "solid",
  className,
  onClick,
}: {
  children: ReactNode;
  href?: string;
  variant?: "solid" | "outline" | "light";
  className?: string;
  onClick?: () => void;
}) {
  const { reduced } = useMotion();
  const x = useSpring(0, { stiffness: 260, damping: 18, mass: 0.6 });
  const y = useSpring(0, { stiffness: 260, damping: 18, mass: 0.6 });

  const handleMove = (e: MouseEvent<HTMLElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set(Math.max(-9, Math.min(9, (e.clientX - r.left - r.width / 2) * 0.28)));
    y.set(Math.max(-7, Math.min(7, (e.clientY - r.top - r.height / 2) * 0.34)));
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  const cls = cn(
    "btn-shimmer inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold transition-colors duration-300",
    variant === "solid" && "bg-navy text-ivory shadow-[var(--shadow-lift)] hover:bg-navy-soft",
    variant === "outline" && "border border-navy/25 bg-transparent text-navy hover:border-brass hover:text-navy",
    variant === "light" && "bg-ivory text-navy shadow-[var(--shadow-lift)] hover:bg-white",
    className,
  );

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    if (href?.startsWith("#")) {
      e.preventDefault();
      scrollToId(href.slice(1), reduced);
    }
    onClick?.();
  };

  return (
    <motion.a
      href={href}
      onClick={handleClick}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      style={reduced ? undefined : { x, y }}
      className={cls}
    >
      {children}
    </motion.a>
  );
}

/* ── Section scaffolding ── */
export function SectionHead({
  kicker,
  title,
  lede,
  dark = false,
  align = "left",
}: {
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  dark?: boolean;
  align?: "left" | "center";
}) {
  const { ref, inView } = useInViewOnce<HTMLDivElement>();
  const { reduced } = useMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 26, filter: "blur(6px)" }}
      animate={inView ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
      transition={{ duration: 0.9, ease: EASE.out }}
      className={cn("max-w-3xl", align === "center" && "mx-auto text-center")}
    >
      <p className="kicker">{kicker}</p>
      <h2
        className={cn(
          "mt-3 font-serif text-4xl leading-[1.12] font-semibold text-balance sm:text-[44px]",
          dark ? "text-ivory" : "text-navy",
        )}
      >
        {title}
      </h2>
      {lede && <p className={cn("mt-5 text-[17px] leading-relaxed", dark ? "text-ivory/70" : "text-ink/80")}>{lede}</p>}
    </motion.div>
  );
}

/** Mandated wording, repeated at the end of every section. */
export function SectionNote({ dark = false, className }: { dark?: boolean; className?: string }) {
  return (
    <p
      className={cn(
        "mt-14 border-t pt-5 text-[13px] tracking-wide",
        dark ? "hairline-light text-ivory/45" : "hairline text-ink/50",
        className,
      )}
    >
      Decision support only. Human experts decide. Indicative result: one city, one backtest.
    </p>
  );
}

/* ── Hex-iris wipe reveal (section transitions — never a plain cut) ── */
function hexClip(r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((60 * k - 90) * Math.PI) / 180;
    pts.push(`${50 + r * Math.cos(a)}% ${50 + r * 1.15 * Math.sin(a)}%`);
  }
  return `polygon(${pts.join(",")})`;
}

export function HexIris({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const tween = gsap.fromTo(
      el,
      { clipPath: hexClip(2), opacity: 0.4 },
      {
        clipPath: hexClip(160),
        opacity: 1,
        duration: 1.35,
        ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 82%", once: true },
        onComplete: () => {
          el.style.clipPath = "none";
        },
      },
    );
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [reduced]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
