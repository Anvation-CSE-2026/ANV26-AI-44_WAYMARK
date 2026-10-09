import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, setAuthToken, setUnauthorizedHandler } from '../lib/api'
import { opsApi } from '../lib/opsApi'
import type { RoleId, TokenOut, UserOut } from '../lib/types.ops'
import { AuthContext } from './auth'

const KEY = 'waymark.auth'

interface Stored {
  token: string
  user: UserOut
}

/** Token expiry is read from the JWT payload so an old stored session is dropped without a round trip. */
function expired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 5_000
  } catch {
    return true
  }
}

function restore(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Stored
    if (!s?.token || !s?.user?.role || expired(s.token)) return null
    setAuthToken(s.token) // set before the first child renders so its first request is already signed
    return s
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Stored | null>(restore)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback((t: TokenOut) => {
    setAuthToken(t.access_token)
    setSession({ token: t.access_token, user: t.user })
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ token: t.access_token, user: t.user }))
    } catch {
      /* storage unavailable: the session just lasts until reload */
    }
  }, [])

  const logout = useCallback(() => {
    setAuthToken(null)
    setSession(null)
    setError(null)
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      /* storage unavailable */
    }
  }, [])

  const updateUser = useCallback((user: UserOut) => {
    setSession((prev) => (prev ? { ...prev, user } : prev))
    try {
      const raw = sessionStorage.getItem(KEY)
      if (raw) sessionStorage.setItem(KEY, JSON.stringify({ ...(JSON.parse(raw) as Stored), user }))
    } catch {
      /* profile remains updated until the page is reloaded */
    }
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout()
      setError('Your session expired. Please sign in again.')
    })
    return () => setUnauthorizedHandler(null)
  }, [logout])

  const run = useCallback(
    async (fn: () => Promise<TokenOut>) => {
      setBusy(true)
      setError(null)
      try {
        apply(await fn())
        return true
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [apply],
  )

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      busy,
      error,
      login: (u: string, p: string) => run(() => opsApi.login(u, p)),
      signup: (name: string, email: string, password: string, role: RoleId) => run(() => opsApi.signup(name, email, password, role)),
      demoLogin: (role: RoleId) => run(() => opsApi.demo(role)),
      updateUser,
      logout,
    }),
    [session, busy, error, run, updateUser, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
