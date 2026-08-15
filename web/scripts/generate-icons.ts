/**
 * Rasterises the app mark into the PNG sizes the web app manifest and iOS ask
 * for.
 *
 * Purpose
 *   `public/icon.svg` and `public/icon-maskable.svg` are the only hand written
 *   icons in the repository. Everything else is derived from them here, so a
 *   change to the mark means editing one file and running this script again.
 *
 * Steps
 *   1. Read the two SVG sources next to the generated files.
 *   2. Render every entry of `TARGETS` with sharp at the requested edge length.
 *   3. Write the PNG, overwriting whatever was there before.
 *
 * Usage
 *   npm run icons --workspace @product-rating/web
 *
 * The generated files are checked in on purpose: a production build must not
 * depend on sharp, which is a native module and would otherwise have to be
 * installed wherever the frontend is built.
 *
 * This file is deliberately outside the workspace `tsconfig.json`. It runs on
 * Node, not in the browser, and pulling the Node type definitions into the
 * client program would blur that line. Node 22 executes TypeScript directly.
 */

import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

interface Target {
  /** Which of the two SVG sources to render. */
  source: 'icon.svg' | 'icon-maskable.svg';
  /** File name below `public/`. */
  output: string;
  /** Edge length in pixels; icons are square throughout. */
  size: number;
  /** What the file is for, printed while it is written. */
  purpose: string;
}

const TARGETS: readonly Target[] = [
  { source: 'icon.svg', output: 'icon-192.png', size: 192, purpose: 'manifest, purpose any' },
  { source: 'icon.svg', output: 'icon-512.png', size: 512, purpose: 'manifest, purpose any' },
  {
    source: 'icon-maskable.svg',
    output: 'icon-maskable-192.png',
    size: 192,
    purpose: 'manifest, purpose maskable',
  },
  {
    source: 'icon-maskable.svg',
    output: 'icon-maskable-512.png',
    size: 512,
    purpose: 'manifest, purpose maskable',
  },
  {
    source: 'icon-maskable.svg',
    output: 'apple-touch-icon.png',
    size: 180,
    // iOS rounds the corners itself, so it gets the square, full bleed variant.
    purpose: 'iOS home screen',
  },
];

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

for (const target of TARGETS) {
  const from = `${publicDir}${target.source}`;
  const to = `${publicDir}${target.output}`;

  await sharp(from, { density: 512 })
    .resize(target.size, target.size)
    .png({ compressionLevel: 9 })
    .toFile(to);

  console.warn(`wrote ${target.output} (${target.size}px, ${target.purpose})`);
}
