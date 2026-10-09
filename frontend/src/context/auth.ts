import { createContext, useContext } from 'react'
import type { RoleId, UserOut } from '../lib/types.ops'

export interface AuthState {
  user: UserOut | null
  /** True while a sign-in request is running. */
  busy: boolean
  /** Last sign-in problem, in plain words. */
  error: string | null
  login: (username: string, password: string) => Promise<boolean>
  signup: (name: string, email: string, password: string, role: RoleId) => Promise<boolean>
  demoLogin: (role: RoleId) => Promise<boolean>
  updateUser: (user: UserOut) => void
  logout: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
