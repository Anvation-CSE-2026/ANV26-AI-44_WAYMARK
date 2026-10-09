import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, Hexagon } from "lucide-react";
import { useMotion } from "../lib/motion";
import { scrollToId } from "../lib/scroll";
import { appAuthUrl, WAYMARK_APP_URL } from "../lib/appUrl";
import { cn } from "../utils/cn";

interface NavLink {
  id: string;
  label: string;
  gated?: boolean;
}

const LINKS: NavLink[] = [
  { id: "problem", label: "Problem" },
  { id: "how", label: "How it works" },
  { id: "preview", label: "Live Preview" },
  { id: "workspace", label: "Workspace", gated: true },
  { id: "evidence", label: "Evidence" },
  { id: "impact", label: "Impact" },
  { id: "limits", label: "Limits" },
];

const CHAIN_N = 26;

function ChainHex({ filled }: { filled: boolean }) {
  return (
    <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true" className="flex-none">
      <polygon
        points="5,0.6 9.3,3.05 9.3,7.95 5,10.4 0.7,7.95 0.7,3.05"
        fill={filled ? "#b8893b" : "none"}
        stroke={filled ? "#b8893b" : "rgba(18,32,59,0.22)"}
        strokeWidth="0.8"
      />
    </svg>
  );
}

interface NavProps {
  visible: boolean;
}

export default function Nav({ visible }: NavProps) {
  const { reduced } = useMotion();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("");
  const [filled, setFilled] = useState(0);

  // Scroll progress → brass hex-chain fill (rAF-throttled, exact ends).
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      setFilled(Math.round(p * CHAIN_N));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Scroll-spy
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-38% 0px -55% 0px" },
    );
    LINKS.forEach((l) => {
      const el = document.getElementById(l.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const go = (l: NavLink) => {
    setOpen(false);
    if (l.gated) {
      window.location.assign(WAYMARK_APP_URL);
      return;
    }
    window.setTimeout(() => scrollToId(l.id, reduced), open ? 220 : 0);
  };

  return (
    <motion.header
      initial={false}
      animate={{ y: visible ? 0 : -110 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-x-0 top-0 z-50"
    >
      <div className="border-b border-navy/8 bg-ivory/85 shadow-[0_1px_0_rgba(18,32,59,0.04)] backdrop-blur-md">
        <div className="mx-auto flex h-[58px] max-w-[1320px] items-center justify-between gap-4 px-5 lg:px-8">
          <button
            onClick={() => scrollToId("top", reduced)}
            className="group flex items-center gap-2.5"
            aria-label="Back to top — Blackspot Risk Engine"
          >
            <span className="relative grid h-8 w-8 place-items-center">
              <Hexagon className="h-8 w-8 text-navy transition-colors group-hover:text-brass" strokeWidth={1.4} />
              <span className="absolute h-1.5 w-1.5 rounded-full bg-brass" />
            </span>
            <span className="text-left leading-tight">
              <span className="block font-serif text-[15px] font-semibold text-navy">Blackspot Risk Engine</span>
              <span className="block text-[9.5px] tracking-[0.2em] text-ink/50 uppercase">AI road-safety decision support</span>
            </span>
          </button>

          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Sections">
            {LINKS.map((l) => (
              <button
                key={l.id}
                onClick={() => go(l)}
                className={cn(
                  "relative rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                  active === l.id ? "text-navy" : "text-ink/55 hover:text-navy",
                )}
                aria-current={active === l.id ? "true" : undefined}
              >
                {l.label}
                <span
                  className={cn(
                    "absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-brass transition-transform duration-300",
                    active === l.id ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </button>
            ))}
          </nav>

          <div className="hidden items-center gap-2.5 lg:flex">
            <a href={appAuthUrl("login")} className="rounded-xl border border-navy/25 bg-white/70 px-5 py-2.5 text-[13.5px] font-semibold text-navy shadow-[0_1px_2px_rgba(18,32,59,0.06)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-px hover:border-navy/50 hover:bg-white hover:shadow-[0_10px_24px_-10px_rgba(18,32,59,0.35)]">
              Log in
            </a>
            <a href={appAuthUrl("signup")} className="rounded-xl bg-navy px-4 py-2.5 text-[13.5px] font-semibold text-ivory transition-colors hover:bg-navy-soft">
              Sign up
            </a>
          </div>

          <button
            className="grid h-10 w-10 place-items-center rounded-lg text-navy lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X className="h-5 w-5" strokeWidth={1.6} /> : <Menu className="h-5 w-5" strokeWidth={1.6} />}
          </button>
        </div>

        {/* brass hex-chain scroll progress */}
        <div className="relative h-[11px] overflow-hidden" aria-hidden="true">
          <div className="hex-chain mx-auto flex h-full max-w-[1320px] items-center gap-[3.5px] px-5 lg:px-8">
            {Array.from({ length: CHAIN_N }).map((_, i) => (
              <ChainHex key={i} filled={i < filled} />
            ))}
            <span className="ml-2 font-mono text-[9px] tracking-widest text-ink/35 tabular-nums">
              {String(Math.round((filled / CHAIN_N) * 100)).padStart(2, "0")}%
            </span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="border-b border-navy/10 bg-ivory/97 backdrop-blur-md lg:hidden"
            aria-label="Sections (mobile)"
          >
            <div className="mx-auto grid max-w-[1320px] gap-1 px-5 py-4">
              {LINKS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => go(l)}
                  className="rounded-lg px-3 py-2.5 text-left text-[15px] font-medium text-ink/75 transition-colors hover:bg-navy/5 hover:text-navy"
                >
                  {l.label}
                </button>
              ))}
              <a href={appAuthUrl("login")} onClick={() => setOpen(false)} className="mt-2 flex items-center justify-center rounded-lg border border-navy/20 px-3 py-2.5 text-[14px] font-semibold text-navy">
                Log in
              </a>
              <a href={appAuthUrl("signup")} onClick={() => setOpen(false)} className="flex items-center justify-center rounded-lg bg-navy px-3 py-2.5 text-[14px] font-semibold text-ivory">
                Sign up
              </a>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
