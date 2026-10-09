import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { ApiError } from '../lib/api'
import { opsApi } from '../lib/opsApi'
import { ROLE_LABELS } from '../lib/types.ops'
import { Card, PageContainer, PageHeader } from '../components/ui'

const fieldClass = 'mt-1 block min-h-11 w-full rounded-lg border border-navy/20 bg-white px-3 py-2 text-navy outline-none focus:border-brass focus:ring-2 focus:ring-brass/20'
const buttonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-navy px-4 py-2 font-semibold text-ivory hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-60'
const isDemoAccount = (id: string) => id.startsWith('demo-') || !id.includes('@')
const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'Could not save your changes. Please try again.'

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [profileName, setProfileName] = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileNotice, setProfileNotice] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || isDemoAccount(user.id)) return
    const controller = new AbortController()
    setProfileLoading(true)
    opsApi.profile(controller.signal)
      .then((profile) => {
        setProfileName(profile.name)
        updateUser(profile)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setProfileError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileLoading(false)
      })
    return () => controller.abort()
  }, [user?.id, updateUser])

  if (!user) {
    return <Navigate to="/auth?mode=login" replace state={{ returnTo: `${location.pathname}${location.search}` }} />
  }

  if (isDemoAccount(user.id)) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Account" title="Settings" />
        <Card className="p-6">
          <p className="font-semibold">Demo accounts do not have a persistent profile or password.</p>
          <p className="mt-2 text-navy/70">Create or sign in to a WAYMARK account to manage profile settings.</p>
        </Card>
      </PageContainer>
    )
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileBusy(true)
    setProfileError(null)
    setProfileNotice(null)
    try {
      const updated = await opsApi.updateProfile({ name: profileName.trim() })
      updateUser(updated)
      setProfileName(updated.name)
      setProfileNotice('Profile updated.')
    } catch (error) {
      setProfileError(errorMessage(error))
    } finally {
      setProfileBusy(false)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError(null)
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    setPasswordBusy(true)
    try {
      await opsApi.changePassword({ current_password: currentPassword, new_password: newPassword })
      logout()
      navigate('/auth?mode=login', { replace: true, state: { notice: 'Password changed. Sign in again.' } })
    } catch (error) {
      setPasswordError(errorMessage(error))
      setPasswordBusy(false)
    }
  }

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader eyebrow="Account" title="Settings">
        Manage your profile and account security.
      </PageHeader>

      <div className="space-y-6">
        <Card className="p-6 md:p-8">
          <h2 className="font-serif text-2xl font-bold text-navy">Profile</h2>
          <p className="mt-1 text-navy/70">Your email and workspace role are fixed for this account.</p>
          {profileLoading ? (
            <p role="status" className="mt-5 text-navy/70">Loading profile…</p>
          ) : (
            <form className="mt-5 space-y-4" onSubmit={(event) => void saveProfile(event)}>
              <label className="block font-semibold" htmlFor="profile-name">
                Name
                <input id="profile-name" className={fieldClass} value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={100} required />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <span className="font-semibold">Email</span>
                  <p className="mt-1 min-h-11 break-all rounded-lg bg-ivory-200 px-3 py-2 text-navy/80">{user.id}</p>
                </div>
                <div>
                  <span className="font-semibold">Workspace</span>
                  <p className="mt-1 min-h-11 rounded-lg bg-ivory-200 px-3 py-2 text-navy/80">{ROLE_LABELS[user.role]}</p>
                </div>
              </div>
              {profileError && <p role="alert" className="font-semibold text-brick">{profileError}</p>}
              {profileNotice && <p role="status" className="font-semibold text-teal">{profileNotice}</p>}
              <button className={buttonClass} type="submit" disabled={profileBusy || profileLoading}>
                {profileBusy ? 'Saving…' : 'Save profile'}
              </button>
            </form>
          )}
        </Card>

        <Card className="p-6 md:p-8">
          <h2 className="font-serif text-2xl font-bold text-navy">Change password</h2>
          <p className="mt-1 text-navy/70">Changing your password signs out all active sessions.</p>
          <form className="mt-5 space-y-4" onSubmit={(event) => void changePassword(event)}>
            <label className="block font-semibold" htmlFor="current-password">
              Current password
              <input id="current-password" className={fieldClass} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} maxLength={256} required />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block font-semibold" htmlFor="new-password">
                New password
                <input id="new-password" className={fieldClass} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={6} maxLength={256} required />
              </label>
              <label className="block font-semibold" htmlFor="confirm-password">
                Confirm new password
                <input id="confirm-password" className={fieldClass} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={6} maxLength={256} required />
              </label>
            </div>
            {passwordError && <p role="alert" className="font-semibold text-brick">{passwordError}</p>}
            <button className={buttonClass} type="submit" disabled={passwordBusy}>
              {passwordBusy ? 'Updating…' : 'Change password'}
            </button>
          </form>
        </Card>
      </div>
    </PageContainer>
  )
}
