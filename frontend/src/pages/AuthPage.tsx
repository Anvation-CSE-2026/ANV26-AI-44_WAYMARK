import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/auth'
import { LogoMark } from '../components/Logo'
import type { RoleId } from '../lib/types.ops'

export default function AuthPage() {
  const { user, login, signup, busy, error } = useAuth()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const mode = params.get('mode') === 'signup' ? 'signup' : 'login'
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<RoleId>('community')
  const [showPassword, setShowPassword] = useState(false)

  if (user) return <Navigate to="/map" replace />

  const switchMode = (next: 'login' | 'signup') => {
    setParams({ mode: next }, { replace: true })
    setPassword('')
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const success = mode === 'login'
      ? await login(email, password)
      : await signup(name, email, password, role)
    if (success) {
      const returnTo = (location.state as { returnTo?: unknown } | null)?.returnTo
      const destination = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo
        : '/map'
      navigate(destination, { replace: true })
    }
  }

  const fieldClass = 'h-14 w-full rounded-[18px] border border-[#dedede] bg-white/80 px-5 text-[16px] font-normal text-[#19243a] shadow-[0_3px_8px_rgba(25,36,58,0.04)] outline-none transition placeholder:text-[#b4b7bd] focus:border-[#b8893b] focus:ring-2 focus:ring-[#b8893b]/15'

  return (
    <main className="auth-screen">
      <div className="auth-backdrop" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card-top">
          <Link to="/map" className="auth-back-link"><ArrowLeft size={16} /> Back to map</Link>
        </div>
        <header className="auth-brand">
          <span className="auth-mark"><LogoMark size={28} /></span>
          <span>
            <span className="auth-brand-name">WAYMARK</span>
            <span className="auth-brand-tagline">AI ROAD-SAFETY · PROTOTYPE</span>
          </span>
        </header>

        <div className="auth-intro">
          <h1 id="auth-title">{mode === 'login' ? 'Welcome' : 'Create your account'}</h1>
          <p>{mode === 'login' ? 'Sign in to access your road-safety workspace.' : 'Get access to your road-safety workspace.'}</p>
        </div>

        {mode === 'login' ? (
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label className="auth-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className={fieldClass}
              type="text"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
              maxLength={254}
              placeholder="Enter your email"
            />
            <label className="auth-label" htmlFor="auth-password">Password</label>
            <div className="auth-password-wrap">
              <input
                id="auth-password"
                className={`${fieldClass} pr-14`}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                maxLength={256}
                placeholder="Enter your password"
              />
              <button type="button" className="auth-eye" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            <p className="auth-hint">Any email · 6+ characters.</p>
            {error && <p role="alert" className="auth-error">{error}</p>}
            <button type="submit" disabled={busy} className="auth-submit">
              {busy ? 'Please wait…' : <>Sign in <ArrowRight size={20} /></>}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label className="auth-label" htmlFor="signup-name">Name</label>
            <input id="signup-name" className={fieldClass} type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={100} placeholder="Enter your name" />
            <label className="auth-label" htmlFor="signup-email">Email</label>
            <input id="signup-email" className={fieldClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={254} placeholder="Enter your email" />
            <label className="auth-label" htmlFor="signup-password">Password</label>
            <input id="signup-password" className={fieldClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={6} maxLength={256} placeholder="Create a password" />
            <label className="auth-label" htmlFor="signup-role">Role</label>
            <select id="signup-role" className={fieldClass} value={role} onChange={(event) => setRole(event.target.value as RoleId)} required>
              <option value="engineer">Road Authorities</option>
              <option value="planner">City Planner</option>
              <option value="community">Traffic Police</option>
            </select>
            <p className="auth-hint">Use at least 6 characters. Your role controls workspace permissions.</p>
            {error && <p role="alert" className="auth-error">{error}</p>}
            <button type="submit" disabled={busy} className="auth-submit">
              {busy ? 'Please wait…' : <>Sign up <ArrowRight size={20} /></>}
            </button>
          </form>
        )}

        <p className="auth-switch">
          {mode === 'login' ? <>No account? <button type="button" onClick={() => switchMode('signup')}>Create one</button></> : <>Already have an account? <button type="button" onClick={() => switchMode('login')}>Sign in</button></>}
        </p>
      </section>
    </main>
  )
}
