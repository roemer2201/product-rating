import { PagePlaceholder } from '@/components/Feedback';
import { strings } from '@/lib/strings';

/** Password, own sessions and the administration area. Follows in M8. */
export function SettingsPage() {
  return <PagePlaceholder title={strings.nav.settings} text={strings.placeholder.settings} />;
}
