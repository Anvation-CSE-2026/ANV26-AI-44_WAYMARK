import { ArrowUp } from "lucide-react";
import { Logo } from "../../components/Logo";
import { useMotion } from "../lib/motion";
import { scrollToId } from "../lib/scroll";
import { WAYMARK_APP_URL } from "../lib/appUrl";

const SOURCES = [
  "US Accidents (2016–2023), Moosavi et al. — Kaggle",
  "H3 hexagonal spatial index (Uber)",
  "Basemap: CartoDB Positron · © OpenStreetMap contributors · © CARTO",
  "Type: Playfair Display & Inter",
];

const FOOTER_LINKS: Array<{ label: string; section?: string; href?: string }> = [
  { label: "Problem", section: "problem" },
  { label: "How it works", section: "how" },
  { label: "About", section: "about" },
  { label: "Workspace", href: WAYMARK_APP_URL },
];

export default function Footer() {
  const { reduced } = useMotion();

  return (
    <footer className="bg-navy text-ivory">
      <div className="mx-auto w-full max-w-[1320px] px-5 pt-16 pb-8 lg:px-8">
        <div className="grid gap-10 border-b border-ivory/12 pb-10 lg:grid-cols-[1.3fr_1fr_0.8fr]">
          <div>
            <Logo tone="dark" size={36} />
            <div className="ml-[48px]">
              <p className="text-[12px] text-brass-soft">Explainable AI for proactive road safety.</p>
              <p className="mt-1 text-[11px] tracking-[0.2em] text-ivory/45 uppercase">Problem AI-17 · prototype</p>
            </div>
            <p className="mt-5 max-w-[46ch] text-[13.5px] leading-relaxed text-ivory/60">
              Decision support only. Human experts decide. Indicative result: one city, one backtest. The engine
              proposes an audit order with reasons attached — it never predicts that a crash <em>will</em> happen.
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-ivory/45 uppercase">Data & credits</p>
            <ul className="mt-4 grid gap-2 text-[12.5px] leading-relaxed text-ivory/60">
              {SOURCES.map((s) => (
                <li key={s} className="flex gap-2.5">
                  <span className="mt-[9px] h-1 w-1 flex-none rotate-45 bg-brass" aria-hidden="true" />
                  {s}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-ivory/45 uppercase">Project</p>
            <ul className="mt-4 grid gap-2.5 text-[12.5px] text-ivory/60">
              <li>
                Team: <span className="text-ivory/85">VORTEX</span>
              </li>
              <li>
                Track: <span className="text-ivory/85">Problem AI-17 — Safer Roads</span>
              </li>
              <li>
                Pilot city: <span className="text-ivory/85">Houston, TX</span>
              </li>
            </ul>
            <button
              onClick={() => scrollToId("top", reduced)}
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-ivory/25 px-4 py-2 text-[12px] font-semibold text-ivory/85 transition-colors hover:border-brass hover:text-ivory"
            >
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              Back to top
            </button>
          </div>
        </div>

        {/* link row */}
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-b border-ivory/12 pt-6 pb-6">
          {FOOTER_LINKS.map((l) =>
            l.href ? (
              <a
                key={l.label}
                href={l.href}
                className="text-[12px] font-medium text-ivory/55 transition-colors hover:text-brass-soft"
              >
                {l.label}
              </a>
            ) : l.section ? (
              <button
                key={l.label}
                onClick={() => scrollToId(l.section!, reduced)}
                className="text-[12px] font-medium text-ivory/55 transition-colors hover:text-brass-soft"
              >
                {l.label}
              </button>
            ) : (
              <span key={l.label} className="cursor-default text-[12px] font-medium text-ivory/30" title="Placeholder — prototype document">
                {l.label}
              </span>
            ),
          )}
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <p className="text-[11.5px] text-ivory/40">
            Prototype for mentor review · decision support only · figures from the embedded backtest snapshot.
          </p>
        </div>
      </div>
    </footer>
  );
}
