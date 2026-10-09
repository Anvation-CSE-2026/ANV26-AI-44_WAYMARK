import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { Footer } from './components/Footer'
import { Nav } from './components/Nav'
import { LogoLoader } from './components/ui'

const MapPage = lazy(() => import('./pages/MapPage'))
const EvidencePage = lazy(() => import('./pages/EvidencePage'))
const DataQualityPage = lazy(() => import('./pages/DataQualityPage'))
const AuditListPage = lazy(() => import('./pages/AuditListPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const RegionPage = lazy(() => import('./pages/RegionPage'))
const AuthPage = lazy(() => import('./pages/AuthPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const IncidentReportsPage = lazy(() => import('./pages/IncidentReportsPage'))
const LandingPage = lazy(() => import('./landing/LandingPage'))

function AppContent() {
  const { pathname } = useLocation()
  if (pathname === '/') {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><LogoLoader label="Loading WAYMARK" /></div>}>
        <LandingPage />
      </Suspense>
    )
  }
  if (pathname === '/auth') {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><LogoLoader label="Loading sign in" /></div>}>
        <AuthPage />
      </Suspense>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a className="skip-link" href="#main">Skip to content</a>
      <Nav />
      <main id="main" className="flex flex-1 flex-col">
        <Suspense fallback={<div className="flex flex-1 items-center justify-center py-24"><LogoLoader label="Loading" /></div>}>
          <Routes>
            <Route path="/map" element={<MapPage />} />
            <Route path="/evidence" element={<EvidencePage />} />
            <Route path="/data-quality" element={<DataQualityPage />} />
            <Route path="/audit-list" element={<AuditListPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/incident-reports" element={<IncidentReportsPage />} />
            <Route path="/region/:regionId" element={<RegionPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      {pathname !== '/map' && <Footer />}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  )
}
