import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollToBottomEdge } from './scroll.js';

/** An element that claims to end `bottom` pixels below the top of the screen. */
function elementEndingAt(bottom: number): Element {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => ({ ...new DOMRect(0, bottom - 40, 320, 40), bottom });
  return element;
}

/** A fixed bottom navigation of the given height. */
function navOfHeight(height: number): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'app-nav';
  nav.getBoundingClientRect = () => new DOMRect(0, 800 - height, 320, height);
  document.body.append(nav);
  return nav;
}

function spyOnScroll(): ReturnType<typeof vi.fn> {
  const scrollBy = vi.fn();
  vi.stubGlobal('scrollBy', scrollBy);
  vi.stubGlobal('visualViewport', { height: 800 });
  return scrollBy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('scrollToBottomEdge', () => {
  it('scrolls down until the element ends above the lower edge', () => {
    const scrollBy = spyOnScroll();

    scrollToBottomEdge(elementEndingAt(1000), 8);

    // 1000 - (800 - 0 - 8)
    expect(scrollBy).toHaveBeenCalledWith({ top: 208, behavior: 'smooth' });
  });

  it('keeps the bottom navigation out of the way', () => {
    const scrollBy = spyOnScroll();
    navOfHeight(64);

    scrollToBottomEdge(elementEndingAt(1000), 8);

    // 1000 - (800 - 64 - 8)
    expect(scrollBy).toHaveBeenCalledWith({ top: 272, behavior: 'smooth' });
  });

  it('scrolls back up when the element sits higher than the lower edge', () => {
    const scrollBy = spyOnScroll();

    scrollToBottomEdge(elementEndingAt(300), 8);

    expect(scrollBy).toHaveBeenCalledWith({ top: -492, behavior: 'smooth' });
  });

  it('does nothing when the element is already there', () => {
    const scrollBy = spyOnScroll();

    scrollToBottomEdge(elementEndingAt(792), 8);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('falls back to the layout viewport when there is no visual one', () => {
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('innerHeight', 600);

    scrollToBottomEdge(elementEndingAt(1000), 8);

    expect(scrollBy).toHaveBeenCalledWith({ top: 408, behavior: 'smooth' });
  });

  it('jumps instead of gliding when motion is unwanted', () => {
    const scrollBy = spyOnScroll();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );

    scrollToBottomEdge(elementEndingAt(1000), 8);

    expect(scrollBy).toHaveBeenCalledWith({ top: 208, behavior: 'auto' });
  });
});
