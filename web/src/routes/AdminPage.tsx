import { Link } from 'react-router';
import { strings } from '@/lib/strings';

/**
 * The administration: one entry per job, each on a screen of its own.
 *
 * Reached from the settings rather than from the bottom navigation: it is used
 * when someone joins the household, when the category list needs a new entry
 * or when something was deleted by mistake - a handful of times in the life of
 * an instance. The navigation belongs to what is used daily.
 *
 * Separate screens rather than one long page, because the jobs have nothing to
 * do with each other: whoever wants to add a category should not have to
 * scroll past invite codes and password links to get there.
 *
 * The role check sits in `AdminLayout`, around this screen and the ones it
 * leads to.
 */

const ENTRIES = [
  {
    to: '/admin/categories',
    title: strings.admin.categoriesTitle,
    summary: strings.admin.categoriesSummary,
  },
  {
    to: '/admin/invites',
    title: strings.admin.invitesTitle,
    summary: strings.admin.invitesSummary,
  },
  { to: '/admin/users', title: strings.admin.usersTitle, summary: strings.admin.usersSummary },
  { to: '/admin/trash', title: strings.admin.trashTitle, summary: strings.admin.trashSummary },
] as const;

export function AdminPage() {
  return (
    <section>
      <h1 className="page__title">{strings.admin.title}</h1>
      <p className="page__intro">{strings.admin.intro}</p>

      <ul className="admin-nav">
        {ENTRIES.map((entry) => (
          <li key={entry.to}>
            <Link className="admin-nav__link" to={entry.to}>
              <span className="admin-nav__title">{entry.title}</span>
              <span className="admin-nav__summary">{entry.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
