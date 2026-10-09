import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, ArrowRight, LogOut } from "lucide-react";
import { useMotion, EASE } from "../../lib/motion";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { initialsOf, type AuthUser } from "../../lib/auth";
import { ROLES, type RoleKey } from "../../data/roles";
import { cn } from "../../utils/cn";

const ORDER: RoleKey[] = ["authority", "planner", "police"];

/**
 * Post-authentication role selection. Exactly one role; Continue stays
 * disabled until a selection exists. Closing here signs the user back out to
 * the public landing page.
 */
export default function RoleSelection({
  user,
  onConfirm,
  onSignOut,
}: {
  user: AuthUser;
  onConfirm: (r: RoleKey) => void;
  onSignOut: () => void;
}) {
  const { reduced } = useMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<RoleKey | null>(null);

  useFocusTrap(cardRef, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSignOut();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSignOut]);

  const onRadioKeys = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = selected ? ORDER.indexOf(selected) : e.key === "ArrowRight" ? -1 : 0;
    const next = ORDER[(i + (e.key === "ArrowRight" ? 1 : ORDER.length - 1)) % ORDER.length];
    setSelected(next);
  };

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center overflow-y-auto p-4 sm:p-6" role="presentation">
      <motion.button
        aria-label="Close and sign out"
        onClick={onSignOut}
        className="fixed inset-0 cursor-default bg-navy/45 backdrop-blur-[6px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      />

      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-title"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 14 }}
        transition={{ duration: 0.5, ease: EASE.out }}
        className="relative my-auto w-full max-w-[920px] rounded-[22px] border border-navy/10 bg-[#fdfbf7] p-7 shadow-[0_32px_80px_-24px_rgba(12,23,48,0.5)] sm:p-10"
      >
        <div className="text-center">
          <p className="kicker">Authenticated · one last step</p>
          <h2 id="role-title" className="mt-3 font-serif text-[clamp(30px,4vw,42px)] leading-tight font-semibold text-navy">
            Select your role
          </h2>
          <p className="mx-auto mt-2 max-w-[46ch] text-[14.5px] text-ink/60">
            Choose your role to personalize your road-safety workspace.
          </p>
          <span className="mt-4 inline-flex items-center gap-2.5 rounded-full border border-navy/12 bg-white py-1.5 pr-4 pl-1.5 text-[12.5px] font-medium text-ink/70">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brass text-[11px] font-bold text-white">
              {initialsOf(user.name)}
            </span>
            Signed in as <strong className="font-semibold text-navy">{user.email}</strong>
            {user.provider === "google" && (
              <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-ink/50 uppercase">Google</span>
            )}
          </span>
        </div>

        <div className="mt-9 grid gap-4 md:grid-cols-3" role="radiogroup" aria-label="Choose your role" onKeyDown={onRadioKeys}>
          {ORDER.map((key, i) => {
            const meta = ROLES[key];
            const isSel = selected === key;
            return (
              <motion.button
                key={key}
                role="radio"
                aria-checked={isSel}
                onClick={() => setSelected(key)}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.12 + i * 0.08, ease: EASE.out }}
                whileHover={reduced ? undefined : { y: -4 }}
                className={cn(
                  "group relative flex flex-col rounded-2xl border p-6 text-left transition-all duration-300",
                  isSel
                    ? "border-navy bg-navy/[0.045] shadow-[var(--shadow-lift)] ring-1 ring-navy"
                    : "border-navy/12 bg-white shadow-[var(--shadow-card)] hover:border-navy/50 hover:bg-[#fffcf6]",
                )}
              >
                <span
                  className={cn(
                    "grid h-12 w-12 place-items-center rounded-xl transition-all duration-300",
                    isSel ? "bg-navy text-ivory" : "bg-navy/6 text-navy group-hover:bg-brass group-hover:text-white",
                  )}
                >
                  <span className="transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                    <meta.Icon className="h-[22px] w-[22px]" strokeWidth={1.5} aria-hidden="true" />
                  </span>
                </span>

                <span className="mt-5 font-serif text-[20px] font-semibold text-navy">{meta.title}</span>
                <span className="mt-2 flex-1 text-[13px] leading-relaxed text-ink/65">{meta.duty}</span>

                <span className="mt-4 text-[11px] font-semibold tracking-[0.14em] text-ink/40 uppercase">
                  +1 · {meta.feature}
                </span>

                {/* selected checkmark */}
                <motion.span
                  initial={false}
                  animate={isSel ? { scale: 1, opacity: 1 } : { scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.25, ease: EASE.springy }}
                  className="absolute top-4 right-4 grid h-6 w-6 place-items-center rounded-full bg-navy text-ivory"
                  aria-hidden="true"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </motion.span>
              </motion.button>
            );
          })}
        </div>

        <div className="mt-9 flex flex-col items-center gap-4">
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
            aria-disabled={!selected}
            className={cn(
              "group flex items-center gap-2.5 rounded-xl px-8 py-4 text-[15.5px] font-semibold transition-all duration-300",
              selected
                ? "bg-navy text-ivory shadow-[0_14px_34px_-10px_rgba(18,32,59,0.5)] hover:-translate-y-0.5 hover:bg-navy-soft"
                : "cursor-not-allowed bg-navy/20 text-ivory/70",
            )}
          >
            Continue to Workspace
            <ArrowRight
              className={cn("h-[18px] w-[18px] transition-transform duration-300", selected && "group-hover:translate-x-1")}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink/50 underline decoration-ink/25 underline-offset-4 transition-colors hover:text-brick"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            Sign out and switch account
          </button>
        </div>
      </motion.div>
    </div>
  );
}
