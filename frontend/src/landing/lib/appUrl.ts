export const WAYMARK_APP_URL = '/map'

export function appAuthUrl(mode: 'login' | 'signup'): string {
  return `/auth?mode=${mode}`
}
