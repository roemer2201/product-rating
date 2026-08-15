import { NavLink } from 'react-router';
import type { ComponentType } from 'react';
import { CatalogueIcon, ScanIcon, SettingsIcon, StarIcon } from '@/components/icons';
import { strings } from '@/lib/strings';

/**
 * The bottom navigation.
 *
 * It sits at the bottom because that is where the thumb is on a phone held in
 * one hand, and scanning is the middle entry and the only one with a filled
 * button: it is the action the app exists for. `NavLink` sets
 * `aria-current="page"` on the active entry, which is what both the styling and
 * a screen reader go by.
 */

interface NavEntry {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** The primary action, drawn as a raised button. */
  primary?: boolean;
}

export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/', label: strings.nav.catalogue, icon: CatalogueIcon },
  { to: '/scan', label: strings.nav.scan, icon: ScanIcon, primary: true },
  { to: '/ratings', label: strings.nav.ratings, icon: StarIcon },
  { to: '/settings', label: strings.nav.settings, icon: SettingsIcon },
];

export function BottomNav() {
  return (
    <nav className="app-nav" aria-label={strings.nav.label}>
      <ul className="app-nav__list">
        {NAV_ENTRIES.map((entry) => {
          const Icon = entry.icon;
          return (
            <li className="app-nav__item" key={entry.to}>
              <NavLink
                to={entry.to}
                // Without this every entry would be active on `/`, which is a
                // prefix of all of them.
                end={entry.to === '/'}
                className={entry.primary === true ? 'nav-link nav-link--scan' : 'nav-link'}
              >
                <Icon className="nav-link__icon" />
                {entry.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
