import { Route, Routes } from 'react-router';
import { AdminLayout } from '@/components/AdminLayout';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { AdminCategoriesPage } from '@/routes/AdminCategoriesPage';
import { AdminInvitesPage } from '@/routes/AdminInvitesPage';
import { AdminPage } from '@/routes/AdminPage';
import { AdminTrashPage } from '@/routes/AdminTrashPage';
import { AdminUsersPage } from '@/routes/AdminUsersPage';
import { CataloguePage } from '@/routes/CataloguePage';
import { LoginPage } from '@/routes/LoginPage';
import { NotFoundPage } from '@/routes/NotFoundPage';
import { ProductNewPage } from '@/routes/ProductNewPage';
import { ProductPage } from '@/routes/ProductPage';
import { RatingsPage } from '@/routes/RatingsPage';
import { RegisterPage } from '@/routes/RegisterPage';
import { ResetPasswordPage } from '@/routes/ResetPasswordPage';
import { ScanPage } from '@/routes/ScanPage';
import { SettingsPage } from '@/routes/SettingsPage';

/**
 * The routes of the app.
 *
 * Two layers: `RequireAuth` decides whether a screen may be shown at all,
 * `AppLayout` gives the ones behind it their header and bottom navigation. The
 * login, registration and password screens carry their own layout, so they sit
 * outside both.
 *
 * Paths are English like the rest of the code, and they mirror the navigation
 * one to one — `/` is the catalogue because that is the screen someone opening
 * the app expects to see.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      {/* Outside the login for the same reason as the two above: whoever opens
          it cannot log in — that is what the link is for. */}
      <Route path="/reset" element={<ResetPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<CataloguePage />} />
          <Route path="scan" element={<ScanPage />} />
          {/* Before `:id`, or "new" would be read as an identifier. */}
          <Route path="products/new" element={<ProductNewPage />} />
          <Route path="products/:id" element={<ProductPage />} />
          <Route path="ratings" element={<RatingsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          {/* One role check for the overview and every screen behind it. */}
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminPage />} />
            <Route path="categories" element={<AdminCategoriesPage />} />
            <Route path="invites" element={<AdminInvitesPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="trash" element={<AdminTrashPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
