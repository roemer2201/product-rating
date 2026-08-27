/**
 * Moving the page so that a control ends up within reach of the thumb.
 *
 * The preview of a freshly taken photo is tall: the picture arrives, and the
 * buttons that decide about it are pushed below the lower edge of the screen.
 * Scrolling after every single shot is a toll on the most frequent act in the
 * app, so the page comes to the buttons instead — the picture stays above
 * them, and both are in view at once.
 */

/**
 * How much of the lower edge is covered by something fixed. That is the bottom
 * navigation; it is measured rather than calculated from `--nav-height`,
 * because the safe-area inset of an iPhone belongs to its height as well.
 */
function obstructedBottom(): number {
  const nav = document.querySelector('.app-nav');
  return nav === null ? 0 : nav.getBoundingClientRect().height;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Scrolls the page until the lower edge of `element` sits `gap` pixels above
 * whatever covers the bottom of the screen.
 *
 * The visual viewport is asked first: on iOS it is the part that is really
 * visible, while `innerHeight` also counts the strip under Safari's toolbar.
 * Getting that wrong would park the buttons underneath it.
 */
export function scrollToBottomEdge(element: Element, gap = 8): void {
  if (typeof window.scrollBy !== 'function') return;

  const viewport = window.visualViewport?.height ?? window.innerHeight;
  const delta = element.getBoundingClientRect().bottom - (viewport - obstructedBottom() - gap);

  // Below a pixel there is nothing to move, and a scroll of nothing still
  // takes the page away from someone who is dragging it themselves.
  if (Math.abs(delta) < 1) return;

  window.scrollBy({ top: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
