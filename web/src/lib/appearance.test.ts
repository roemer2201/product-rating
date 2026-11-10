import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '@product-rating/shared';
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  rememberedAppearance,
  startAppearance,
  syncThemeColour,
} from '@/lib/appearance';

const GALLERY = { layout: 'gallery', scheme: 'dark', palette: 'forest' } as const;

function themeColours(): string[] {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
    (meta) => meta.content,
  );
}

afterEach(() => {
  document.head.innerHTML = '';
});

describe('applyAppearance', () => {
  it('writes the three choices onto the document', () => {
    applyAppearance(GALLERY);

    expect(document.documentElement.dataset).toMatchObject(GALLERY);
  });

  it('remembers the appearance for the next start', () => {
    applyAppearance(GALLERY);

    expect(rememberedAppearance()).toEqual(GALLERY);
  });

  it('still changes the document when the storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    applyAppearance(GALLERY);

    expect(document.documentElement.dataset.layout).toBe('gallery');
  });
});

describe('rememberedAppearance', () => {
  it('is the default in a browser that never showed anything else', () => {
    expect(rememberedAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it('reads a copy from an older or newer version as far as it understands it', () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ layout: 'holographic', palette: 'berry' }),
    );

    expect(rememberedAppearance()).toEqual({ ...DEFAULT_APPEARANCE, palette: 'berry' });
  });

  it('survives a copy that is not JSON', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, '{not json');

    expect(rememberedAppearance()).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('startAppearance', () => {
  it('brings back the look of the last visit before anything is rendered', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(GALLERY));

    startAppearance();

    expect(document.documentElement.dataset).toMatchObject(GALLERY);
  });
});

describe('syncThemeColour', () => {
  function addThemeColourTags(): void {
    document.head.innerHTML =
      '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">' +
      '<meta name="theme-color" content="#1c1e22" media="(prefers-color-scheme: dark)">';
  }

  it('gives both tags the colour the stylesheet names for the top of the screen', () => {
    addThemeColourTags();
    document.documentElement.style.setProperty('--color-chrome', ' #123456');

    syncThemeColour();

    expect(themeColours()).toEqual(['#123456', '#123456']);
    document.documentElement.style.removeProperty('--color-chrome');
  });

  it('leaves the tags alone while no stylesheet has said anything', () => {
    addThemeColourTags();

    syncThemeColour();

    expect(themeColours()).toEqual(['#ffffff', '#1c1e22']);
  });
});
