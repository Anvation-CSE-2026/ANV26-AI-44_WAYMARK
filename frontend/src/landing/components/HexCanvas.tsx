import { useEffect, useRef } from "react";
import { useMotion } from "../lib/motion";

/**
 * Full-bleed interactive hex field for the hero.
 *  - Honeycomb grid over a faint, stylised Houston street outline.
 *  - Cells warm teal → amber → brick as the pointer nears (risk metaphor).
 *  - Pointer movement spawns ripples; a slow scan line periodically sweeps
 *    the grid and a few "emerging-risk" cells pulse with halos.
 *  - Purely illustrative (labelled as such); no real scores are rendered here.
 *  - 60fps target: static layers are pre-rendered offscreen, only "hot" cells
 *    are redrawn each frame; the loop pauses offscreen and honours
 *    prefers-reduced-motion (single static frame).
 */

const TEAL = [42, 127, 142];
const AMBER = [217, 138, 43];
const BRICK = [179, 65, 47];
const BRASS = "184, 137, 59";

function mix(a: number[], b: number[], t: number) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function riskColor(t: number, alpha: number) {
  const c = t < 0.5 ? mix(TEAL, AMBER, t * 2) : mix(AMBER, BRICK, (t - 0.5) * 2);
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha.toFixed(3)})`;
}

interface Hex {
  x: number;
  y: number;
}
interface Ripple {
  x: number;
  y: number;
  born: number;
}

export default function HexCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { reduced } = useMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let visible = true;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let hexes: Hex[] = [];
    let baseLayer: HTMLCanvasElement | null = null;
    const pointer = { x: -9999, y: -9999, inside: false };
    const ripples: Ripple[] = [];
    let lastRipple = 0;
    let pulseCells: Array<{ x: number; y: number; phase: number; color: string }> = [];

    const S = 25; // hex radius
    const stepX = Math.sqrt(3) * S;
    const stepY = 1.5 * S;

    const hexPath = (c: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
      c.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = ((60 * k - 90) * Math.PI) / 180;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (k === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
    };

    /** Stylised Houston: a roaming loop + radiating freeways + a wavy bayou. */
    const drawStreets = (c: CanvasRenderingContext2D) => {
      const u = Math.min(W, H) / 100;
      c.lineCap = "round";
      // freeway rays
      const rays = [
        [[0.5, 0.52], [0.03, 0.1]],
        [[0.5, 0.5], [0.95, 0.06]],
        [[0.52, 0.52], [1.0, 0.62]],
        [[0.5, 0.53], [0.16, 0.98]],
        [[0.51, 0.52], [0.66, 1.05]],
        [[0.49, 0.5], [-0.04, 0.68]],
      ] as const;
      rays.forEach(([[x1, y1], [x2, y2]], i) => {
        c.beginPath();
        c.moveTo(x1 * W, y1 * H);
        const mx = (x1 + x2) / 2 + (i % 2 ? 0.06 : -0.06);
        const my = (y1 + y2) / 2 + (i % 3 ? 0.04 : -0.05);
        c.quadraticCurveTo(mx * W, my * H, x2 * W, y2 * H);
        c.strokeStyle = `rgba(18,32,59,${0.13 - (i % 3) * 0.02})`;
        c.lineWidth = i % 2 ? u * 0.55 : u * 0.34;
        c.stroke();
      });
      // 610-style loop
      c.beginPath();
      c.ellipse(W * 0.5, H * 0.52, W * 0.16, H * 0.19, 0.2, 0, Math.PI * 2);
      c.strokeStyle = "rgba(18,32,59,0.12)";
      c.lineWidth = u * 0.42;
      c.stroke();
      // bayou
      c.beginPath();
      c.moveTo(-10, H * 0.36);
      for (let x = 0; x <= W + 40; x += W / 7) {
        c.quadraticCurveTo(x + W / 16, H * (0.36 + (x / W % 0.14) - 0.06), x + W / 7, H * 0.36 + Math.sin(x * 0.002) * H * 0.05);
      }
      c.strokeStyle = "rgba(42,127,142,0.14)";
      c.lineWidth = u * 0.5;
      c.stroke();
    };

    const rebuild = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // grid
      hexes = [];
      let row = 0;
      for (let y = -S; y < H + S; y += stepY, row++) {
        const off = row % 2 ? stepX / 2 : 0;
        for (let x = -S + off; x < W + S; x += stepX) hexes.push({ x, y });
      }

      // pulse "emerging-risk" cells (seeded, deterministic)
      pulseCells = [];
      const seeds = [
        [0.24, 0.3, "#b3412f", 0],
        [0.68, 0.22, "#d98a2b", 0.9],
        [0.82, 0.62, "#b3412f", 1.7],
        [0.38, 0.72, "#d98a2b", 2.3],
        [0.55, 0.44, "#2a7f8e", 3.1],
      ] as const;
      seeds.forEach(([fx, fy, color, phase]) => {
        // snap to nearest hex centre
        let best: Hex | null = null;
        let bd = Infinity;
        for (const hx of hexes) {
          const d = (hx.x - fx * W) ** 2 + (hx.y - fy * H) ** 2;
          if (d < bd) {
            bd = d;
            best = hx;
          }
        }
        if (best) pulseCells.push({ x: best.x, y: best.y, phase, color });
      });

      // static base layer (streets + hairline grid)
      baseLayer = document.createElement("canvas");
      baseLayer.width = W * dpr;
      baseLayer.height = H * dpr;
      const b = baseLayer.getContext("2d");
      if (b) {
        b.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawStreets(b);
        b.strokeStyle = "rgba(18,32,59,0.075)";
        b.lineWidth = 1;
        for (const hx of hexes) {
          hexPath(b, hx.x, hx.y, S - 1.5);
          b.stroke();
        }
      }
    };

    const SCAN_PERIOD = 7000;
    const SCAN_DUR = 2600;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!running || !visible) return;

      ctx.clearRect(0, 0, W, H);
      if (baseLayer) ctx.drawImage(baseLayer, 0, 0, W, H);

      // scan line
      const sPhase = (now % SCAN_PERIOD) / SCAN_DUR;
      const scanActive = sPhase < 1;
      const scanX = scanActive ? -0.12 * W + sPhase * 1.24 * W : -9999;
      if (scanActive) {
        const g = ctx.createLinearGradient(scanX - 90, 0, scanX + 90, 0);
        g.addColorStop(0, `rgba(${BRASS},0)`);
        g.addColorStop(0.5, `rgba(${BRASS},0.09)`);
        g.addColorStop(1, `rgba(${BRASS},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(scanX - 90, 0, 180, H);
        ctx.strokeStyle = `rgba(${BRASS},0.28)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(scanX, 0);
        ctx.lineTo(scanX, H);
        ctx.stroke();
      }

      // hot cells
      const pruned: Ripple[] = [];
      for (const r of ripples) if ((now - r.born) / 1000 < 1.5) pruned.push(r);
      ripples.length = 0;
      ripples.push(...pruned);

      for (const hx of hexes) {
        let heat = 0;
        if (pointer.inside) {
          const d2 = (hx.x - pointer.x) ** 2 + (hx.y - pointer.y) ** 2;
          heat += Math.exp(-d2 / (2 * 150 * 150)) * 0.95;
        }
        for (const r of ripples) {
          const age = (now - r.born) / 1000;
          const R = age * 300;
          const d = Math.hypot(hx.x - r.x, hx.y - r.y);
          heat += Math.exp(-((d - R) ** 2) / (2 * 55 * 55)) * Math.max(0, 1 - age / 1.5) * 0.85;
        }
        if (scanActive) heat += Math.exp(-((hx.x - scanX) ** 2) / (2 * 110 * 110)) * 0.55;

        if (heat > 0.045) {
          const t = Math.min(1, heat);
          hexPath(ctx, hx.x, hx.y, S - 1.5);
          ctx.fillStyle = riskColor(t, 0.1 + t * 0.42);
          ctx.fill();
        }
      }

      // pulsing halos on "emerging-risk" cells
      for (const p of pulseCells) {
        const ph = ((now / 1000 + p.phase) % 2.6) / 2.6; // 0→1 (slow: <3Hz)
        const r = S * (1 + ph * 1.25);
        const a = (1 - ph) * 0.5;
        hexPath(ctx, p.x, p.y, r);
        ctx.strokeStyle = p.color + Math.round(a * 255).toString(16).padStart(2, "0");
        ctx.lineWidth = 1.4;
        ctx.stroke();
        hexPath(ctx, p.x, p.y, S * 0.42);
        ctx.fillStyle = p.color + "59";
        ctx.fill();
      }
    };

    const staticFrame = () => {
      ctx.clearRect(0, 0, W, H);
      if (baseLayer) ctx.drawImage(baseLayer, 0, 0, W, H);
      for (const p of pulseCells) {
        hexPath(ctx, p.x, p.y, S * 1.4);
        ctx.strokeStyle = p.color + "55";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      pointer.inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      pointer.x = x;
      pointer.y = y;
      if (pointer.inside && performance.now() - lastRipple > 340) {
        lastRipple = performance.now();
        ripples.push({ x, y, born: performance.now() });
        if (ripples.length > 5) ripples.shift();
      }
    };
    const onLeave = () => {
      pointer.inside = false;
    };
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) ripples.push({ x, y, born: performance.now() });
    };
    const onResize = () => {
      rebuild();
      if (reduced) staticFrame();
    };

    rebuild();

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);
    const onVis = () => {
      running = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);

    if (reduced) {
      staticFrame();
      window.addEventListener("resize", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVis);
        io.disconnect();
      };
    }

    raf = requestAnimationFrame(frame);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("blur", onLeave);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("resize", onResize);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      role="presentation"
    />
  );
}
