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
function catalogue(): HTMLElement {
  return screen.getByText('Katalog');
}

function pull(distance: number): void {
  const start = 100;
  fireEvent.touchStart(catalogue(), { touches: [{ clientX: 100, identifier: 1, clientY: start }] });
  fireEvent.touchMove(catalogue(), {
    touches: [{ clientX: 100, identifier: 1, clientY: start + distance }],
  });
  fireEvent.touchEnd(catalogue(), { touches: [] });
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
  it('cancels an armed gesture when it is disabled before release', () => {
    scrolledTo(0);
    const { onRefresh, rerender } = renderPull();
    fireEvent.touchStart(catalogue(), { touches: [{ clientX: 100, clientY: 100, identifier: 1 }] });
    fireEvent.touchMove(catalogue(), { touches: [{ clientX: 100, clientY: 300, identifier: 1 }] });

    rerender(
      <PullToRefresh onRefresh={onRefresh} disabled>
        <p>Katalog</p>
      </PullToRefresh>,
    );
    fireEvent.touchEnd(catalogue(), { touches: [] });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(document.querySelector('.pull-refresh')).toHaveAttribute('data-phase', 'idle');
  });

  it('does not resume a cancelled gesture after it is enabled again', () => {
    scrolledTo(0);
    const { onRefresh, rerender } = renderPull();
    fireEvent.touchStart(catalogue(), { touches: [{ clientX: 100, clientY: 100, identifier: 1 }] });
    fireEvent.touchMove(catalogue(), { touches: [{ clientX: 100, clientY: 130, identifier: 1 }] });
    rerender(
      <PullToRefresh onRefresh={onRefresh} disabled>
        <p>Katalog</p>
      </PullToRefresh>,
    );
    rerender(
      <PullToRefresh onRefresh={onRefresh}>
        <p>Katalog</p>
      </PullToRefresh>,
    );
    fireEvent.touchMove(catalogue(), { touches: [{ clientX: 100, clientY: 300, identifier: 1 }] });
    fireEvent.touchEnd(catalogue(), { touches: [] });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('returns the content to rest when a second finger joins the pull', () => {
    scrolledTo(0);
    const { onRefresh } = renderPull();
    const first = { clientX: 100, clientY: 300, identifier: 1 };
    const second = { clientX: 200, clientY: 300, identifier: 2 };
    fireEvent.touchStart(catalogue(), { touches: [{ ...first, clientY: 100 }] });
    fireEvent.touchMove(catalogue(), { touches: [first] });
    fireEvent.touchStart(catalogue(), { touches: [first, second] });

    expect(document.querySelector('.pull-refresh')).toHaveAttribute('data-phase', 'idle');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    fireEvent.touchEnd(catalogue(), { touches: [first] });
    fireEvent.touchMove(catalogue(), { touches: [{ ...first, clientY: 400 }] });
    fireEvent.touchEnd(catalogue(), { touches: [] });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('keeps a horizontal swipe with downward drift out of the pull gesture', () => {
    scrolledTo(0);
    const { onRefresh } = renderPull();
    fireEvent.touchStart(catalogue(), { touches: [{ clientX: 100, clientY: 100, identifier: 1 }] });
    const move = new TouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
      touches: [{ clientX: 300, clientY: 130, identifier: 1 } as Touch],
    });
    catalogue().dispatchEvent(move);
    expect(move.defaultPrevented).toBe(false);
    // Changing direction later must not steal an already horizontal swipe.
    fireEvent.touchMove(catalogue(), { touches: [{ clientX: 300, clientY: 400, identifier: 1 }] });
    fireEvent.touchEnd(catalogue(), { touches: [] });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('ignores a pull starting outside its content', () => {
    scrolledTo(0);
    const { onRefresh } = renderPull();
    fireEvent.touchStart(document.body, {
      touches: [{ clientX: 100, clientY: 100, identifier: 1 }],
    });
    fireEvent.touchMove(document.body, {
      touches: [{ clientX: 100, clientY: 300, identifier: 1 }],
    });
    fireEvent.touchEnd(document.body, { touches: [] });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not claim a gesture already owned by the browser', () => {
    scrolledTo(0);
    const { onRefresh } = renderPull();
    fireEvent.touchStart(catalogue(), { touches: [{ clientX: 100, clientY: 100, identifier: 1 }] });
    fireEvent.touchMove(catalogue(), {
      cancelable: false,
      touches: [{ clientX: 100, clientY: 300, identifier: 1 }],
    });
    fireEvent.touchEnd(catalogue(), { touches: [] });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('locks the refresh before React commits another render', () => {
    scrolledTo(0);
    const { onRefresh } = renderPull();
    act(() => {
      pull(PAST_THRESHOLD);
      pull(PAST_THRESHOLD);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

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

    fireEvent.touchStart(catalogue(), { touches: [{ clientX: 100, identifier: 1, clientY: 100 }] });
    fireEvent.touchMove(catalogue(), { touches: [{ clientX: 100, identifier: 1, clientY: 130 }] });
    expect(screen.getByRole('status')).toHaveTextContent(strings.pullRefresh.idle);

    fireEvent.touchMove(catalogue(), {
      touches: [{ clientX: 100, identifier: 1, clientY: 100 + PAST_THRESHOLD }],
    });
    expect(screen.getByRole('status')).toHaveTextContent(strings.pullRefresh.ready);

    fireEvent.touchEnd(catalogue(), { touches: [] });
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

    fireEvent.touchStart(catalogue(), { touches: [{ clientX: 100, identifier: 1, clientY: 100 }] });
    fireEvent.touchMove(catalogue(), { touches: [{ clientX: 100, identifier: 1, clientY: 300 }] });
    // The page has scrolled away beneath the drag - what follows is a scroll.
    scrolledTo(120);
    fireEvent.touchMove(catalogue(), { touches: [{ clientX: 100, identifier: 1, clientY: 400 }] });
    fireEvent.touchEnd(catalogue(), { touches: [] });

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

    fireEvent.touchStart(catalogue(), { touches: [{ clientX: 100, identifier: 1, clientY: 100 }] });

    const move = new TouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
      // jsdom builds no `Touch` objects, so the list is handed over as is.
      touches: [{ clientX: 100, identifier: 1, clientY: 300 } as unknown as Touch],
    });
    catalogue().dispatchEvent(move);

    expect(move.defaultPrevented).toBe(true);
  });
});
