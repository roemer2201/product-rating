import { Link } from 'react-router';
import type { ProductWithRatings } from '@product-rating/shared';
import { StarDisplay } from '@/components/StarRating';
import { api } from '@/lib/api';
import { formatAverage } from '@/lib/format';
import { strings } from '@/lib/strings';

/**
 * One product as a row in a list.
 *
 * The whole row is the link, which on a phone is the difference between hitting
 * the product and hitting the gap next to its name. What it shows is picked for
 * the question a list answers: is this the thing I am holding (picture, name,
 * brand), and what did we think of it (average, and whether I rated it myself).
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
          <span className="product-card__brand">
            {product.brand ?? strings.product.noBrand}
            {product.category !== null && ` · ${product.category}`}
          </span>

          <span className="product-card__rating">
            {showOwnRating && own !== null ? (
              <>
                <StarDisplay stars={own.stars} />
                {own.comment !== null && (
                  <span className="product-card__comment">{own.comment}</span>
                )}
              </>
            ) : product.ratings.count === 0 ? (
              <span className="product-card__unrated">{strings.rating.averageNone}</span>
            ) : (
              <>
                <StarDisplay stars={Math.round(product.ratings.average ?? 0)} labelled={false} />
                <span className="product-card__average">
                  {formatAverage(product.ratings.average)} ·{' '}
                  {strings.rating.count(product.ratings.count)}
                </span>
              </>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
