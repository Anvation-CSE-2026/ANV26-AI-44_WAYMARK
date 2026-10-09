import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Global motion preference.
 * - Initialised from `prefers-reduced-motion`.
 * - Can be overridden by the "Reduce motion" toggle in the footer.
 * - When `reduced` is true every cinematic effect (scrub timelines, pins,
 *   canvas animation, cascades) is replaced with simple fades / final states.
 */
interface MotionState {
  reduced: boolean;
  setReduced: (v: boolean) => void;
}

const MotionCtx = createContext<MotionState>({ reduced: false, setReduced: () => {} });

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduced);
  }, [reduced]);

  return <MotionCtx.Provider value={{ reduced, setReduced }}>{children}</MotionCtx.Provider>;
}

export const useMotion = () => useContext(MotionCtx);

/** Shared easing curves used across GSAP + Framer Motion. */
export const EASE = {
  out: [0.16, 1, 0.3, 1] as const,      // expo-out — cinematic settle
  springy: [0.34, 1.56, 0.64, 1] as const, // gentle overshoot
  gsapOut: "expo.out",
  gsapBack: "back.out(1.4)",
};
