import { PagePlaceholder } from '@/components/Feedback';
import { strings } from '@/lib/strings';

/** The scanner. Camera stream, `zxing-wasm` and manual entry follow in M8. */
export function ScanPage() {
  return <PagePlaceholder title={strings.nav.scan} text={strings.placeholder.scan} />;
}
