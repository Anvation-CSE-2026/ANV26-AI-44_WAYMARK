import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/auth'

/** Branded sign-in prompt that continues through the app's shared account flow. */
export function SignIn() {
  const { user } = useAuth()
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`

  if (user) return null

  return (
    <section className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-navy/10 bg-white/85 p-6 shadow-lift md:p-8" aria-labelledby="region-access-title">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-brass-700">WAYMARK workspace</p>
      <h2 id="region-access-title" className="font-serif text-2xl font-bold leading-tight md:text-[30px]">
        Sign in to explore this region
      </h2>
      <p className="mt-2 max-w-xl leading-relaxed text-navy/70">
        Region analysis, the assistant and action plans are available with a WAYMARK account. You can keep browsing the risk map without signing in.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/auth?mode=login"
          state={{ returnTo }}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-navy px-5 py-2.5 text-sm font-semibold text-ivory transition-colors hover:bg-navy-soft"
        >
          Sign in
        </Link>
        <Link
          to="/auth?mode=signup"
          state={{ returnTo }}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-navy/20 bg-white px-5 py-2.5 text-sm font-semibold text-navy transition-colors hover:border-brass hover:bg-ivory"
        >
          Create an account
        </Link>
      </div>
    </section>
  )
}

/** Shows the sign-in panel instead of its children until someone is signed in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return user ? <>{children}</> : <SignIn />
}
