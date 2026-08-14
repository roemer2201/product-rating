import { buildApp } from './app.js';
import {
  ConfigError,
  ensureRuntimeDirectories,
  loadConfig,
  readSessionSecret,
  type LoadedConfig,
} from './config/index.js';
import { openDatabase, runMigrations } from './db/index.js';
import { bootstrapAdmin } from './services/bootstrap.js';

/** Prints a configuration problem in a readable way and stops the process. */
function abort(error: unknown): never {
  if (error instanceof ConfigError) {
    console.error(error.format());
  } else {
    console.error(error);
  }
  process.exit(1);
}

let loaded: LoadedConfig;
let secret: string;
try {
  loaded = loadConfig({ argv: process.argv.slice(2) });
  ensureRuntimeDirectories(loaded.config);
  secret = readSessionSecret(loaded.config);
} catch (error) {
  abort(error);
}

const { config, configFile } = loaded;

/**
 * Everything below happens before the Fastify logger exists, because the
 * schema has to be current before the first query runs. Messages are collected
 * and written once the logger is available.
 */
const startupMessages: { level: 'info' | 'warn'; message: string; details: object }[] = [];

const database = openDatabase({
  path: config.paths.database,
  logger: config.log.level === 'debug',
});

try {
  runMigrations({
    db: database.db,
    sqlite: database.sqlite,
    databasePath: config.paths.database,
    onInfo: (message, details) => {
      startupMessages.push({ level: 'info', message, details: details ?? {} });
    },
  });

  const bootstrap = await bootstrapAdmin(database.db, config);
  if (bootstrap.warning !== null) {
    startupMessages.push({ level: 'warn', message: bootstrap.warning, details: {} });
  }
  if (bootstrap.created) {
    startupMessages.push({
      level: 'info',
      message: 'bootstrap administrator created',
      details: { username: bootstrap.username },
    });
  }
} catch (error) {
  database.close();
  console.error('start-up failed:', error);
  process.exit(1);
}

const app = await buildApp({
  config,
  db: database.db,
  secret,
  // Format and destination from `[log]` are wired up with structured logging
  // in M13; until then everything goes to stdout at the configured level.
  logger: { level: config.log.level },
});

app.log.info(
  { configFile: configFile ?? '(defaults only)', database: config.paths.database },
  'configuration loaded',
);
for (const entry of startupMessages) {
  app.log[entry.level](entry.details, entry.message);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => {
      database.close();
      process.exit(0);
    });
  });
}

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error(error, 'failed to start server');
  process.exit(1);
}
