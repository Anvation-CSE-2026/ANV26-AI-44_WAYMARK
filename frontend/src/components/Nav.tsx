import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { LogOut, Settings, UserRound } from 'lucide-react'
import { ROLE_LABELS } from '../lib/types.ops'
import { Logo } from './Logo'

const links = [
  { to: '/map', label: 'Map', end: true },
  { to: '/evidence', label: 'Evidence', end: false },
  { to: '/data-quality', label: 'Data quality', end: false },
  { to: '/audit-list', label: 'Audit list', end: false },
  { to: '/about', label: 'About', end: false },
]

function Account() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!user) {
    return <span className="ml-auto shrink-0 text-sm text-ivory/70">Not signed in</span>
  }
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase() || <UserRound aria-hidden="true" className="h-5 w-5" />
  return (
    <div ref={accountRef} className="relative ml-auto shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Open profile menu for ${user.name}`}
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((value) => !value)}
        className="grid h-11 w-11 place-items-center rounded-full border border-brass/60 bg-white/10 text-sm font-bold text-ivory transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
      >
        {initials}
      </button>
      {open && (
        <div id="account-menu" role="group" aria-label="Account options" className="absolute right-0 top-full z-[1300] mt-2 w-56 rounded-xl border border-navy/10 bg-white p-2 text-navy shadow-lift">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold" title={user.name}>{user.name}</p>
            <p className="mt-0.5 truncate text-xs text-navy/65">{ROLE_LABELS[user.role]}</p>
          </div>
          <div className="my-1 border-t border-navy/10" />
          <Link to="/settings" onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-navy/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass">
            <Settings aria-hidden="true" className="h-4 w-4" /> Settings
          </Link>
          <button type="button" onClick={() => { setOpen(false); logout() }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-brick hover:bg-brick/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brick">
            <LogOut aria-hidden="true" className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
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
