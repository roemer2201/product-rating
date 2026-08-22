import { useCallback, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { eanSchema } from '@product-rating/shared';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { ErrorNotice } from '@/components/Feedback';
import { Field } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { isApiError } from '@/lib/api';
import { useEanLookup } from '@/lib/queries';
import { strings } from '@/lib/strings';

/**
 * Scanning, and what happens after a hit.
 *
 * Both ways in end in the same place: the camera and the text field hand over a
 * normalised EAN, it is looked up, and the answer decides the destination — a
 * known product goes to its page, an unknown one to the form with the EAN
 * already filled in. Nobody types thirteen digits twice.
 *
 * Manual entry is not a fallback tucked away behind an error. It sits on the
 * same screen as the camera because there are barcodes no camera reads: a
 * crumpled freezer bag, a bottle in a dark cellar, a phone whose camera the
 * household has switched off.
 */
export function ScanPage() {
  const navigate = useNavigate();
  const lookup = useEanLookup();

  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | undefined>(undefined);
  const [scanned, setScanned] = useState<string | null>(null);

  /**
   * Sends a found EAN on its way. `useCallback` is not cosmetic here: the
   * scanner restarts its decode loop whenever this changes, and a new function
   * on every render would restart it several times a second.
   */
  const handleEan = useCallback(
    (ean: string) => {
      setScanned(ean);

      lookup.mutate(ean, {
        onSuccess: (product) => {
          if (product === null) {
            void navigate(`/products/new?ean=${encodeURIComponent(ean)}`);
          } else {
            void navigate(`/products/${product.id}`);
          }
        },
        onError: (error) => {
          // No connection: whether the catalogue knows this EAN cannot be
          // answered here, so the form takes what the person has to say and
          // the queue sorts it out later.
          if (isApiError(error) && error.isNetworkError) {
            void navigate(`/products/new?ean=${encodeURIComponent(ean)}`);
          }
        },
      });
    },
    [lookup, navigate],
  );

  const onManualSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const parsed = eanSchema.safeParse(manual);
    if (!parsed.success) {
      setManualError(strings.validation.ean);
      return;
    }

    setManualError(undefined);
    handleEan(parsed.data);
  };

  return (
    <section>
      <h1 className="page__title">{strings.scan.title}</h1>
      <p className="page__intro">{strings.scan.intro}</p>

      <BarcodeScanner onDetected={handleEan} paused={lookup.isPending} />

      {lookup.isPending && (
        <p className="notice" role="status">
          {scanned === null
            ? strings.scan.searching
            : `${strings.scan.found(scanned)} – ${strings.scan.searching}`}
        </p>
      )}

      {lookup.error !== null && <ErrorNotice message={errorMessage(lookup.error)} />}

      <section className="section">
        <h2 className="section__title">{strings.scan.manualTitle}</h2>
        <p className="section__intro">{strings.scan.manualIntro}</p>

        <form className="form" onSubmit={onManualSubmit} noValidate>
          <Field
            label={strings.fields.ean}
            name="ean"
            value={manual}
            onChange={(event) => {
              setManual(event.target.value);
              setManualError(undefined);
            }}
            // A numeric keypad on a phone, but still a text field: the EAN keeps
            // its leading zeros and may be pasted with spaces or dashes.
            inputMode="numeric"
            autoComplete="off"
            hint={strings.scan.manualHint}
            error={manualError}
            required
          />

          <button
            type="submit"
            className="button button--primary"
            disabled={lookup.isPending || manual.trim() === ''}
          >
            {lookup.isPending ? strings.scan.searching : strings.scan.manualSubmit}
          </button>
        </form>
      </section>
    </section>
  );
}
