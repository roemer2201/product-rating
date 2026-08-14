import { buildApp } from './app.js';
import {
  ConfigError,
  ensureRuntimeDirectories,
  loadConfig,
  readSessionSecret,
  type LoadedConfig,
} from './config/index.js';

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
try {
  loaded = loadConfig({ argv: process.argv.slice(2) });
  ensureRuntimeDirectories(loaded.config);
  // The secret is only verified here; sessions start using it in M3.
  readSessionSecret(loaded.config);
} catch (error) {
  abort(error);
}

const { config, configFile } = loaded;

const app = buildApp({
  config,
  // Format and destination from `[log]` are wired up with structured logging
  // in M13; until then everything goes to stdout at the configured level.
  logger: { level: config.log.level },
});

app.log.info(
  { configFile: configFile ?? '(defaults only)', database: config.paths.database },
  'configuration loaded',
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error(error, 'failed to start server');
  process.exit(1);
}
