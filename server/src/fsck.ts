/**
 * Standalone consistency check: `npm run fsck -- --uploads [--repair]`.
 *
 * Compares the upload directory against the photo table in both directions and
 * reports what does not add up. Nothing is deleted unless `--repair` is given —
 * an orphaned file costs space, a wrongly deleted one costs a photo. The proper
 * `product-rating fsck` subcommand wraps this in M13.
 *
 * Exit codes: 0 everything consistent, 1 a problem was found or the check
 * itself failed.
 */

import {
  ConfigError,
  ensureRuntimeDirectories,
  loadConfig,
  type LoadedConfig,
} from './config/index.js';
import { openDatabase } from './db/index.js';
import { checkUploads } from './services/photos.js';

const HELP = `Usage: product-rating fsck --uploads [--repair]

  --uploads   Check the upload directory against the photo table
  --repair    Delete files no photo row claims (asks for nothing, so be sure)
  --help      Show this text

Configuration is read the same way as by the server; --config and --set work
here as well.`;

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.warn(HELP);
  process.exit(0);
}

const repair = argv.includes('--repair');
// `--uploads` is the only check that exists so far; asking for it explicitly
// keeps the command's meaning stable once others are added.
if (!argv.includes('--uploads')) {
  console.error('nothing to check; pass --uploads');
  console.error(HELP);
  process.exit(1);
}

let loaded: LoadedConfig;
try {
  loaded = loadConfig({ argv: argv.filter((entry) => !['--uploads', '--repair'].includes(entry)) });
  ensureRuntimeDirectories(loaded.config);
} catch (error) {
  console.error(error instanceof ConfigError ? error.format() : error);
  process.exit(1);
}

const { config } = loaded;
const database = openDatabase({ path: config.paths.database });

try {
  const report = await checkUploads(database.db, config, { repair });

  console.warn(`checked ${report.photos} photo(s) against ${config.paths.uploads}`);

  for (const entry of report.missingFiles) {
    console.warn(
      `missing file: ${entry.path} (photo ${entry.photoId}, product ${entry.productId})`,
    );
  }
  for (const path of report.orphanFiles) {
    console.warn(`orphan file:  ${path}${repair ? ' (removed)' : ''}`);
  }

  const problems = report.missingFiles.length + report.orphanFiles.length;
  console.warn(
    problems === 0
      ? 'no problems found'
      : `${report.missingFiles.length} missing file(s), ${report.orphanFiles.length} orphan file(s)${
          repair ? `, ${report.removed} removed` : ', run again with --repair to remove them'
        }`,
  );

  database.close();
  // Missing files stay a problem even after a repair run; they need a backup.
  process.exit(report.missingFiles.length > 0 || (problems > 0 && !repair) ? 1 : 0);
} catch (error) {
  console.error('check failed:', error);
  database.close();
  process.exit(1);
}
