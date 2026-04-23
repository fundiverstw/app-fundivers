import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AdminRoute } from './components/layout/AdminRoute'
import { AppShell } from './components/layout/AppShell'
import { AdminShell } from './components/layout/AdminShell'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { CalendarPage } from './pages/CalendarPage'
import { BookingsPage } from './pages/BookingsPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { ProfilePage } from './pages/ProfilePage'
import { DashboardPage } from './pages/DashboardPage'
import { EelSnakePage } from './pages/EelSnakePage'
import { AdminEventsPage } from './pages/admin/AdminEventsPage'
import { AdminEventDetailPage } from './pages/admin/AdminEventDetailPage'
import { AdminGearMapPage } from './pages/admin/AdminGearMapPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { AdminDutyPage } from './pages/admin/AdminDutyPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/bookings" element={<BookingsPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
          <Route path="/minigame/eel-snake" element={<EelSnakePage />} />
          <Route element={<AdminRoute />}>
            <Route element={<AdminShell />}>
              <Route path="/admin" element={<DashboardPage />} />
              <Route path="/admin/events" element={<AdminEventsPage />} />
              <Route path="/admin/events/:type/:id" element={<AdminEventDetailPage />} />
              <Route path="/admin/events/:type/:id/gear-map" element={<AdminGearMapPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/duty" element={<AdminDutyPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/calendar" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
