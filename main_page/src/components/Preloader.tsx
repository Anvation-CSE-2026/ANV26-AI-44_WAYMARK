import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useMotion } from "../lib/motion";
import { METRICS } from "../data/engine";

/** Pointy-top hexagon polygon points around (cx, cy). */
function hexPoints(cx: number, cy: number, s: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((60 * k - 90) * Math.PI) / 180;
    pts.push(`${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

interface Tile {
  cx: number;
  cy: number;
  brass: boolean;
}

/**
 * Load sequence (~2s):
 *  a brass hexagon draws itself → splits into a honeycomb that fills the
 *  screen → counter "Scoring 8,275 cells…" → the honeycomb dissolves
 *  centre-out (hex mask wipe) revealing the hero.
 * Reduced motion: single gentle fade.
 */
export default function Preloader({ onDone }: { onDone: () => void }) {
  const { reduced } = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const [gone, setGone] = useState(false);

  // Honeycomb tile layout (flat full-screen grid, pointy-top hexagons).
  const size = 46;
  const tiles = useMemo<Tile[]>(() => {
    if (typeof window === "undefined") return [];
    const w = window.innerWidth;
    const h = window.innerHeight;
    const stepX = Math.sqrt(3) * size;
    const stepY = 1.5 * size;
    const out: Tile[] = [];
    let row = 0;
    for (let y = -size; y < h + size; y += stepY, row++) {
      const off = row % 2 ? stepX / 2 : 0;
      for (let x = -size + off; x < w + size; x += stepX) {
        out.push({ cx: x, cy: y, brass: Math.random() < 0.045 });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const counter = counterRef.current;

    if (reduced) {
      // Simple fade only.
      const tl = gsap.timeline({
        onComplete: () => {
          setGone(true);
          onDone();
        },
      });
      if (counter) counter.textContent = METRICS.cellsScored.toLocaleString("en-US");
      tl.to(root, { opacity: 0, duration: 0.6, delay: 0.5, ease: "power1.inOut" });
      return () => {
        tl.kill();
      };
    }

    const ctx = gsap.context(() => {
      const logoPath = root.querySelector<SVGPolygonElement>(".pl-logo-hex");
      const tileEls = gsap.utils.toArray<HTMLElement>(".pl-tile");
      const counterObj = { v: 0 };

      const tl = gsap.timeline({
        defaults: { ease: "expo.out" },
        onComplete: () => {
          setGone(true);
          onDone();
        },
      });

      // 1 · Brass hexagon draws itself (stroke by stroke illusion via dashoffset).
      if (logoPath) {
        gsap.set(logoPath, { strokeDasharray: 6, strokeDashoffset: 6 });
        tl.to(logoPath, { strokeDashoffset: 0, duration: 0.75, ease: "power2.inOut" }, 0.05);
      }
      tl.fromTo(".pl-title", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45 }, 0.45);

      // 2 · Split into honeycomb filling the screen.
      tl.to(".pl-logo", { scale: 0.32, opacity: 0, duration: 0.45, ease: "expo.in" }, 0.85);
      tl.set(".pl-grid", { opacity: 1 }, 0.9);
      tl.fromTo(
        tileEls,
        { scale: 0, transformOrigin: "50% 50%" },
        {
          scale: 1,
          duration: 0.55,
          ease: "back.out(1.6)",
          stagger: { grid: "auto", from: "center", amount: 0.5 },
        },
        0.9,
      );

      // 3 · Counter — always ends on the exact number of scored cells.
      if (counter) {
        tl.to(
          counterObj,
          {
            v: METRICS.cellsScored,
            duration: 1.3,
            ease: "power2.out",
            onUpdate: () => {
              counter.textContent = Math.round(counterObj.v).toLocaleString("en-US");
            },
          },
          0.45,
        );
      }

      // 4 · Honeycomb dissolves centre-out → hex-mask wipe revealing the hero.
      tl.to(
        tileEls,
        {
          scale: 0,
          duration: 0.5,
          ease: "expo.in",
          stagger: { grid: "auto", from: "center", amount: 0.42 },
        },
        1.95,
      );
      tl.to(root, { opacity: 0, duration: 0.35, ease: "power1.out" }, 2.55);
    }, root);

    return () => ctx.revert();
  }, [reduced, onDone]);

  if (gone) return null;

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] overflow-hidden"
      style={{ background: "#0c1730" }}
      role="status"
      aria-label={`Loading — scoring ${METRICS.cellsScored.toLocaleString("en-US")} cells`}
    >
      {/* honeycomb layer */}
      <svg className="pl-grid absolute inset-0 h-full w-full opacity-0" aria-hidden="true">
        {tiles.map((t, i) => (
          <polygon
            key={i}
            className="pl-tile"
            points={hexPoints(t.cx, t.cy, size + 0.7)}
            fill={t.brass ? "#2a2417" : "#14223f"}
            stroke="#1d2f52"
            strokeWidth="1"
          />
        ))}
      </svg>

      {/* logo + counter */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-7">
        <svg className="pl-logo h-28 w-28" viewBox="0 0 100 100" aria-hidden="true">
          <polygon
            className="pl-logo-hex"
            points={hexPoints(50, 50, 36)}
            fill="none"
            stroke="#b8893b"
            strokeWidth="0.9"
            pathLength={6}
            strokeLinecap="round"
          />
          <polygon points={hexPoints(50, 50, 22)} fill="none" stroke="rgba(250,247,242,0.35)" strokeWidth="0.6" />
          <circle cx="50" cy="50" r="2.4" fill="#b8893b" />
        </svg>
        <div className="pl-title text-center opacity-0">
          <p className="font-mono text-sm tracking-wider text-ivory/90 tabular-nums" style={{ fontVariantNumeric: "tabular-nums" }}>
            Scoring <span ref={counterRef}>0</span> cells…
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.25em] text-ivory/40">Explainable Blackspot Risk Engine</p>
        </div>
      </div>
    </div>
  );
}
