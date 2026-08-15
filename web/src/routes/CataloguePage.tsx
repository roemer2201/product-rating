import { PagePlaceholder } from '@/components/Feedback';
import { strings } from '@/lib/strings';

/** The product list. Search, filters, thumbnails and paging follow in M8. */
export function CataloguePage() {
  return <PagePlaceholder title={strings.nav.catalogue} text={strings.placeholder.catalogue} />;
}
