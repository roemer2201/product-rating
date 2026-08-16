import { buildApp } from '../app.js';
import { readSessionSecret } from '../config/index.js';
import { openDatabase, runMigrations } from '../db/index.js';
import { assertLoggingUsable, createLogger } from '../logging/index.js';
import { bootstrapAdmin } from '../services/bootstrap.js';
import { APP_VERSION } from '../version.js';
import { EXIT_OK, type CliCommand } from './command.js';
import { parseArguments } from './options.js';
import { loadRuntimeConfig } from './runtime.js';

const USAGE = `Usage: product-rating serve [OPTIONS]

Runs the API server, applies pending migrations beforehand and serves the web
client when server.static_dir points at a build. Runs in the foreground and
shuts down on SIGINT or SIGTERM, which is what the systemd unit and "docker
stop" send.

Options:
      --help          Show this help and exit.

Configuration options are accepted as well; "product-rating help" lists them.

Examples:
  product-rating serve
  product-rating serve --log-level debug --port 9090`;

export const serveCommand: CliCommand = {
  name: 'serve',
  summary: 'Run the API server and serve the web client',
  usage: USAGE,

  async run({ argv, io }) {
    const { options, configArgs } = parseArguments(argv, { help: 'boolean' });
    if (options.help === true) {
      io.out(USAGE);
      return EXIT_OK;
    }

    const { config, configFile } = loadRuntimeConfig(configArgs);
    assertLoggingUsable(config);
    const secret = readSessionSecret(config);

    const database = openDatabase({
      path: config.paths.database,
      logger: config.log.level === 'debug',
    });

    /**
     * Schema and bootstrap happen before the logger exists, because the schema
     * has to be current before the first query runs. The messages are
     * collected and written once there is something to write them with.
     */
    const startupMessages: { level: 'info' | 'warn'; message: string; details: object }[] = [];

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
      throw error;
    }

    const logging = createLogger(config);
    const app = await buildApp({
      config,
      db: database.db,
      secret,
      loggerInstance: logging.logger,
    });

    app.log.info(
      {
        version: APP_VERSION,
        configFile: configFile ?? '(defaults only)',
        database: config.paths.database,
      },
      'configuration loaded',
    );
    for (const entry of startupMessages) {
      app.log[entry.level](entry.details, entry.message);
    }

    // The promise is what keeps the command running; it is settled by the
    // shutdown below, so the process exits through the normal path with a
    // flushed log rather than being cut off mid line.
    return await new Promise<number>((resolve, reject) => {
      let stopping = false;

      const shutdown = (signal: NodeJS.Signals): void => {
        if (stopping) return;
        stopping = true;

        app.log.info({ signal }, 'shutting down');
        void app
          .close()
          .then(async () => {
            database.close();
            await logging.close();
            resolve(EXIT_OK);
          })
          .catch((error: unknown) => {
            database.close();
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      };

      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, shutdown);
      }

      app.listen({ host: config.server.host, port: config.server.port }).catch((error: unknown) => {
        app.log.error(error, 'failed to start server');
        database.close();
        void logging.close().then(() => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    });
  },
};
