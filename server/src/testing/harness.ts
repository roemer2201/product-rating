import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { parseConfig, type AppConfig } from '../config/index.js';
import { createTestDatabase, type TestDatabase } from '../db/testing.js';
import type { RawConfig } from '../config/index.js';

/**
 * Builds a complete application against a throwaway database.
 *
 * Tests drive the real stack — cookie signing, origin check, authentication
 * hook, routes — through `app.inject()`, so nothing is stubbed out that could
 * hide a wiring mistake.
 */

/** Origin the harness sends on writing requests, matching `base_url`. */
export const TEST_ORIGIN = 'http://127.0.0.1:8080';

/** Secret for cookie signing; the length rule lives in the config checks. */
const TEST_SECRET = 'test-secret-that-is-long-enough-0123456789';

export interface TestApp {
  app: FastifyInstance;
  database: TestDatabase;
  config: AppConfig;
  close(): Promise<void>;
}

export interface CreateTestAppOptions {
  /** Configuration overrides, merged into the defaults before validation. */
  config?: RawConfig;
}

/**
 * argon2id parameters for tests: the production defaults cost roughly a tenth
 * of a second per hash, which a test suite with dozens of logins feels.
 */
export const TEST_ARGON2 = { argon2_memory_mib: 8, argon2_time_cost: 1 };

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const database = createTestDatabase();
  const config = parseConfig({
    ...options.config,
    // Uploads and temporary files land next to the throwaway database, so
    // `close()` takes them along and no test writes into a real deployment.
    paths: {
      database: database.path,
      uploads: join(database.directory, 'uploads'),
      temp: join(database.directory, 'tmp'),
      ...(options.config?.paths ?? {}),
    },
    auth: { ...TEST_ARGON2, ...(options.config?.auth ?? {}) },
  });

  const app = await buildApp({
    config,
    db: database.db,
    secret: TEST_SECRET,
    // The periodic sweep would keep a timer around for every test app.
    sessionCleanup: false,
  });
  await app.ready();

  return {
    app,
    database,
    config,
    async close(): Promise<void> {
      await app.close();
      database.close();
    },
  };
}

/**
 * Headers a browser would send on a writing request. The content type is left
 * to `inject()`, which sets it when a payload is given — spelling it out here
 * would make bodyless DELETEs fail on an empty JSON body.
 */
export function writeHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = { origin: TEST_ORIGIN };
  if (cookie !== undefined) headers.cookie = cookie;
  return headers;
}

/** Extracts the session cookie from a response, ready to send back. */
export function sessionCookie(response: { cookies: unknown[] }): string {
  const cookies = response.cookies as { name: string; value: string }[];
  const session = cookies.find((entry) => entry.name === 'pr_session');
  if (session === undefined) throw new Error('response carries no session cookie');
  return `pr_session=${session.value}`;
}
