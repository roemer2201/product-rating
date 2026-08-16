import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The path the instance is reached under, with a slash at both ends.
 *
 * Everything the browser asks for is derived from this: the bundle in
 * `index.html`, `start_url` and `scope` of the manifest, the scope of the
 * service worker and — through `import.meta.env.BASE_URL` — the API address in
 * `lib/api.ts`. It has to be decided at build time, because those files are
 * written by this build.
 *
 *   PRODUCT_RATING_BASE_PATH=/produkte npm run build
 *
 * The reverse proxy strips the prefix again before it forwards, so the server
 * keeps answering on `/` and `/api/v1` and needs no setting of its own. See
 * `packaging/examples/nginx/product-rating-subpath.conf`.
 */
function basePath(): string {
  const raw = (process.env.PRODUCT_RATING_BASE_PATH ?? '').trim();
  const trimmed = raw.replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : `/${trimmed}/`;
}

const base = basePath();

/** Escapes the path so it can stand at the front of a regular expression. */
const baseAsPattern = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      /*
       * `prompt` rather than `autoUpdate`: an update that swaps the bundle
       * underneath a running app can lose a half filled form, and on an iOS
       * home screen app the old bundle otherwise survives for days because the
       * app is never really closed. So a new version waits and the interface
       * asks (see `UpdatePrompt`).
       */
      registerType: 'prompt',
      // The icons are files in `public/` and are already covered by the glob
      // patterns below; without this they would end up in the precache list a
      // second time.
      includeManifestIcons: false,
      // The registration happens in `UpdatePrompt`, which needs the handle to
      // the waiting worker anyway. A second, injected registration would race
      // with it.
      injectRegister: false,

      manifest: {
        name: 'product-rating',
        short_name: 'Produkte',
        description: 'Produkte scannen, fotografieren und bewerten',
        lang: 'de',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'portrait',
        // `start_url` and `scope` are left to the plugin, which derives both
        // from Vite's `base`. A deployment under a sub-path only has to set
        // that one option.
        background_color: '#f4f4f6',
        // The colour of the header, so the iOS status bar continues it instead
        // of drawing a seam across the top of the screen.
        theme_color: '#ffffff',
        categories: ['food', 'shopping', 'utilities'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          // Scales to any size the launcher asks for; ignored where SVG icons
          // are not understood, which is why the PNGs above stay.
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },

      workbox: {
        /*
         * The app shell, and nothing else.
         *
         * No `runtimeCaching` on purpose: `/api/v1/…` must never be answered
         * from a cache. A stale catalogue would be a nuisance, a stale
         * `GET /auth/me` would show the wrong account, and photos come through
         * an authenticated route whose responses are `Cache-Control: private`.
         * TanStack Query already holds the answers for as long as they are
         * useful.
         */
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The barcode decoder is over a megabyte of WebAssembly, is only
        // touched when the camera starts, and is useless offline anyway
        // because the EAN still has to be looked up on the server. It stays out
        // of the install and is fetched when it is first needed.
        globIgnores: ['**/*.wasm'],
        // Every address of the app is served by the same document, so a
        // navigation offline lands in the app instead of the browser's error
        // page. The API is excluded: a request that has to reach the server
        // must fail as a request, not be answered with HTML.
        navigateFallback: 'index.html',
        // Under a sub-path the API sits below it as well, so the pattern has
        // to carry the prefix - otherwise it matches nothing and a navigation
        // to an API address would be answered from the cache.
        navigateFallbackDenylist: [new RegExp(`^${baseAsPattern}api/`)],
        cleanupOutdatedCaches: true,
        // Take over the page that installed the worker instead of waiting for
        // the next start, so the app survives a lost connection from the first
        // visit on. This only concerns the very first worker: a later one still
        // has to wait for the prompt, because `skipWaiting` stays off.
        clientsClaim: true,
      },

      // The service worker is not wanted in `npm run dev`: it would cache the
      // very files Vite replaces on every change.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Talk to the API server during development so the browser sees a single
    // origin and cookies behave like they do in production behind the proxy.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  // The service worker only exists in a build, so `vite preview` is the only
  // way to try it before deploying. It needs the same proxy as the dev server.
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
