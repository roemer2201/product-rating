import { Link } from 'react-router';
import type { ProductWithRatings } from '@product-rating/shared';
import { StarDisplay } from '@/components/StarRating';
import { api } from '@/lib/api';
import { formatAverage, SCORE_GLYPH } from '@/lib/format';
import { strings } from '@/lib/strings';

/**
 * One product as a row in a list.
 *
 * The whole row is the link, which on a phone is the difference between hitting
 * the product and hitting the gap next to its name. What it shows is picked for
 * the question a list answers: is this the thing I am holding (picture, name,
 * variant, brand), and what did we think of it (average, and whether I rated it
 * myself). The variant gets a line of its own: where a product line has a dozen
 * flavours, it is the only thing that tells two rows apart.
 *
 * Every row is exactly four lines high - name, variant, brand, stars - so a
 * list reads as an even column. A product without a variant keeps the line
 * empty, and none of the lines wraps: long texts are cut with an ellipsis, and
 * the average next to the stars uses the short form "9,0 (2)", which fits
 * beside ten stars even on a narrow phone.
 *
 * That describes the classic layout. The other layouts arrange the same
 * elements differently - a dense two-line row, a tile under a large picture -
 * and do so in `styles/layouts.css` alone: the markup here is one and the same
 * for all of them. The only element that exists for their sake is the score, a
 * single star with the number behind it. It replaces the row of ten stars
 * where there is no room for one, and is hidden where there is. Because the
 * row of stars stays in the markup and keeps its label, a screen reader hears
 * the same in every layout; the score is decoration and marked as such.
 */

interface ProductCardProps {
  product: ProductWithRatings;
  /** Shown instead of the average where the own verdict is the point. */
  showOwnRating?: boolean;
}

export function ProductCard({ product, showOwnRating = false }: ProductCardProps) {
  const own = product.ownRating;

  return (
    <li className="product-card">
      <Link className="product-card__link" to={`/products/${product.id}`}>
        {product.primaryPhotoId === null ? (
          <span className="product-card__thumb product-card__thumb--empty" aria-hidden="true" />
        ) : (
          <img
            className="product-card__thumb"
            src={api.photos.url(product.primaryPhotoId, 'thumb')}
            alt={strings.catalogue.photoAlt(product.name)}
            loading="lazy"
          />
        )}

        <span className="product-card__body">
          <span className="product-card__name">{product.name}</span>
          {product.variant !== null ? (
            <span className="product-card__variant">{product.variant}</span>
          ) : (
            // A no-break space gives the empty line the height of a filled one.
            <span className="product-card__variant" aria-hidden="true">
              {'\u00a0'}
            </span>
          )}
          <span className="product-card__brand">
            {/* A dish says so first; its brand field holds where it comes from. */}
            {[
              ...(product.kind === 'dish' ? [strings.product.dishBadge] : []),
              product.brand ??
                (product.kind === 'dish' ? strings.product.noSource : strings.product.noBrand),
              ...(product.categories.length > 0
                ? [product.categories.map((entry) => entry.name).join(', ')]
                : []),
            ].join(' · ')}
          </span>

          <span className="product-card__rating">
            {showOwnRating && own !== null ? (
              <>
                <StarDisplay stars={own.stars} />
                <span className="product-card__score" aria-hidden="true">
                  <span className="product-card__score-glyph">{SCORE_GLYPH}</span> {own.stars}
                </span>
                {own.comment !== null && (
                  <span className="product-card__comment">{own.comment}</span>
                )}
              </>
            ) : product.ratings.count === 0 ? (
              <span className="product-card__unrated">{strings.rating.averageNone}</span>
            ) : (
              <>
                <StarDisplay stars={Math.round(product.ratings.average ?? 0)} labelled={false} />
                {/* The number follows in the average right behind it. */}
                <span className="product-card__score" aria-hidden="true">
                  <span className="product-card__score-glyph">{SCORE_GLYPH}</span>
                </span>
                <span className="product-card__average">
                  <span aria-hidden="true">
                    {strings.rating.averageShort(
                      formatAverage(product.ratings.average),
                      product.ratings.count,
                    )}
                  </span>
                  <span className="visually-hidden">
                    {formatAverage(product.ratings.average)} ·{' '}
                    {strings.rating.count(product.ratings.count)}
                  </span>
                </span>
              </>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
