import { PagePlaceholder } from '@/components/Feedback';
import { strings } from '@/lib/strings';

/** Own ratings, on `GET /api/v1/ratings/mine`. Follows in M8. */
export function RatingsPage() {
  return <PagePlaceholder title={strings.nav.ratings} text={strings.placeholder.ratings} />;
}
