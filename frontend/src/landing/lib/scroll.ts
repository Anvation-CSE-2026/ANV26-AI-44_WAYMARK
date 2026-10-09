import type Lenis from "lenis";

/** App-owned Lenis instance, registered once so anchors can scroll smoothly. */
let lenis: Lenis | null = null;
export const setLenis = (l: Lenis | null) => {
  lenis = l;
};

export function scrollToId(id: string, reduced: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis && !reduced) {
    lenis.scrollTo(el, { offset: -70, duration: 1.3, easing: (t) => 1 - Math.pow(1 - t, 4) });
  } else {
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }
}
