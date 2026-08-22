import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { createUser } from '../services/users.js';
import { createSession } from '../services/sessions.js';
import { SESSION_COOKIE } from '../services/sessions.js';
import { createTestApp, sessionCookie, writeHeaders, type TestApp } from '../testing/harness.js';

/**
 * Who may reach which route — as a complete table rather than route by route.
 *
 * The tests next to this file check what a route does; this one checks the lock
 * in front of it, for every route the instance has. The list of routes is not
 * written down twice: it is read back out of the router and compared with the
 * table below, so a new route without an entry fails here instead of quietly
 * shipping without a guard.
 *
 * What is deliberately not here is ownership — that a photo belongs to the
 * account that uploaded it, that a rating belongs to whoever gave it. Those
 * need real objects and are tested in `photos.test.ts` and `ratings.test.ts`.
 * This table only knows three answers: no session needed, any session, an
 * administrator.
 */

type Access = 'public' | 'user' | 'admin';

interface RouteRule {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path with the parameters filled in, ready to be injected. */
  url: string;
  /** Route as the router knows it, with `:parameters`. */
  pattern: string;
  access: Access;
  /** Body for a writing request; an empty one usually ends in a 400. */
  payload?: Record<string, unknown>;
  /**
   * The route ends the session it is called with, so it gets a throwaway one —
   * otherwise it would log the table out halfway through its own run.
   */
  endsSession?: true;
  /**
   * A 403 from this route can also come from the ownership check behind the
   * guard, because the placeholder identifier belongs to nobody. Only the
   * absence of a 401 is asserted for these; ownership itself is tested where
   * there are real objects to own.
   */
  ownership?: true;
}

/** Placeholders: no route may get as far as looking at them. */
const UNKNOWN_ID = '01960000-0000-7000-8000-000000000000';
const SOME_EAN = '4260000000011';

const ROUTES: RouteRule[] = [
  { method: 'GET', url: '/healthz', pattern: '/healthz', access: 'public' },

  {
    method: 'POST',
    url: '/api/v1/auth/login',
    pattern: '/api/v1/auth/login',
    access: 'public',
    payload: {},
  },
  {
    method: 'POST',
    url: '/api/v1/auth/register',
    pattern: '/api/v1/auth/register',
    access: 'public',
    payload: {},
  },
  // Logging out is deliberately unguarded: without a session there is nothing
  // to end, and answering that with 401 would only be noise.
  {
    method: 'POST',
    url: '/api/v1/auth/logout',
    pattern: '/api/v1/auth/logout',
    access: 'public',
    payload: {},
    endsSession: true,
  },
  // Both halves of the reset flow are open: whoever needs them cannot log in
  // by definition. What guards them is the token in the link, and the rate
  // limit in front of it.
  {
    method: 'GET',
    url: `/api/v1/auth/reset/${'x'.repeat(43)}`,
    pattern: '/api/v1/auth/reset/:token',
    access: 'public',
  },
  {
    method: 'POST',
    url: '/api/v1/auth/reset',
    pattern: '/api/v1/auth/reset',
    access: 'public',
    payload: {},
  },
  { method: 'GET', url: '/api/v1/auth/me', pattern: '/api/v1/auth/me', access: 'user' },
  { method: 'GET', url: '/api/v1/auth/sessions', pattern: '/api/v1/auth/sessions', access: 'user' },
  {
    method: 'DELETE',
    url: '/api/v1/auth/sessions',
    pattern: '/api/v1/auth/sessions',
    access: 'user',
  },
  {
    method: 'DELETE',
    url: `/api/v1/auth/sessions/${UNKNOWN_ID}`,
    pattern: '/api/v1/auth/sessions/:id',
    access: 'user',
    ownership: true,
  },
  {
    method: 'POST',
    url: '/api/v1/auth/password',
    pattern: '/api/v1/auth/password',
    access: 'user',
    payload: {},
  },

  { method: 'POST', url: '/api/v1/invites', pattern: '/api/v1/invites', access: 'admin' },
  { method: 'GET', url: '/api/v1/invites', pattern: '/api/v1/invites', access: 'admin' },
  {
    method: 'DELETE',
    url: '/api/v1/invites/AAAA-BBBB-CCCC',
    pattern: '/api/v1/invites/:code',
    access: 'admin',
  },

  { method: 'GET', url: '/api/v1/users', pattern: '/api/v1/users', access: 'admin' },
  { method: 'POST', url: '/api/v1/users', pattern: '/api/v1/users', access: 'admin', payload: {} },
  {
    method: 'PATCH',
    url: `/api/v1/users/${UNKNOWN_ID}`,
    pattern: '/api/v1/users/:id',
    access: 'admin',
    payload: {},
  },
  {
    method: 'POST',
    url: `/api/v1/users/${UNKNOWN_ID}/password`,
    pattern: '/api/v1/users/:id/password',
    access: 'admin',
    payload: {},
  },
  {
    method: 'POST',
    url: `/api/v1/users/${UNKNOWN_ID}/reset-link`,
    pattern: '/api/v1/users/:id/reset-link',
    access: 'admin',
    payload: {},
  },
  {
    method: 'POST',
    url: `/api/v1/users/${UNKNOWN_ID}/lock`,
    pattern: '/api/v1/users/:id/lock',
    access: 'admin',
    payload: {},
  },

  {
    method: 'POST',
    url: '/api/v1/products',
    pattern: '/api/v1/products',
    access: 'user',
    payload: {},
  },
  { method: 'GET', url: '/api/v1/products', pattern: '/api/v1/products', access: 'user' },
  {
    method: 'GET',
    url: '/api/v1/products/categories',
    pattern: '/api/v1/products/categories',
    access: 'user',
  },
  {
    method: 'GET',
    url: `/api/v1/products/by-ean/${SOME_EAN}`,
    pattern: '/api/v1/products/by-ean/:ean',
    access: 'user',
  },
  {
    method: 'GET',
    url: `/api/v1/products/${UNKNOWN_ID}`,
    pattern: '/api/v1/products/:id',
    access: 'user',
  },
  {
    method: 'PATCH',
    url: `/api/v1/products/${UNKNOWN_ID}`,
    pattern: '/api/v1/products/:id',
    access: 'user',
    payload: { name: 'Neuer Name' },
  },
  // The one route of the catalogue that is not for everybody: the catalogue is
  // shared, so a deletion takes other accounts' ratings and photos with it.
  {
    method: 'DELETE',
    url: `/api/v1/products/${UNKNOWN_ID}`,
    pattern: '/api/v1/products/:id',
    access: 'admin',
  },
  {
    method: 'PUT',
    url: `/api/v1/products/${UNKNOWN_ID}/rating`,
    pattern: '/api/v1/products/:id/rating',
    access: 'user',
    payload: { stars: 3 },
  },
  {
    method: 'DELETE',
    url: `/api/v1/products/${UNKNOWN_ID}/rating`,
    pattern: '/api/v1/products/:id/rating',
    access: 'user',
  },
  {
    method: 'POST',
    url: `/api/v1/products/${UNKNOWN_ID}/photos`,
    pattern: '/api/v1/products/:id/photos',
    access: 'user',
  },

  {
    method: 'POST',
    url: `/api/v1/products/${UNKNOWN_ID}/prices`,
    pattern: '/api/v1/products/:id/prices',
    access: 'user',
    payload: { cents: 199 },
  },
  { method: 'GET', url: '/api/v1/prices/shops', pattern: '/api/v1/prices/shops', access: 'user' },
  {
    method: 'DELETE',
    url: `/api/v1/prices/${UNKNOWN_ID}`,
    pattern: '/api/v1/prices/:id',
    access: 'user',
    ownership: true,
  },

  {
    method: 'DELETE',
    url: `/api/v1/photos/${UNKNOWN_ID}`,
    pattern: '/api/v1/photos/:id',
    access: 'user',
  },
  {
    method: 'PUT',
    url: `/api/v1/photos/${UNKNOWN_ID}/primary`,
    pattern: '/api/v1/photos/:id/primary',
    access: 'user',
  },
  {
    method: 'PUT',
    url: `/api/v1/photos/${UNKNOWN_ID}/position`,
    pattern: '/api/v1/photos/:id/position',
    access: 'user',
    payload: { position: 0 },
  },

  { method: 'GET', url: '/api/v1/trash', pattern: '/api/v1/trash', access: 'admin' },
  {
    method: 'POST',
    url: `/api/v1/trash/${UNKNOWN_ID}/restore`,
    pattern: '/api/v1/trash/:id/restore',
    access: 'admin',
    payload: {},
  },
  {
    method: 'DELETE',
    url: `/api/v1/trash/${UNKNOWN_ID}`,
    pattern: '/api/v1/trash/:id',
    access: 'admin',
  },

  { method: 'GET', url: '/api/v1/ratings/mine', pattern: '/api/v1/ratings/mine', access: 'user' },
  {
    method: 'GET',
    url: `/api/v1/media/${UNKNOWN_ID}`,
    pattern: '/api/v1/media/:id',
    access: 'user',
  },
];

/**
 * The routes the instance really has, read back out of the router.
 *
 * `printRoutes()` draws a tree, so the path of a line is its own segment
 * appended to the segments of its parents. `HEAD` is left out: Fastify adds it
 * for every `GET` on its own, and it is guarded by the same hooks.
 */
function registeredRoutes(tree: string): Set<string> {
  const routes = new Set<string>();
  const segments: string[] = [];

  for (const line of tree.split('\n')) {
    const match = /^(.*?)(?:├──|└──) (\S*)(?: \(([^)]*)\))?\s*$/.exec(line);
    if (match === null) continue;

    const [, indent = '', segment = '', methods] = match;
    // Every level of the tree is drawn four characters wide.
    const depth = indent.length / 4;
    segments[depth] = segment;
    const path = segments.slice(0, depth + 1).join('');

    for (const method of (methods ?? '').split(',')) {
      const name = method.trim();
      if (name !== '' && name !== 'HEAD') routes.add(`${name} ${path}`);
    }
  }

  return routes;
}

const PASSWORD = 'a-long-enough-password';

let harness: TestApp;
let userCookie: string;
let adminCookie: string;
let disabledCookie: string;

/** The account behind each of the cookies, so a throwaway session can be issued. */
const accountIds = new Map<string, string>();

/**
 * A request without a session, with an ordinary one or with an administrator.
 * A route that logs its caller out gets a session of its own for the attempt.
 */
function request(rule: RouteRule, cookie?: string) {
  let sessionCookieValue = cookie;

  if (rule.endsSession === true && cookie !== undefined) {
    const userId = accountIds.get(cookie) as string;
    const { token } = createSession(harness.app.db, harness.config, userId, null);
    sessionCookieValue = `${SESSION_COOKIE}=${harness.app.signCookie(token)}`;
  }

  const options: InjectOptions = {
    method: rule.method,
    url: rule.url,
    headers: writeHeaders(sessionCookieValue),
  };
  if (rule.payload !== undefined) options.payload = rule.payload;
  return harness.app.inject(options);
}

beforeAll(async () => {
  harness = await createTestApp();

  for (const [username, role] of [
    ['anna', 'user'],
    ['ilse', 'admin'],
  ] as const) {
    const account = await createUser(harness.app.db, harness.config, {
      username,
      password: PASSWORD,
      role,
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: writeHeaders(),
      payload: { username, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);

    const cookie = sessionCookie(response);
    accountIds.set(cookie, account.id);
    if (role === 'admin') adminCookie = cookie;
    else userCookie = cookie;
  }

  // An account that was disabled after it signed in. Its session is still in
  // the database, which is exactly the case the authentication hook has to
  // notice - a login would no longer be possible.
  const blocked = await createUser(harness.app.db, harness.config, {
    username: 'bert',
    password: PASSWORD,
    role: 'user',
  });
  const { token } = createSession(harness.app.db, harness.config, blocked.id, null);
  disabledCookie = `${SESSION_COOKIE}=${harness.app.signCookie(token)}`;

  // The cookie works before the account is switched off, so the refusals below
  // really come from the disabled account and not from a cookie the instance
  // never accepted in the first place.
  const working = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { cookie: disabledCookie },
  });
  expect(working.statusCode).toBe(200);

  const disabled = await harness.app.inject({
    method: 'PATCH',
    url: `/api/v1/users/${blocked.id}`,
    headers: writeHeaders(adminCookie),
    payload: { disabled: true },
  });
  expect(disabled.statusCode).toBe(200);
});

afterAll(async () => {
  await harness.close();
});

describe('the table covers the router', () => {
  it('lists every route the instance registers, and no other', () => {
    const registered = registeredRoutes(harness.app.printRoutes({ commonPrefix: false }));
    const listed = new Set(ROUTES.map((rule) => `${rule.method} ${rule.pattern}`));

    expect([...registered].sort()).toEqual([...listed].sort());
  });

  it('addresses each of them with a URL the router really matches', () => {
    for (const rule of ROUTES) {
      expect(
        harness.app.hasRoute({ method: rule.method, url: rule.pattern }),
        `${rule.method} ${rule.pattern}`,
      ).toBe(true);
    }
  });
});

describe('without a session', () => {
  it('answers every guarded route with 401', async () => {
    for (const rule of ROUTES.filter((entry) => entry.access !== 'public')) {
      const response = await request(rule);
      expect(response.statusCode, `${rule.method} ${rule.url}`).toBe(401);
    }
  });

  it('lets the unguarded ones through', async () => {
    for (const rule of ROUTES.filter((entry) => entry.access === 'public')) {
      const response = await request(rule);
      expect([401, 403], `${rule.method} ${rule.url}`).not.toContain(response.statusCode);
    }
  });
});

describe('with an ordinary account', () => {
  it('is refused by every administration route, and by no other', async () => {
    for (const rule of ROUTES) {
      const response = await request(rule, userCookie);
      expect(response.statusCode, `${rule.method} ${rule.url}`).not.toBe(401);

      if (rule.ownership === true) continue;
      const refused = response.statusCode === 403;
      expect(refused, `${rule.method} ${rule.url}`).toBe(rule.access === 'admin');
    }
  });
});

describe('with an administrator', () => {
  it('gets past the guard everywhere', async () => {
    for (const rule of ROUTES) {
      const response = await request(rule, adminCookie);
      expect(response.statusCode, `${rule.method} ${rule.url}`).not.toBe(401);
      if (rule.ownership !== true) {
        expect(response.statusCode, `${rule.method} ${rule.url}`).not.toBe(403);
      }
    }
  });
});

describe('with the session of a disabled account', () => {
  it('is answered like an anonymous request everywhere', async () => {
    for (const rule of ROUTES.filter((entry) => entry.access !== 'public')) {
      const response = await request(rule, disabledCookie);
      expect(response.statusCode, `${rule.method} ${rule.url}`).toBe(401);
    }
  });

  it('has its stale cookie cleared on the way', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: disabledCookie },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toContain(`${SESSION_COOKIE}=;`);
  });
});
