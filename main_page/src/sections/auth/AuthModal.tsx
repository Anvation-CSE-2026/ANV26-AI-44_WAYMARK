import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Eye, EyeOff, Loader2, AlertCircle, Hexagon } from "lucide-react";
import { useMotion, EASE } from "../../lib/motion";
import { useFocusTrap } from "../../lib/useFocusTrap";
import {
  continueWithGoogle,
  createAccount,
  isEmail,
  signInWithPassword,
  MIN_PASSWORD,
  type AuthUser,
} from "../../lib/auth";
import { cn } from "../../utils/cn";

type View = "login" | "register";
interface Values {
  name: string;
  email: string;
  password: string;
  confirm: string;
}
type Errors = Partial<Record<keyof Values, string>>;

const EMPTY: Values = { name: "", email: "", password: "", confirm: "" };

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z" />
    </svg>
  );
}

const inputCls = (invalid: boolean) =>
  cn(
    "w-full rounded-xl border bg-white px-4 py-3 text-[14.5px] text-navy transition outline-none placeholder:text-ink/35",
    invalid ? "border-brick/60 focus:border-brick focus:ring-2 focus:ring-brick/20" : "border-navy/15 focus:border-brass focus:ring-2 focus:ring-brass/25",
  );

export default function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (u: AuthUser) => void }) {
  const { reduced } = useMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("login");
  const [dir, setDir] = useState(1);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"password" | "google" | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [shake, setShake] = useState(0);

  useFocusTrap(cardRef, true);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
    setServerError(null);
  };

  const switchView = (v: View) => {
    setDir(v === "register" ? 1 : -1);
    setView(v);
    setErrors({});
    setServerError(null);
    setShowPw(false);
  };

  const fail = (msg: string) => {
    setServerError(msg);
    setShake((s) => s + 1);
  };

  const submitLogin = async () => {
    const er: Errors = {};
    if (!values.email.trim()) er.email = "Enter your email.";
    else if (!isEmail(values.email)) er.email = "Enter a valid email address.";
    if (!values.password) er.password = "Enter your password.";
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy("password");
    try {
      onSuccess(await signInWithPassword(values.email, values.password));
    } catch (e) {
      fail(e instanceof Error ? e.message : "Invalid email or password. Please try again.");
      setBusy(null);
    }
  };

  const submitRegister = async () => {
    const er: Errors = {};
    if (!values.name.trim()) er.name = "Enter your full name.";
    if (!values.email.trim()) er.email = "Enter your email.";
    else if (!isEmail(values.email)) er.email = "Enter a valid email address.";
    if (!values.password) er.password = "Choose a password.";
    else if (values.password.length < MIN_PASSWORD) er.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (values.confirm !== values.password || !values.confirm) er.confirm = "Passwords do not match.";
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy("password");
    try {
      onSuccess(await createAccount(values.name, values.email, values.password));
    } catch (e) {
      fail(e instanceof Error ? e.message : "We couldn't create your account. Please try again.");
      setBusy(null);
    }
  };

  const handleGoogle = async () => {
    setBusy("google");
    setServerError(null);
    try {
      await continueWithGoogle();
    } catch (e) {
      // Show the specific error message (e.g., "Unauthorized domain")
      const msg = e instanceof Error ? e.message : "Google sign-in didn't complete. Please try again.";
      setServerError(msg);
      setShake((s) => s + 1);
      setBusy(null);
    }
  };

  const field = (
    key: keyof Values,
    label: string,
    placeholder: string,
    type: string,
    autoComplete: string,
    hint?: string,
  ) => (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-navy">{label}</span>
      <input
        type={type}
        value={values[key]}
        onChange={set(key)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `err-${key}` : hint ? `hint-${key}` : undefined}
        className={inputCls(!!errors[key])}
      />
      {errors[key] ? (
        <span id={`err-${key}`} role="alert" className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-brick">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {errors[key]}
        </span>
      ) : hint ? (
        <span id={`hint-${key}`} className="mt-1.5 block text-[11.5px] text-ink/45">
          {hint}
        </span>
      ) : null}
    </label>
  );

  const pwField = (key: "password" | "confirm", label: string, placeholder: string, autoComplete: string, hint?: string) => (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-navy">{label}</span>
      <span className="relative block">
        <input
          type={showPw ? "text" : "password"}
          value={values[key]}
          onChange={set(key)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `err-${key}` : hint ? `hint-${key}` : undefined}
          className={cn(inputCls(!!errors[key]), "pr-12")}
        />
        <button
          type="button"
          onClick={() => setShowPw((s) => !s)}
          aria-label={showPw ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-3 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink/45 transition-colors hover:text-navy"
        >
          {showPw ? <EyeOff className="h-[17px] w-[17px]" strokeWidth={1.7} aria-hidden="true" /> : <Eye className="h-[17px] w-[17px]" strokeWidth={1.7} aria-hidden="true" />}
        </button>
      </span>
      {errors[key] ? (
        <span id={`err-${key}`} role="alert" className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-brick">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {errors[key]}
        </span>
      ) : hint ? (
        <span id={`hint-${key}`} className="mt-1.5 block text-[11.5px] text-ink/45">
          {hint}
        </span>
      ) : null}
    </label>
  );

  const viewVariants = {
    enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : 26 * d }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : -26 * d }),
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto p-4 sm:p-6" role="presentation">
      {/* backdrop */}
      <motion.button
        aria-label="Close sign-in dialog"
        onClick={() => !busy && onClose()}
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
        aria-labelledby="auth-title"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.45, ease: EASE.out }}
        className="relative my-auto w-full max-w-[440px] rounded-[22px] border border-navy/10 bg-[#fdfbf7] shadow-[0_32px_80px_-24px_rgba(12,23,48,0.5)]"
      >
        <motion.div key={shake} animate={shake ? { x: reduced ? 0 : [0, -9, 9, -6, 6, 0] } : undefined} transition={{ duration: 0.45 }} className="p-7 sm:p-9">
          {/* close */}
          <button
            onClick={() => !busy && onClose()}
            aria-label="Close"
            className="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-full border border-navy/10 text-ink/50 transition-colors hover:border-navy/25 hover:text-navy"
          >
            <X className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </button>

          <span className="relative grid h-11 w-11 place-items-center">
            <Hexagon className="h-11 w-11 text-navy" strokeWidth={1.2} aria-hidden="true" />
            <span className="absolute h-2 w-2 rounded-full bg-brass" aria-hidden="true" />
          </span>

          <AnimatePresence mode="wait" custom={dir} initial={false}>
            {view === "login" && (
              <motion.div
                key="login"
                custom={dir}
                variants={viewVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.35, ease: EASE.out }}
              >
                <h2 id="auth-title" className="mt-5 font-serif text-[30px] leading-tight font-semibold text-navy">
                  Welcome
                </h2>
                <p className="mt-1.5 text-[14px] text-ink/60">Sign in to access your road-safety workspace.</p>

                {serverError && (
                  <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-brick/35 bg-brick/8 px-3.5 py-2.5 text-[13px] font-medium text-brick">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
                    {serverError}
                  </p>
                )}

                <form
                  className="mt-6 grid gap-4"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!busy) submitLogin();
                  }}
                >
                  {field("email", "Email", "Enter your email", "email", "email")}
                  {pwField("password", "Password", "Enter your password", "current-password", `Demo mode — any email, ${MIN_PASSWORD}+ characters.`)}
                  <button
                    type="submit"
                    disabled={!!busy}
                    className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-3.5 text-[15px] font-semibold text-ivory transition-all duration-300 hover:-translate-y-0.5 hover:bg-navy-soft hover:shadow-[0_14px_34px_-10px_rgba(18,32,59,0.55)] disabled:translate-y-0 disabled:opacity-60"
                  >
                    {busy === "password" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
                    {busy === "password" ? "Signing in…" : "Sign in"}
                  </button>
                </form>

                <div className="my-5 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-navy/10" />
                  <span className="text-[10.5px] font-semibold tracking-[0.22em] text-ink/40">OR</span>
                  <span className="h-px flex-1 bg-navy/10" />
                </div>

                <button
                  onClick={handleGoogle}
                  disabled={!!busy}
                  className="flex w-full items-center justify-center gap-3 rounded-xl border border-navy/15 bg-white py-3.5 text-[14.5px] font-semibold text-navy transition-all duration-300 hover:border-navy/30 hover:shadow-[0_10px_26px_-12px_rgba(18,32,59,0.35)] disabled:opacity-60"
                >
                  {busy === "google" ? <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2} aria-hidden="true" /> : <GoogleMark />}
                  {busy === "google" ? "Opening Google…" : "Continue with Google"}
                </button>

                <p className="mt-5 text-center text-[13.5px] text-ink/55">
                  No account?{" "}
                  <button onClick={() => switchView("register")} className="font-semibold text-brass underline decoration-brass/40 underline-offset-4 transition-colors hover:text-[#8a6a25]">
                    Create one
                  </button>
                </p>
              </motion.div>
            )}



            {view === "register" && (
              <motion.div
                key="register"
                custom={dir}
                variants={viewVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.35, ease: EASE.out }}
              >
                <h2 id="auth-title" className="mt-5 font-serif text-[30px] leading-tight font-semibold text-navy">
                  Create your account
                </h2>
                <p className="mt-1.5 text-[14px] text-ink/60">A prototype account — nothing is stored or sent anywhere.</p>

                {serverError && (
                  <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-brick/35 bg-brick/8 px-3.5 py-2.5 text-[13px] font-medium text-brick">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
                    {serverError}
                  </p>
                )}

                <form
                  className="mt-6 grid gap-4"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!busy) submitRegister();
                  }}
                >
                  {field("name", "Full name", "Enter your full name", "text", "name")}
                  {field("email", "Email", "Enter your email", "email", "email")}
                  {pwField("password", "Password", "Choose a password", "new-password", `At least ${MIN_PASSWORD} characters.`)}
                  {pwField("confirm", "Confirm password", "Repeat your password", "new-password")}
                  <button
                    type="submit"
                    disabled={!!busy}
                    className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-3.5 text-[15px] font-semibold text-ivory transition-all duration-300 hover:-translate-y-0.5 hover:bg-navy-soft hover:shadow-[0_14px_34px_-10px_rgba(18,32,59,0.55)] disabled:translate-y-0 disabled:opacity-60"
                  >
                    {busy === "password" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
                    {busy === "password" ? "Creating account…" : "Create account"}
                  </button>
                </form>

                <p className="mt-5 text-center text-[13.5px] text-ink/55">
                  Already have an account?{" "}
                  <button onClick={() => switchView("login")} className="font-semibold text-brass underline decoration-brass/40 underline-offset-4 transition-colors hover:text-[#8a6a25]">
                    Sign in
                  </button>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}
