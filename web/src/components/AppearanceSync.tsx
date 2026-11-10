import { useEffect } from 'react';
import { resolveAppearance } from '@product-rating/shared';
import { applyAppearance } from '@/lib/appearance';
import { useSession } from '@/lib/queries';

/**
 * Keeps the document in the appearance of the account that is logged in.
 *
 * It renders nothing. Whenever the session says something new - after a login,
 * after a choice on the settings screen, after another device changed it and
 * this one asked again - the attributes on `<html>` follow.
 *
 * Without a session nothing happens, on purpose: the login screen keeps the
 * look of the last visit instead of falling back to the defaults.
 */
export function AppearanceSync() {
  const session = useSession();
  const user = session.data;

  // `resolveAppearance` also covers an answer without the field, which is what
  // a server from before appearances existed would send.
  const { layout, scheme, palette } = resolveAppearance(user?.appearance);
  const known = user != null;

  useEffect(() => {
    if (known) applyAppearance({ layout, scheme, palette });
  }, [known, layout, scheme, palette]);

  return null;
}
