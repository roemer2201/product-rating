import { Route, Routes } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { AdminPage } from '@/routes/AdminPage';
import { CataloguePage } from '@/routes/CataloguePage';
import { LoginPage } from '@/routes/LoginPage';
import { NotFoundPage } from '@/routes/NotFoundPage';
import { ProductNewPage } from '@/routes/ProductNewPage';
import { ProductPage } from '@/routes/ProductPage';
import { RatingsPage } from '@/routes/RatingsPage';
import { RegisterPage } from '@/routes/RegisterPage';
import { ScanPage } from '@/routes/ScanPage';
import { SettingsPage } from '@/routes/SettingsPage';

/**
 * The routes of the app.
 *
 * Two layers: `RequireAuth` decides whether a screen may be shown at all,
 * `AppLayout` gives the ones behind it their header and bottom navigation. The
 * login and registration screens carry their own layout, so they sit outside
 * both.
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

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<CataloguePage />} />
          <Route path="scan" element={<ScanPage />} />
          {/* Before `:id`, or "new" would be read as an identifier. */}
          <Route path="products/new" element={<ProductNewPage />} />
          <Route path="products/:id" element={<ProductPage />} />
          <Route path="ratings" element={<RatingsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
