import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { ROLE_LABELS } from '../lib/types.ops'
import type { RoleId } from '../lib/types.ops'
import { Logo } from './Logo'

const links = [
  { to: '/map', label: 'Map', end: true },
  { to: '/evidence', label: 'Evidence', end: false },
  { to: '/data-quality', label: 'Data quality', end: false },
  { to: '/audit-list', label: 'Audit list', end: false },
  { to: '/about', label: 'About', end: false },
]

const ROLES = Object.keys(ROLE_LABELS) as RoleId[]

function Account() {
  const { user, demoLogin, logout, busy } = useAuth()
  if (!user) {
    return <span className="ml-auto shrink-0 text-sm text-ivory/70">Not signed in</span>
  }
  const isDemo = user.id.startsWith('demo-')
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2 border-l border-white/20 pl-3">
      <div className="max-w-[150px] text-right leading-tight" title={user.name}>
        <span className="block truncate text-sm font-semibold text-ivory">
          <span className="sr-only">Signed in as </span>{user.name}
        </span>
        <span data-testid="role-badge" className="block text-xs text-ivory/65">
          {ROLE_LABELS[user.role]}
        </span>
      </div>
      {isDemo && (
        <label className="hidden text-sm sm:block">
          <span className="sr-only">Switch demo role</span>
          <select
            value={user.role}
            disabled={busy}
            onChange={(e) => void demoLogin(e.target.value as RoleId)}
            className="rounded-md border border-white/30 bg-navy-800 px-2 py-1 text-sm text-ivory"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={logout}
        aria-label="Sign out"
        className="rounded-md bg-red-700 px-2.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-600"
      >
        <span aria-hidden="true" className="sm:hidden">✕</span>
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  )
}

export function Nav() {
  return (
    <header className="sticky top-0 z-[1200] h-16 bg-navy text-ivory shadow-card">
      <div className="relative flex h-full w-full items-center gap-4 px-4">
        <Link to="/" aria-label="WAYMARK home" className="shrink-0">
          <Logo tone="dark" wordmarkClass="max-[420px]:hidden" />
        </Link>
        <nav aria-label="Primary" className="ml-auto flex min-w-0 gap-1 overflow-x-auto xl:absolute xl:left-1/2 xl:ml-0 xl:-translate-x-1/2">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-base font-medium transition-colors ${
                  isActive ? 'bg-brass text-navy' : 'text-ivory/85 hover:bg-white/10 hover:text-ivory'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <Account />
      </div>
    </header>
  )
}
