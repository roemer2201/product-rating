import { createBackup } from '../services/backup.js';
import { EXIT_OK, formatBytes, type CliCommand } from './command.js';
import { numberOption, parseArguments, requiredOption } from './options.js';
import { loadRuntimeConfig } from './runtime.js';

const USAGE = `Usage: product-rating backup --to DIR [--keep-days DAYS]

Writes a snapshot of the database and the photos into a directory named after
the moment it was taken:

  DIR/<YYYY-MM-DD_HHMMSS>/app.db
  DIR/<YYYY-MM-DD_HHMMSS>/uploads/...
  DIR/latest -> <YYYY-MM-DD_HHMMSS>

The service does not have to be stopped: the database is copied with SQLite's
own VACUUM INTO, which is consistent while writes keep happening, and the copy
is read back afterwards. Copying app.db by hand is not safe - in WAL mode the
newest writes sit in a separate file.

Photos that have not changed since the previous snapshot are hard linked
against it, so every snapshot looks complete while only the changes cost
space. Deleting an old snapshot never damages a newer one.

Options:
      --to DIR        Directory the snapshots are written into. Required.
      --keep-days DAYS
                      Delete snapshots older than DAYS days once the new one
                      is complete. 0 (the default) keeps every snapshot.
      --help          Show this help and exit.

Configuration options are accepted as well; "product-rating help" lists them.
The layout matches packaging/examples/backup/product-rating-backup, so
snapshots of either can be restored with "product-rating restore".

Examples:
  product-rating backup --to /var/backups/product-rating
  product-rating backup --to /srv/backups --keep-days 30`;

export const backupCommand: CliCommand = {
  name: 'backup',
  summary: 'Write a snapshot of the database and the photos',
  usage: USAGE,

  async run({ argv, io }) {
    const { options, configArgs } = parseArguments(argv, {
      help: 'boolean',
      to: 'string',
      'keep-days': 'string',
    });

    if (options.help === true) {
      io.out(USAGE);
      return EXIT_OK;
    }

    const target = requiredOption(options, 'to');
    const keepDays = numberOption(options, 'keep-days', 0);
    const { config } = loadRuntimeConfig(configArgs);

    const result = await createBackup({
      config,
      target,
      keepDays,
      onProgress: (message) => {
        io.err(message);
      },
    });

    io.out(result.directory);
    io.err(
      `database ${formatBytes(result.databaseBytes)}, ` +
        `${String(result.files)} photo file(s) (${formatBytes(result.bytes)}, ` +
        `${String(result.linked)} hard linked)` +
        (result.removed.length === 0
          ? ''
          : `, ${String(result.removed.length)} old snapshot(s) removed`),
    );

    return EXIT_OK;
  },
};
