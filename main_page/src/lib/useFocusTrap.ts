import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Minimal focus trap for modals: moves focus inside on open, cycles Tab/Shift+Tab,
 * and restores focus to the previously focused element on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const prev = document.activeElement as HTMLElement | null;
    const collect = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));

    const t = window.setTimeout(() => {
      const els = collect();
      (els[0] ?? root).focus();
    }, 70);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = collect();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [ref, active]);
}
