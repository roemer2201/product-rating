import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PullToRefresh } from '@/components/PullToRefresh';
import { strings } from '@/lib/strings';

/**
 * The pull gesture of the catalogue.
 *
 * What is worth asserting is the decision, not the pixels: how far the finger
 * has to travel before letting go reloads, and when the gesture has to keep its
 * hands off - scrolled down, switched off, or already refreshing. The distance
 * the content moves is a transform and stays the browser's business.
 *
 * jsdom has no scrolling, so `window.scrollY` is set directly; the component
 * only ever reads it.
 */

/** Damping is one half, so the finger travels twice the threshold of 64px. */
const PAST_THRESHOLD = 200;
const BELOW_THRESHOLD = 40;

function scrolledTo(y: number): void {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
}

/** One drag on the page, from the top downwards by `distance` pixels. */
function pull(distance: number): void {
  const start = 100;
  fireEvent.touchStart(window, { touches: [{ clientY: start }] });
  fireEvent.touchMove(window, { touches: [{ clientY: start + distance }] });
  fireEvent.touchEnd(window, { touches: [] });
}

function renderPull(props: Partial<Parameters<typeof PullToRefresh>[0]> = {}) {
  const onRefresh = props.onRefresh ?? vi.fn().mockResolvedValue(undefined);
  const view = render(
    <PullToRefresh onRefresh={onRefresh} {...props}>
      <p>Katalog</p>
    </PullToRefresh>,
  );

  return { ...view, onRefresh };
}

describe('PullToRefresh', () => {
  it('reloads when the drag passes the threshold', async () => {
    scrolledTo(0);
    const { onRefresh } = renderPull();

    pull(PAST_THRESHOLD);

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it('leaves a short drag alone', async () => {
    scrolledTo(0);
    const { onRefresh } = renderPull();

    pull(BELOW_THRESHOLD);

    // The symbol was shown along the way, but nothing was reloaded.
    await waitFor(() => {
      expect(document.querySelector('.pull-refresh')).toHaveAttribute('data-phase', 'idle');
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('announces the drag and the reload', async () => {
    scrolledTo(0);
    const finished = vi.fn();
    renderPull({
      onRefresh: () =>
        new Promise<void>((resolve) => {
          finished.mockImplementation(resolve);
        }),
    });

    fireEvent.touchStart(window, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(window, { touches: [{ clientY: 130 }] });
    expect(screen.getByRole('status')).toHaveTextContent(strings.pullRefresh.idle);

    fireEvent.touchMove(window, { touches: [{ clientY: 100 + PAST_THRESHOLD }] });
    expect(screen.getByRole('status')).toHaveTextContent(strings.pullRefresh.ready);

    fireEvent.touchEnd(window, { touches: [] });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(strings.pullRefresh.refreshing);
    });

    await act(async () => {
      finished();
    });
  });

  it('stays out of the way once the page is scrolled', () => {
    scrolledTo(240);
    const { onRefresh } = renderPull();

    pull(PAST_THRESHOLD);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(document.querySelector('.pull-refresh')).toHaveAttribute('data-phase', 'idle');
  });

  it('does nothing while it is switched off', () => {
    scrolledTo(0);
    const { onRefresh } = renderPull({ disabled: true });

    pull(PAST_THRESHOLD);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('gives up the gesture as soon as the page moves under the finger', () => {
    scrolledTo(0);
    const { onRefresh } = renderPull();

    fireEvent.touchStart(window, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(window, { touches: [{ clientY: 300 }] });
    // The page has scrolled away beneath the drag - what follows is a scroll.
    scrolledTo(120);
    fireEvent.touchMove(window, { touches: [{ clientY: 400 }] });
    fireEvent.touchEnd(window, { touches: [] });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not start a second reload while one is running', async () => {
    scrolledTo(0);
    const finished = vi.fn();
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finished.mockImplementation(resolve);
        }),
    );
    renderPull({ onRefresh });

    pull(PAST_THRESHOLD);
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    pull(PAST_THRESHOLD);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      finished();
    });
  });

  it('claims the touch so the browser does not scroll as well', () => {
    scrolledTo(0);
    renderPull();

    fireEvent.touchStart(window, { touches: [{ clientY: 100 }] });

    const move = new TouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
      // jsdom builds no `Touch` objects, so the list is handed over as is.
      touches: [{ clientY: 300 } as unknown as Touch],
    });
    window.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(true);
  });
});
