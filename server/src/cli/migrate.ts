import { runMigrations } from '../db/index.js';
import { EXIT_OK, type CliCommand } from './command.js';
import { parseArguments } from './options.js';
import { loadRuntimeConfig, withDatabase } from './runtime.js';

const USAGE = `Usage: product-rating migrate [OPTIONS]

Applies every migration the database is missing and exits. Running it against
an up-to-date database does nothing, so it is safe to call on every start-up -
which is what the package installation and the container entrypoint do.

A snapshot of the database is written before the first change, next to the
database file, so an interrupted upgrade has a way back.

Options:
      --help          Show this help and exit.

Configuration options are accepted as well; "product-rating help" lists them.`;

export const migrateCommand: CliCommand = {
  name: 'migrate',
  summary: 'Apply pending database migrations and exit',
  usage: USAGE,

  async run({ argv, io }) {
    const { options, configArgs } = parseArguments(argv, { help: 'boolean' });
    if (options.help === true) {
      io.out(USAGE);
      return EXIT_OK;
    }

    const { config } = loadRuntimeConfig(configArgs);

    return withDatabase(
      config,
      ({ db, sqlite }) => {
        const result = runMigrations({
          db,
          sqlite,
          databasePath: config.paths.database,
          onInfo: (message, details) => {
            io.err(details === undefined ? message : `${message} ${JSON.stringify(details)}`);
          },
        });

        io.out(
          result.applied === 0
            ? 'nothing to do'
            : `applied ${String(result.applied)} migration(s)` +
                (result.snapshot === null ? '' : `, snapshot: ${result.snapshot}`),
        );

        return EXIT_OK;
      },
      // The whole point of this command is a schema that is behind.
      { requireSchema: false },
    );
  },
};
