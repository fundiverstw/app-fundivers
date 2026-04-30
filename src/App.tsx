import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AdminRoute } from './components/layout/AdminRoute'
import { StaffOrAdminRoute } from './components/layout/StaffOrAdminRoute'
import { Logo } from './components/Logo'
import { ToastProvider } from './components/Toast'
import { AppShell } from './components/layout/AppShell'
import { AdminShell } from './components/layout/AdminShell'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { TermsPage } from './pages/TermsPage'
import { CalendarPage } from './pages/CalendarPage'
import { MapPage } from './pages/MapPage'
import { BookingsPage } from './pages/BookingsPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { ProfilePage } from './pages/ProfilePage'
import { DashboardPage } from './pages/DashboardPage'
import { DutiesPage } from './pages/DutiesPage'
import { EelSnakePage } from './pages/EelSnakePage'
import { AdminEventsPage } from './pages/admin/AdminEventsPage'
import { AdminEventDetailPage } from './pages/admin/AdminEventDetailPage'
import { AdminGearMapPage } from './pages/admin/AdminGearMapPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { AdminDutyPage } from './pages/admin/AdminDutyPage'
import { AdminNewEventPage } from './pages/admin/AdminNewEventPage'
import { AdminEditEventPage } from './pages/admin/AdminEditEventPage'
import { AdminManagePage } from './pages/admin/AdminManagePage'
import { AdminRoomsPage } from './pages/admin/AdminRoomsPage'
import { AdminAddonsPage } from './pages/admin/AdminAddonsPage'
import { AdminTravelPage } from './pages/admin/AdminTravelPage'

// Public registration flow — /register (pick an event) and /register/:type/:id
// (deep-link from Wix calendar) both render RegisterPage. Outside ProtectedRoute
// so cold visitors don't hit an auth wall; lazy-loaded so the cold path doesn't
// pay for the full PWA bundle.
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage }))
)

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route
          path="/register"
          element={
            <Suspense fallback={<RegisterLoading />}>
              <RegisterPage />
            </Suspense>
          }
        />
        <Route
          path="/register/:type/:id"
          element={
            <Suspense fallback={<RegisterLoading />}>
              <RegisterPage />
            </Suspense>
          }
        />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/bookings" element={<BookingsPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/duties" element={<DutiesPage />} />
          </Route>
          <Route path="/minigame/eel-snake" element={<EelSnakePage />} />
          {/* Read-only event surfaces — accessible to staff + admin */}
          <Route element={<StaffOrAdminRoute />}>
            <Route element={<AdminShell />}>
              <Route path="/admin" element={<DashboardPage />} />
              <Route path="/admin/events" element={<AdminEventsPage />} />
              <Route path="/admin/events/:type/:id" element={<AdminEventDetailPage />} />
              <Route path="/admin/events/:type/:id/gear-map" element={<AdminGearMapPage />} />
            </Route>
          </Route>
          {/* Write/manage routes — admin only */}
          <Route element={<AdminRoute />}>
            <Route element={<AdminShell />}>
              <Route path="/admin/new" element={<AdminManagePage />} />
              <Route path="/admin/new/event" element={<AdminNewEventPage />} />
              <Route path="/admin/rooms" element={<AdminRoomsPage />} />
              <Route path="/admin/addons" element={<AdminAddonsPage />} />
              <Route path="/admin/travel" element={<AdminTravelPage />} />
              <Route path="/admin/events/:type/:id/edit" element={<AdminEditEventPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/duty" element={<AdminDutyPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/calendar" replace />} />
      </Routes>
      </ToastProvider>
    </BrowserRouter>
  )
}

function RegisterLoading() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
      <Logo size="lg" />
      <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
