import { checkUploads } from '../services/photos.js';
import { EXIT_FAILURE, EXIT_OK, type CliCommand } from './command.js';
import { parseArguments, UsageError } from './options.js';
import { loadRuntimeConfig, withDatabase } from './runtime.js';

const USAGE = `Usage: product-rating fsck --uploads [--repair]

Compares the upload directory with the photo table in both directions: files
that no row claims any more, and rows whose file is missing. Reporting is
always done, deleting only with --repair - an orphaned file costs space, a
wrongly deleted one costs a photo.

Options:
      --uploads       Check the upload directory against the photo table.
      --repair        Delete the files no photo row claims. Rows whose file is
                      missing are never touched; those need a backup.
      --help          Show this help and exit.

Note: --uploads means the check here, not the configuration key of the same
name. Point this command at another instance with --config or
--set paths.uploads=DIR.

Exit codes: 0 nothing to report, 1 something was found or the check failed.`;

export const fsckCommand: CliCommand = {
  name: 'fsck',
  summary: 'Find orphaned files and photo rows without a file',
  usage: USAGE,

  async run({ argv, io }) {
    const { options, configArgs } = parseArguments(argv, {
      help: 'boolean',
      uploads: 'boolean',
      repair: 'boolean',
    });

    if (options.help === true) {
      io.out(USAGE);
      return EXIT_OK;
    }

    // The only check that exists so far; asking for it explicitly keeps the
    // meaning of the command stable once others are added.
    if (options.uploads !== true) throw new UsageError('nothing to check; pass --uploads');

    const repair = options.repair === true;
    const { config } = loadRuntimeConfig(configArgs);

    return withDatabase(config, async ({ db }) => {
      const report = await checkUploads(db, config, { repair });

      io.out(`checked ${String(report.photos)} photo(s) against ${config.paths.uploads}`);

      for (const entry of report.missingFiles) {
        io.out(`missing file: ${entry.path} (photo ${entry.photoId}, product ${entry.productId})`);
      }
      for (const path of report.orphanFiles) {
        io.out(`orphan file:  ${path}${repair ? ' (removed)' : ''}`);
      }

      const problems = report.missingFiles.length + report.orphanFiles.length;
      io.out(
        problems === 0
          ? 'no problems found'
          : `${String(report.missingFiles.length)} missing file(s), ` +
              `${String(report.orphanFiles.length)} orphan file(s)` +
              (repair
                ? `, ${String(report.removed)} removed`
                : ', run again with --repair to remove them'),
      );

      // Missing files stay a problem even after a repair run: only a backup
      // brings those back.
      return report.missingFiles.length > 0 || (problems > 0 && !repair) ? EXIT_FAILURE : EXIT_OK;
    });
  },
};
