import { useState } from 'react'
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
  const isDemo = user.id.startsWith('demo-') || !user.id.includes('@')
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
      {!isDemo && (
        <Link to="/settings" aria-label="Account settings" className="rounded-md border border-white/25 px-2.5 py-1.5 text-sm font-semibold text-ivory hover:bg-white/10">
          <span aria-hidden="true" className="sm:hidden">⚙</span>
          <span className="hidden sm:inline">Settings</span>
        </Link>
      )}
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
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const allLinks = user?.role === 'planner' ? [...links, { to: '/incident-reports', label: 'Incident review', end: false }] : links
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-brass text-navy' : 'text-ivory/85 hover:bg-white/10 hover:text-ivory'}`
  return (
    <header className="sticky top-0 z-[1200] bg-navy text-ivory shadow-card">
      <div className="relative flex h-16 w-full items-center gap-2 px-2 sm:gap-4 sm:px-4">
        <Link to="/" aria-label="WAYMARK home" className="shrink-0">
          <Logo tone="dark" wordmarkClass="max-[420px]:hidden" />
        </Link>
        <nav aria-label="Primary" className="ml-auto hidden min-w-0 gap-1 overflow-x-auto lg:flex lg:absolute lg:left-1/2 lg:ml-0 lg:-translate-x-1/2">
          {allLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={navClass}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <Account />
        <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/25 text-xl lg:hidden" aria-expanded={menuOpen} aria-controls="mobile-primary-nav" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} onClick={() => setMenuOpen((v) => !v)}>
          <span aria-hidden="true">{menuOpen ? '×' : '☰'}</span>
        </button>
      </div>
      {menuOpen && <nav id="mobile-primary-nav" aria-label="Mobile primary" className="absolute inset-x-0 top-full z-[1201] grid gap-1 border-t border-white/10 bg-navy p-3 shadow-card lg:hidden">
        {allLinks.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={navClass} onClick={() => setMenuOpen(false)}>{l.label}</NavLink>)}
      </nav>}
    </header>
  )
}
