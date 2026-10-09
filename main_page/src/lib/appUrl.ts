const configuredUrl = import.meta.env.VITE_WAYMARK_APP_URL?.trim()

export const WAYMARK_APP_URL = (configuredUrl || 'http://localhost:5173').replace(/\/+$/, '')

export function appAuthUrl(mode: 'login' | 'signup'): string {
  return `${WAYMARK_APP_URL}/auth?mode=${mode}`
}
