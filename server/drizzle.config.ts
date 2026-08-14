import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit only generates SQL here; migrations are applied by the server
 * (or `product-rating migrate`), never by `drizzle-kit push`. The URL is a
 * placeholder for that reason — the real path comes from `paths.database`.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: 'file:./.drizzle-generate.db',
  },
  strict: true,
  verbose: true,
});
