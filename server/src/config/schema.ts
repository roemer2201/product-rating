import { z } from 'zod';

/**
 * The complete configuration schema including every default value.
 *
 * The schema is the single source of truth: `config/config.example.toml`, the
 * table in `README.md` and the environment variable overrides all follow it.
 * Sections are `strictObject`s so a typo in the TOML file aborts the start-up
 * instead of silently falling back to a default.
 */

/**
 * Document of the single page application. `server.static_dir` has to contain
 * it; it is also the fallback for every address of the client.
 */
export const APP_SHELL = 'index.html';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export const LOG_FORMATS = ['json', 'pretty'] as const;
export const LOG_DESTINATIONS = ['stdout', 'file', 'syslog'] as const;

const serverSection = z.strictObject({
  /** Interface the HTTP server binds to. Stays on loopback behind a proxy. */
  host: z.string().min(1).default('127.0.0.1'),
  port: z.int().min(1).max(65535).default(8080),
  /** Public origin, used for absolute links and cookie settings. */
  base_url: z.url().default('http://127.0.0.1:8080'),
  /** Evaluate `X-Forwarded-*`; only enable behind a trusted reverse proxy. */
  trust_proxy: z.boolean().default(false),
  /**
   * Extra origins accepted by the CSRF check besides `base_url`. Needed for
   * the Vite dev server, otherwise it stays empty.
   */
  trusted_origins: z.array(z.url()).default([]),
  /**
   * Directory holding the built web client. Empty means API only, which is
   * what development wants: there the Vite dev server delivers the interface.
   * A deployment points it at the bundle (container, Debian package).
   */
  static_dir: z.string().default(''),
});

const pathsSection = z.strictObject({
  database: z.string().min(1).default('/var/lib/product-rating/db/app.db'),
  uploads: z.string().min(1).default('/var/lib/product-rating/uploads'),
  temp: z.string().min(1).default('/var/lib/product-rating/tmp'),
});

const uploadsSection = z
  .strictObject({
    max_file_size_mb: z.int().min(1).max(512).default(15),
    allowed_mime: z
      .array(z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/, 'must be a MIME type such as image/jpeg'))
      .min(1)
      .default(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
    thumbnail_px: z.int().min(64).max(2048).default(400),
    detail_px: z.int().min(256).max(8192).default(1600),
    strip_exif: z.boolean().default(true),
  })
  .refine((value) => value.thumbnail_px < value.detail_px, {
    message: 'thumbnail_px must be smaller than detail_px',
    path: ['thumbnail_px'],
  });

const authSection = z
  .strictObject({
    /** File holding the session secret, mode 0600, never the config file. */
    secret_file: z.string().min(1).default('/etc/product-rating/secret.env'),
    session_ttl_days: z.int().min(1).max(3650).default(90),
    /** Rolling renewal kicks in once less than this many days are left. */
    session_renew_threshold_days: z.int().min(0).max(3650).default(7),
    invite_ttl_days: z.int().min(1).max(365).default(14),
    login_rate_limit_per_minute: z.int().min(1).max(1000).default(5),
    argon2_memory_mib: z.int().min(8).max(4096).default(64),
    /** Number of argon2id passes; higher costs more time per login. */
    argon2_time_cost: z.int().min(1).max(20).default(3),
    /** Lanes used by argon2id; one is plenty for a household sized instance. */
    argon2_parallelism: z.int().min(1).max(16).default(1),
    /** Shortest accepted password, checked on every password change. */
    min_password_length: z.int().min(8).max(256).default(10),
  })
  .refine((value) => value.session_renew_threshold_days < value.session_ttl_days, {
    message: 'session_renew_threshold_days must be smaller than session_ttl_days',
    path: ['session_renew_threshold_days'],
  });

const logSection = z
  .strictObject({
    level: z.enum(LOG_LEVELS).default('info'),
    format: z.enum(LOG_FORMATS).default('json'),
    destination: z.enum(LOG_DESTINATIONS).default('stdout'),
    /** Only used when `destination = "file"`. */
    file: z.string().min(1).default('/var/log/product-rating/app.log'),
  })
  .refine((value) => value.destination !== 'file' || value.file.trim().length > 0, {
    message: 'log.file is required when destination is "file"',
    path: ['file'],
  });

const appSection = z
  .strictObject({
    title: z.string().min(1).max(100).default('product-rating'),
    /**
     * Reserved switch for looking products up in an external database. The
     * application deliberately makes no outbound requests, so enabling it is
     * rejected until an implementation exists.
     */
    external_lookup: z.boolean().default(false),
  })
  .refine((value) => value.external_lookup === false, {
    message: 'external_lookup is not implemented; this application makes no outbound requests',
    path: ['external_lookup'],
  });

/**
 * The section schemas without their `prefault` wrapper. Used to look up the
 * schema of a single key when coercing environment variables and CLI values.
 */
export const sectionSchemas = {
  server: serverSection,
  paths: pathsSection,
  uploads: uploadsSection,
  auth: authSection,
  log: logSection,
  app: appSection,
} as const;

export const configSchema = z.strictObject({
  server: serverSection.prefault({}),
  paths: pathsSection.prefault({}),
  uploads: uploadsSection.prefault({}),
  auth: authSection.prefault({}),
  log: logSection.prefault({}),
  app: appSection.prefault({}),
});

export type AppConfig = z.infer<typeof configSchema>;
export type ConfigSection = keyof typeof sectionSchemas;

/** Every configuration section in the order used by the example file. */
export const CONFIG_SECTIONS = Object.keys(sectionSchemas) as ConfigSection[];

/** Type guard for section names, used while parsing overrides. */
export function isConfigSection(name: string): name is ConfigSection {
  return Object.hasOwn(sectionSchemas, name);
}

/** Returns the schema of a single key, or `undefined` if it does not exist. */
export function getKeySchema(section: ConfigSection, key: string): z.ZodType | undefined {
  const shape: Record<string, z.ZodType> = sectionSchemas[section].shape;
  return Object.hasOwn(shape, key) ? shape[key] : undefined;
}

/** All key names of a section, used for error messages and the CLI. */
export function keysOfSection(section: ConfigSection): string[] {
  return Object.keys(sectionSchemas[section].shape);
}
