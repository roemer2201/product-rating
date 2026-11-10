import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ProductCard } from '@/components/ProductCard';
import { strings } from '@/lib/strings';
import { makeProduct, makeRating } from '@/testing/fixtures';
import { renderWithProviders } from '@/testing/render';

/**
 * One row of a list.
 *
 * The layouts show a rating either as a row of stars or as one star with a
 * number, and pick between the two in the stylesheet. What a test can hold on
 * to is the half that does not depend on the stylesheet: the markup carries
 * both, and only one of them speaks to a screen reader.
 */

function renderCard(ui: Parameters<typeof renderWithProviders>[0]) {
  return renderWithProviders(<ul>{ui}</ul>);
}

describe('ProductCard', () => {
  it('names an own rating once, however a layout draws it', () => {
    renderCard(
      <ProductCard
        product={makeProduct({ ownRating: makeRating({ stars: 9, comment: 'Kaufen wir wieder' }) })}
        showOwnRating
      />,
    );

    // The row of stars is the one that carries the label ...
    expect(screen.getByRole('img', { name: strings.rating.starsOf(9) })).toBeInTheDocument();
    // ... and the score next to it is for the eye alone.
    const score = screen.getByText('9', { selector: '.product-card__score' });
    expect(score).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Kaufen wir wieder')).toBeInTheDocument();
  });

  it('writes the average once in words and keeps the glyphs out of the way', () => {
    renderCard(<ProductCard product={makeProduct({ ratings: { average: 8.5, count: 2 } })} />);

    const link = screen.getByRole('link');
    // No image role here: the text behind the stars already says it.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(link).toHaveTextContent(strings.rating.count(2));
    expect(link.querySelector('.product-card__score')).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no score to show for a product nobody rated', () => {
    renderCard(<ProductCard product={makeProduct()} />);

    expect(screen.getByText(strings.rating.averageNone)).toBeInTheDocument();
    expect(screen.getByRole('link').querySelector('.product-card__score')).toBeNull();
  });
});
