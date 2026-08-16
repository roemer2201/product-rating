import { countSnapshotFiles, inspectSnapshot, restoreBackup } from '../services/backup.js';
import { EXIT_OK, type CliCommand } from './command.js';
import { parseArguments, requiredOption } from './options.js';
import { loadRuntimeConfig } from './runtime.js';

const USAGE = `Usage: product-rating restore --from DIR [--yes]

Puts a snapshot back in place: the database first, then the photos. DIR is a
single snapshot directory - the one holding app.db - not the directory that
collects them.

Stop the service first. A running server holds the database open and would
keep writing into the file that is being replaced:

  systemctl stop product-rating      # or: docker compose stop

What is in place beforehand is not thrown away: the current database is copied
to pre-restore-<timestamp>.db next to it, so a restore from the wrong
directory can be undone. Photos the snapshot does not have are removed,
because nothing in the restored database refers to them any more.

Options:
      --from DIR      Snapshot directory to read. Required.
      --yes           Do not ask; for a scripted restore.
      --help          Show this help and exit.

Configuration options are accepted as well; "product-rating help" lists them.

Example:
  systemctl stop product-rating
  product-rating restore --from /var/backups/product-rating/2026-08-16_030000
  systemctl start product-rating`;

/** The word that has to be typed; "yes" is too easy to answer on reflex. */
const CONFIRMATION = 'restore';

export const restoreCommand: CliCommand = {
  name: 'restore',
  summary: 'Put a snapshot back in place',
  usage: USAGE,

  async run({ argv, io }) {
    const { options, configArgs } = parseArguments(argv, {
      help: 'boolean',
      from: 'string',
      yes: 'boolean',
    });

    if (options.help === true) {
      io.out(USAGE);
      return EXIT_OK;
    }

    const source = requiredOption(options, 'from');
    const { config } = loadRuntimeConfig(configArgs);

    // Checked before anything is asked: a damaged snapshot is a reason to stop
    // here, not after somebody has confirmed replacing their data with it.
    const problem = await inspectSnapshot(source);
    if (problem !== null) throw new Error(problem);

    if (options.yes !== true) {
      const photos = await countSnapshotFiles(source);
      io.err(`About to restore ${source}`);
      io.err(`  database -> ${config.paths.database}`);
      io.err(`  ${String(photos)} photo file(s) -> ${config.paths.uploads}`);
      io.err('The current state is replaced. Make sure the service is stopped.');

      const answer = await io.ask(`Type "${CONFIRMATION}" to continue: `);
      if (answer.trim() !== CONFIRMATION) {
        io.err('nothing was changed');
        return EXIT_OK;
      }
    }

    const result = await restoreBackup({
      config,
      source,
      onProgress: (message) => {
        io.err(message);
      },
    });

    io.out(
      `restored ${String(result.files)} photo file(s)` +
        (result.removedFiles === 0
          ? ''
          : `, removed ${String(result.removedFiles)} that the snapshot does not have`),
    );
    if (result.previousDatabase !== null) {
      io.err(`the database as it was is kept in ${result.previousDatabase}`);
    }

    return EXIT_OK;
  },
};
