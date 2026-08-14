import type { DbHandle } from '../db/index.js';
import type { AppConfig } from '../config/index.js';
import { usernameSchema } from '@product-rating/shared';
import { countUsers, createUser } from './users.js';

/**
 * First administrator on an empty instance.
 *
 * There is no open registration, so a brand new installation needs one account
 * to start from. It comes from `BOOTSTRAP_ADMIN_USER` and
 * `BOOTSTRAP_ADMIN_PASSWORD` — deliberately environment variables and not
 * configuration keys, because a password has no business in a file that ends
 * up in `/etc` as a `conffile`. `product-rating user add --admin` (M13) is the
 * alternative for people who prefer not to put a password into the environment
 * at all.
 *
 * Bootstrapping only happens while the instance has no accounts. Once someone
 * exists, the variables are ignored, so a forgotten entry in a unit file or a
 * compose file cannot silently create an administrator later on.
 */

export const BOOTSTRAP_USER_ENV = 'BOOTSTRAP_ADMIN_USER';
export const BOOTSTRAP_PASSWORD_ENV = 'BOOTSTRAP_ADMIN_PASSWORD';
export const BOOTSTRAP_EMAIL_ENV = 'BOOTSTRAP_ADMIN_EMAIL';

export interface BootstrapResult {
  created: boolean;
  username: string | null;
  /** Set when the variables were present but unusable. */
  warning: string | null;
}

export interface BootstrapOptions {
  env?: NodeJS.ProcessEnv;
}

export async function bootstrapAdmin(
  db: DbHandle,
  config: AppConfig,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const env = options.env ?? process.env;
  const rawUsername = env[BOOTSTRAP_USER_ENV]?.trim() ?? '';
  const password = env[BOOTSTRAP_PASSWORD_ENV] ?? '';

  const nothing: BootstrapResult = { created: false, username: null, warning: null };

  if (rawUsername === '' && password === '') return nothing;

  if (countUsers(db) > 0) {
    return {
      ...nothing,
      warning: `${BOOTSTRAP_USER_ENV} is set but the instance already has accounts; ignoring it`,
    };
  }

  if (rawUsername === '' || password === '') {
    return {
      ...nothing,
      warning: `${BOOTSTRAP_USER_ENV} and ${BOOTSTRAP_PASSWORD_ENV} have to be set together`,
    };
  }

  const parsed = usernameSchema.safeParse(rawUsername);
  if (!parsed.success) {
    return { ...nothing, warning: `${BOOTSTRAP_USER_ENV} is not a valid username` };
  }

  if (password.length < config.auth.min_password_length) {
    return {
      ...nothing,
      warning: `${BOOTSTRAP_PASSWORD_ENV} is shorter than auth.min_password_length; no account was created`,
    };
  }

  const email = env[BOOTSTRAP_EMAIL_ENV]?.trim();
  const user = await createUser(db, config, {
    username: parsed.data,
    password,
    email: email === undefined || email === '' ? null : email,
    role: 'admin',
  });

  return { created: true, username: user.username, warning: null };
}
