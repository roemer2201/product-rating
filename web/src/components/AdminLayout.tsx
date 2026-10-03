import { Link, Navigate, Outlet, useMatch } from 'react-router';
import { SkeletonList } from '@/components/Feedback';
import { BackIcon } from '@/components/icons';
import { useSession } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * The frame around every screen of the administration: the role check, and the
 * way back to the overview.
 *
 * Nothing behind it is readable without the role anyway - the server refuses
 * every one of those routes - but a screen full of 403s is a poor way to say
 * so. Checking once here rather than in each screen keeps a new one from
 * forgetting it.
 */
export function AdminLayout() {
  const session = useSession();
  const atOverview = useMatch('/admin') !== null;

  if (session.isPending) return <SkeletonList rows={3} />;

  const user = session.data;
  if (user == null || user.role !== 'admin') return <Navigate to="/settings" replace />;

  return (
    <>
      {!atOverview && (
        <Link className="button button--quiet admin-back" to="/admin">
          <BackIcon className="button__icon" />
          {strings.admin.back}
        </Link>
      )}
      <Outlet />
    </>
  );
}
