import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarDisplay, StarRating } from '@/components/StarRating';
import { strings } from '@/lib/strings';

describe('StarRating', () => {
  it('offers zero to five stars as one radio group', () => {
    render(<StarRating value={null} onChange={vi.fn()} />);

    const group = screen.getByRole('radiogroup', { name: strings.rating.starsLabel });
    expect(group).toBeInTheDocument();
    // Zero is a rating of its own, so six options rather than five.
    expect(screen.getAllByRole('radio')).toHaveLength(6);
  });

  it('reports the number of stars that was picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<StarRating value={null} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: strings.rating.starLabel(4) }));

    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('lets zero stars be chosen deliberately', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<StarRating value={3} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: strings.rating.starLabel(0) }));

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('marks the current value for assistive technology', () => {
    render(<StarRating value={2} onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: strings.rating.starLabel(2) })).toBeChecked();
    expect(screen.getByRole('radio', { name: strings.rating.starLabel(3) })).not.toBeChecked();
  });

  it('does not report anything while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<StarRating value={1} onChange={onChange} disabled />);
    await user.click(screen.getByRole('radio', { name: strings.rating.starLabel(5) }));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('StarDisplay', () => {
  it('says the rating in words for a screen reader', () => {
    render(<StarDisplay stars={3} />);
    expect(screen.getByRole('img', { name: strings.rating.starsOf(3) })).toHaveTextContent('★★★☆☆');
  });

  it('stays silent where the text next to it already says it', () => {
    const { container } = render(<StarDisplay stars={3} labelled={false} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});
