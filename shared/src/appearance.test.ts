import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, resolveAppearance } from './appearance.js';
import { updateProfileSchema } from './schemas/auth.js';

describe('resolveAppearance', () => {
  it('keeps the choices this version knows', () => {
    expect(resolveAppearance({ layout: 'gallery', scheme: 'dark', palette: 'berry' })).toEqual({
      layout: 'gallery',
      scheme: 'dark',
      palette: 'berry',
    });
  });

  it('fills in the default for whatever was never chosen', () => {
    expect(resolveAppearance({ layout: 'compact', scheme: null })).toEqual({
      ...DEFAULT_APPEARANCE,
      layout: 'compact',
    });
  });

  it('reads a value it does not know as the default instead of failing', () => {
    // What a database written by a newer version looks like to an older one.
    expect(resolveAppearance({ layout: 'holographic', scheme: 7, palette: 'forest' })).toEqual({
      ...DEFAULT_APPEARANCE,
      palette: 'forest',
    });
  });

  it('survives input that is no object at all', () => {
    for (const stored of [null, undefined, 'gallery', 3, []]) {
      expect(resolveAppearance(stored)).toEqual(DEFAULT_APPEARANCE);
    }
  });
});

describe('updateProfileSchema', () => {
  it('takes the display name alone, as before appearances existed', () => {
    expect(updateProfileSchema.safeParse({ displayName: 'Anna' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ displayName: null }).success).toBe(true);
  });

  it('takes a single choice of the appearance', () => {
    const parsed = updateProfileSchema.safeParse({ appearance: { palette: 'graphite' } });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ appearance: { palette: 'graphite' } });
  });

  it('refuses a choice outside the lists', () => {
    expect(updateProfileSchema.safeParse({ appearance: { layout: 'holographic' } }).success).toBe(
      false,
    );
    expect(updateProfileSchema.safeParse({ appearance: { scheme: 'sepia' } }).success).toBe(false);
  });

  it('refuses a body that changes nothing', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });
});
