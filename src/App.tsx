import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AdminRoute } from './components/layout/AdminRoute'
import { StaffOrAdminRoute } from './components/layout/StaffOrAdminRoute'
import { RequireActive } from './components/layout/RequireActive'
import { RequireCurrentTerms } from './components/layout/RequireCurrentTerms'
import { HomeRedirect } from './components/layout/HomeRedirect'
import { PendingPage } from './pages/PendingPage'
import { Logo } from './components/Logo'
import { ToastProvider } from './components/Toast'
import { AuthProvider } from './hooks/AuthProvider'
import { ShopContactProvider } from './hooks/ShopContactProvider'
import { UpdateBannerHost } from './components/install/UpdateBannerHost'
import { AppShell } from './components/layout/AppShell'
import { AdminShell } from './components/layout/AdminShell'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { TermsPage } from './pages/TermsPage'
import { AcceptTermsPage } from './pages/AcceptTermsPage'
import { CalendarPage } from './pages/CalendarPage'
import { BookingsPage } from './pages/BookingsPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { RecordsPage } from './pages/RecordsPage'
import { DiveLogsPage } from './pages/DiveLogsPage'
import { ProfilePage } from './pages/ProfilePage'
import { ContactPage } from './pages/ContactPage'
import { TrustedPartnersPage } from './pages/TrustedPartnersPage'
import { PackagesPage } from './pages/PackagesPage'
import { PackageDetailPage } from './pages/PackageDetailPage'
import { ScheduledTripsPage } from './pages/ScheduledTripsPage'
import { ScheduledTripDetailPage } from './pages/ScheduledTripDetailPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { DashboardPage } from './pages/DashboardPage'
import { DutiesPage } from './pages/DutiesPage'
import { AdminEventsPage } from './pages/admin/AdminEventsPage'
import { AdminEventDetailPage } from './pages/admin/AdminEventDetailPage'
import { AdminGearMapPage } from './pages/admin/AdminGearMapPage'
import { AdminLogisticsPage } from './pages/admin/AdminLogisticsPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { AdminCreateDiverPage } from './pages/admin/AdminCreateDiverPage'
import { AdminApplicationsPage } from './pages/admin/AdminApplicationsPage'
import { AdminDutyPage } from './pages/admin/AdminDutyPage'
import { AdminNewEventPage } from './pages/admin/AdminNewEventPage'
import { AdminEditEventPage } from './pages/admin/AdminEditEventPage'
import { AdminManagePage } from './pages/admin/AdminManagePage'
import { AdminRoomsPage } from './pages/admin/AdminRoomsPage'
import { AdminAddonsPage } from './pages/admin/AdminAddonsPage'
import { AdminTravelPage } from './pages/admin/AdminTravelPage'
import { AdminDestinationsPage } from './pages/admin/AdminDestinationsPage'
import { AdminPricesPage } from './pages/admin/AdminPricesPage'
import { AdminNotificationsPage } from './pages/admin/AdminNotificationsPage'
import { AdminAccountingPage } from './pages/admin/AdminAccountingPage'
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminRefundsPage } from './pages/admin/AdminRefundsPage'
import { AdminAuditsPage } from './pages/admin/AdminAuditsPage'
import { AdminBackupPage } from './pages/admin/AdminBackupPage'
import { AdminShutdownPage } from './pages/admin/AdminShutdownPage'
import { AdminHistoryPage } from './pages/admin/AdminHistoryPage'
import { AdminPackagesPage } from './pages/admin/AdminPackagesPage'
import { AdminScheduledTripsPage } from './pages/admin/AdminScheduledTripsPage'
import { AdminTrustedPartnersPage } from './pages/admin/AdminTrustedPartnersPage'
import { AdminGearSizingPage } from './pages/admin/AdminGearSizingPage'
import { AdminVehiclesPage } from './pages/admin/AdminVehiclesPage'
import { AdminWaiversPage } from './pages/admin/AdminWaiversPage'
import { AdminTermsPage } from './pages/admin/AdminTermsPage'
import { AdminCancellationPoliciesPage } from './pages/admin/AdminCancellationPoliciesPage'
import { AdminPaymentMethodsPage } from './pages/admin/AdminPaymentMethodsPage'
import { AdminContactPage } from './pages/admin/AdminContactPage'
import { AdminDiveSitesPage } from './pages/admin/AdminDiveSitesPage'
import { AdminWildlifePage } from './pages/admin/AdminWildlifePage'

// Almanac page
// Lazy like its neighbours, and more so: this page pulls in the WebGL scene,
// which has no business in the bundle every diver downloads to look at their
// bookings.
const SiteMapPage = lazy(() =>
  import('./pages/SiteMapPage').then(m => ({ default: m.SiteMapPage }))
)
const AlmanacPage = lazy(() =>
  import('./pages/AlmanacPage').then(m => ({ default: m.AlmanacPage }))
)

// Coral survey page
const CoralPage = lazy(() =>
  import('./pages/CoralPage').then(m => ({ default: m.CoralPage }))
)

// Public registration flow — /register (pick an event) and /register/:id
// (deep-link from Wix calendar) both render RegisterPage. Outside ProtectedRoute
// so cold visitors don't hit an auth wall; lazy-loaded so the cold path doesn't
// pay for the full PWA bundle.
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage }))
)

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
      {/* Outside the auth guards on purpose: the pages that show the shop's
          email include the ones a diver reaches before approval, and the
          terms-acceptance page, which runs from an emailed link with no
          session at all. */}
      <ShopContactProvider>
      <ToastProvider>
      <UpdateBannerHost />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/terms" element={<TermsPage />} />
        {/* Public: a one-time emailed link, for the diver who has no session
            to be gated by (see AcceptTermsPage). */}
        <Route path="/accept-terms" element={<AcceptTermsPage />} />
        <Route
          path="/register"
          element={
            <Suspense fallback={<RegisterLoading />}>
              <RegisterPage />
            </Suspense>
          }
        />
        <Route
          path="/register/:id"
          element={
            <Suspense fallback={<RegisterLoading />}>
              <RegisterPage />
            </Suspense>
          }
        />
        <Route element={<ProtectedRoute />}>
          <Route element={<RequireCurrentTerms />}>
          {/* /pending is reachable to authenticated-but-not-active users.
              Outside RequireActive so it's where pending divers actually land. */}
          <Route path="/pending" element={<PendingPage />} />
          <Route element={<RequireActive />}>
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<DashboardPage quickLinks />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/almanac" element={<AlmanacPage />} />
              <Route path="/coral" element={<CoralPage />} />
              <Route path="/records" element={<RecordsPage />}>
                <Route index element={<Navigate to="bookings" replace />} />
                <Route path="bookings" element={<BookingsPage />} />
                <Route path="payments" element={<PaymentsPage />} />
                <Route path="dive-logs" element={<DiveLogsPage />} />
              </Route>
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/trusted-partners" element={<TrustedPartnersPage />} />
              <Route path="/packages" element={<PackagesPage />} />
              <Route path="/packages/:id" element={<PackageDetailPage />} />
              <Route path="/scheduled-trips" element={<ScheduledTripsPage />} />
              <Route path="/scheduled-trips/:id" element={<ScheduledTripDetailPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/duties" element={<DutiesPage />} />
            </Route>
            {/* Read-only event surfaces — accessible to staff + admin */}
            <Route element={<StaffOrAdminRoute />}>
              <Route element={<AdminShell />}>
                <Route path="/admin" element={<Navigate to="/admin/logistics" replace />} />
                {/* The home screen (same DashboardPage divers land on) inside the
                    admin chrome — where the header logo points. Distinct from the
                    /admin login-landing (logistics) and the BI /admin/dashboard.
                    Carries the same shortcut tiles: none of the four appear in the
                    admin chrome, and the dive-site map is admin-only, so this is
                    the one place an admin can reach it. */}
                <Route path="/admin/home" element={<DashboardPage quickLinks />} />
                <Route path="/admin/events" element={<AdminEventsPage />} />
                <Route path="/admin/events/:id" element={<AdminEventDetailPage />} />
                <Route path="/admin/events/:id/gear-map" element={<AdminGearMapPage />} />
                <Route path="/admin/logistics" element={<AdminLogisticsPage />} />
                {/* Staff see only the revenue tab here — the document exports
                    are admin work and the page hides them by role. */}
                <Route path="/admin/accounting" element={<AdminAccountingPage />} />
              </Route>
            </Route>
            {/* Write/manage routes — admin only */}
            <Route element={<AdminRoute />}>
              {/* Dive-site maps are staff-facing for now. The editor puts
                  whoever opens it one tap from writing a depth onto a shared
                  map, so until the shop has seen what that produces, the people
                  doing it are the people who can also undo it. Outside
                  AdminShell: it is a diver-shaped page that happens to be
                  restricted, not part of the admin console. */}
              <Route path="/site-maps" element={<SiteMapPage />} />
              <Route element={<AdminShell />}>
                <Route path="/admin/new" element={<AdminManagePage />} />
                <Route path="/admin/new/event" element={<AdminNewEventPage />} />
                <Route path="/admin/rooms" element={<AdminRoomsPage />} />
                <Route path="/admin/addons" element={<AdminAddonsPage />} />
                <Route path="/admin/travel" element={<AdminTravelPage />} />
                <Route path="/admin/destinations" element={<AdminDestinationsPage />} />
                <Route path="/admin/prices" element={<AdminPricesPage />} />
                <Route path="/admin/events/:id/edit" element={<AdminEditEventPage />} />
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/admin/create-diver" element={<AdminCreateDiverPage />} />
                <Route path="/admin/applications" element={<AdminApplicationsPage />} />
                <Route path="/admin/duty" element={<AdminDutyPage />} />
                <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
                <Route path="/admin/backup" element={<AdminBackupPage />} />
                <Route path="/admin/shutdown" element={<AdminShutdownPage />} />
                <Route path="/admin/packages" element={<AdminPackagesPage />} />
                <Route path="/admin/scheduled-trips" element={<AdminScheduledTripsPage />} />
                <Route path="/admin/trusted-partners" element={<AdminTrustedPartnersPage />} />
                <Route path="/admin/gear-sizing" element={<AdminGearSizingPage />} />
                <Route path="/admin/vehicles" element={<AdminVehiclesPage />} />
                <Route path="/admin/waivers" element={<AdminWaiversPage />} />
                <Route path="/admin/terms" element={<AdminTermsPage />} />
                <Route path="/admin/cancellation-policies" element={<AdminCancellationPoliciesPage />} />
                <Route path="/admin/payment-methods" element={<AdminPaymentMethodsPage />} />
                <Route path="/admin/contact" element={<AdminContactPage />} />
                <Route path="/admin/dive-sites" element={<AdminDiveSitesPage />} />
                <Route path="/admin/wildlife" element={<AdminWildlifePage />} />
                <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
                <Route path="/admin/refunds" element={<AdminRefundsPage />} />
                <Route path="/admin/audits" element={<AdminAuditsPage />} />
                <Route path="/admin/history" element={<AdminHistoryPage />} />
              </Route>
            </Route>
          </Route>
          </Route>
        </Route>
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
      </ToastProvider>
      </ShopContactProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

function RegisterLoading() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
      <Logo size="lg" />
      <div className="w-6 h-6 border-2 border-surface-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
