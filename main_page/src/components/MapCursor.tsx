import { useEffect, useRef, type RefObject } from "react";
import { useMotion } from "../lib/motion";

/**
 * Custom hexagon cursor with a faint trailing chain, active only over the map.
 * Disabled entirely when reduced motion is on (native cursor remains).
 */
export default function MapCursor({ container }: { container: RefObject<HTMLElement | null> }) {
  const { reduced } = useMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const host = container.current;
    if (!root || !host || reduced) return;

    const dots = Array.from(root.children) as HTMLElement[];
    const N = dots.length;
    const pos = Array.from({ length: N }, () => ({ x: -100, y: -100 }));
    const target = { x: -100, y: -100 };
    let inside = false;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      target.x = e.clientX - r.left;
      target.y = e.clientY - r.top;
      inside = true;
      root.style.opacity = "1";
    };
    const onLeave = () => {
      inside = false;
      root.style.opacity = "0";
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!inside) return;
      pos[0].x += (target.x - pos[0].x) * 0.55;
      pos[0].y += (target.y - pos[0].y) * 0.55;
      for (let i = 1; i < N; i++) {
        pos[i].x += (pos[i - 1].x - pos[i].x) * 0.38;
        pos[i].y += (pos[i - 1].y - pos[i].y) * 0.38;
      }
      for (let i = 0; i < N; i++) {
        dots[i].style.transform = `translate(${pos[i].x}px, ${pos[i].y}px) translate(-50%,-50%)`;
      }
    };
    raf = requestAnimationFrame(loop);

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [container, reduced]);

  if (reduced) return null;

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-[640] opacity-0 transition-opacity duration-300"
      aria-hidden="true"
    >
      {[14, 9, 7, 5.4, 4.2, 3.2].map((s, i) => (
        <svg
          key={i}
          width={s}
          height={s}
          viewBox="0 0 10 10"
          className="absolute top-0 left-0 will-change-transform"
          style={{ opacity: 1 - i * 0.16 }}
        >
          <polygon
            points="5,0.5 9.2,2.9 9.2,7.1 5,9.5 0.8,7.1 0.8,2.9"
            fill={i === 0 ? "rgba(184,137,59,0.12)" : "none"}
            stroke="#b8893b"
            strokeWidth="1.1"
          />
        </svg>
      ))}
    </div>
  );
}
