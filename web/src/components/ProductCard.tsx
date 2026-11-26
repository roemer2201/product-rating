import { Link } from 'react-router';
import { RATING_MAX_STARS, type ProductWithRatings } from '@product-rating/shared';
import { DishIcon, EditIcon, PackageIcon } from '@/components/icons';
import { StarDisplay } from '@/components/StarRating';
import { api } from '@/lib/api';
import { OWN_RATING_ANCHOR } from '@/lib/links';
import { formatAverage } from '@/lib/format';
import { strings } from '@/lib/strings';

interface ProductCardProps {
  product: ProductWithRatings;
  /** Shown instead of the average where the own verdict is the point. */
  showOwnRating?: boolean;
}

/** The catalogue shows the household average, "Meine Bewertungen" the caller's verdict. */
export function ProductCard({ product, showOwnRating = false }: ProductCardProps) {
  const own = showOwnRating ? product.ownRating : null;
  const stars = own?.stars ?? product.ratings.average;
  const score = own !== null ? String(own.stars) : formatAverage(stars);

  return (
    <li className="product-card">
      <Link className="product-card__link" to={`/products/${product.id}`}>
        {product.primaryPhotoId === null ? (
          <span className="product-card__thumb product-card__thumb--empty" aria-hidden="true">
            {product.kind === 'dish' ? <DishIcon /> : <PackageIcon />}
          </span>
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
          {product.variant !== null && (
            <span className="product-card__variant">{product.variant}</span>
          )}
          <span className="product-card__brand">
            {[
              ...(product.kind === 'dish' ? [strings.product.dishBadge] : []),
              product.brand ??
                (product.kind === 'dish' ? strings.product.noSource : strings.product.noBrand),
              ...(product.categories.length > 0
                ? [product.categories.map((entry) => entry.name).join(', ')]
                : []),
            ].join(' · ')}
          </span>
        </span>

        <span className="product-card__rating">
          {stars === null ? (
            <span className="product-card__unrated">{strings.rating.averageNone}</span>
          ) : (
            <>
              <span className="product-card__score" aria-hidden="true">
                {score}
                <small>/{RATING_MAX_STARS}</small>
              </span>
              <StarDisplay stars={Math.round(stars)} labelled={own !== null} />
              {own === null ? (
                <>
                  <span className="product-card__count" aria-hidden="true">
                    {strings.rating.count(product.ratings.count)}
                  </span>
                  <span className="visually-hidden">
                    {score} · {strings.rating.count(product.ratings.count)}
                  </span>
                </>
              ) : (
                own.comment !== null && <span className="product-card__comment">{own.comment}</span>
              )}
            </>
          )}
        </span>
      </Link>
      <Link
        to={`/products/${product.id}#${OWN_RATING_ANCHOR}`}
        className="product-card__action"
        aria-label={strings.rating.rateProduct(product.name)}
        title={strings.rating.rateProduct(product.name)}
      >
        <EditIcon className="button__icon" />
        <span>{strings.rating.rate}</span>
      </Link>
    </li>
  );
}
