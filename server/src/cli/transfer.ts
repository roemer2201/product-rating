import {
  exportCatalogue,
  importCatalogue,
  EXPORT_JSON_FILE,
  type ExportFormat,
} from '../services/transfer.js';
import { EXIT_FAILURE, EXIT_OK, type CliCommand } from './command.js';
import { parseArguments, requiredOption, UsageError } from './options.js';
import { loadRuntimeConfig, withDatabase } from './runtime.js';

/**
 * `export` and `import`: the catalogue in a readable form.
 *
 * Both are about moving data between installations, not about saving one —
 * `backup` and `restore` do that, database file and all. What travels here are
 * products, verdicts, recorded prices and pictures, addressed by EAN and by
 * user name, so the other end may be a fresh installation, another host, or a
 * spreadsheet.
 */

const EXPORT_USAGE = `Usage: product-rating export --to DIR [OPTIONS]

Writes the catalogue into a directory:

  DIR/${EXPORT_JSON_FILE}     everything, in the form "product-rating import" reads
  DIR/products.csv    one row per product, with rating count and average
  DIR/ratings.csv     one row per rating
  DIR/prices.csv      one row per recorded price
  DIR/photos/         the detail images, with --with-photos

Accounts are deliberately not part of an export: it would turn a file into a
set of credentials. Products, ratings, prices and photos name their account by
user name, and the import matches those names against the accounts of the
target instance.

Options:
      --to DIR        Directory to write into; created if it is missing.
                      Required.
      --format FORMAT json (the default), csv, or both.
      --with-photos   Copy the detail images into DIR/photos as well. Without
                      it the export is text only and stays small.
      --include-trash Take products in the trash along; left out by default.
      --help          Show this help and exit.

Configuration options are accepted as well; "product-rating help" lists them.

CSV is written as RFC 4180 with a byte order mark, so a spreadsheet reads the
umlauts correctly. It is an export format only - "import" reads the JSON file.

Examples:
  product-rating export --to /tmp/catalogue
  product-rating export --to /srv/move --format both --with-photos`;

const IMPORT_USAGE = `Usage: product-rating import --from DIR [OPTIONS]

Reads an export written by "product-rating export" into this instance. DIR is
the directory holding ${EXPORT_JSON_FILE}, or the file itself.

Merging, not replacing: a product that already exists here keeps its data
unless --update is given, and an existing rating is never overwritten - a
verdict belongs to whoever gave it. The same file can therefore be read twice
without doubling anything.

Accounts have to exist here. A user name the file mentions and this instance
does not know stops the import before anything is written, unless --owner
names the account that takes those entries over.

Options:
      --from DIR      Directory of the export, or the ${EXPORT_JSON_FILE} itself.
                      Required.
      --owner USER    Account for entries whose user name is unknown here.
      --update        Write the data of products that already exist over what
                      is stored; also takes them out of the trash.
      --dry-run       Read and check everything, change nothing.
      --help          Show this help and exit.

Configuration options are accepted as well; "product-rating help" lists them.

Exit codes: 0 the import went through, 1 it failed or had to skip entries.

Examples:
  product-rating import --from /srv/move --dry-run
  product-rating import --from /srv/move --owner anna`;

function exportFormat(value: string | boolean | undefined): ExportFormat {
  if (value === undefined) return 'json';
  if (value === 'json' || value === 'csv' || value === 'both') return value;
  throw new UsageError('--format takes json, csv or both');
}

export const exportCommand: CliCommand = {
  name: 'export',
  summary: 'Write the catalogue as JSON and CSV',
  usage: EXPORT_USAGE,

  async run({ argv, io }) {
    const { options, configArgs } = parseArguments(argv, {
      help: 'boolean',
      to: 'string',
      format: 'string',
      'with-photos': 'boolean',
      'include-trash': 'boolean',
    });

    if (options.help === true) {
      io.out(EXPORT_USAGE);
      return EXIT_OK;
    }

    const target = requiredOption(options, 'to');
    const format = exportFormat(options.format);
    const { config } = loadRuntimeConfig(configArgs);

    return withDatabase(config, async ({ db }) => {
      const result = await exportCatalogue({
        db,
        config,
        target,
        format,
        withPhotos: options['with-photos'] === true,
        includeTrash: options['include-trash'] === true,
        onProgress: (message) => {
          io.err(message);
        },
      });

      // The directory on standard output, so a script can pick it up.
      io.out(result.directory);
      io.err(
        `${String(result.products)} product(s), ${String(result.ratings)} rating(s), ` +
          `${String(result.prices)} price(s), ${String(result.photos)} photo(s)` +
          (result.photoFiles > 0 ? `, ${String(result.photoFiles)} image file(s)` : ''),
      );

      if (result.missingPhotoFiles > 0) {
        io.err(
          `${String(result.missingPhotoFiles)} image file(s) are missing on disk; ` +
            'run "product-rating fsck --uploads"',
        );
        return EXIT_FAILURE;
      }

      return EXIT_OK;
    });
  },
};

export const importCommand: CliCommand = {
  name: 'import',
  summary: 'Read an export into this instance',
  usage: IMPORT_USAGE,

  async run({ argv, io }) {
    const { options, configArgs } = parseArguments(argv, {
      help: 'boolean',
      from: 'string',
      owner: 'string',
      update: 'boolean',
      'dry-run': 'boolean',
    });

    if (options.help === true) {
      io.out(IMPORT_USAGE);
      return EXIT_OK;
    }

    const source = requiredOption(options, 'from');
    const dryRun = options['dry-run'] === true;
    const { config } = loadRuntimeConfig(configArgs);

    return withDatabase(config, async ({ db }) => {
      const result = await importCatalogue({
        db,
        config,
        source,
        ...(typeof options.owner === 'string' ? { owner: options.owner } : {}),
        update: options.update === true,
        dryRun,
      });

      if (dryRun) io.err('dry run: nothing was written');

      io.out(
        `products: ${String(result.productsCreated)} new, ` +
          `${String(result.productsUpdated)} updated, ` +
          `${String(result.productsSkipped)} already here`,
      );
      io.out(
        `ratings: ${String(result.ratingsCreated)} new, ` +
          `${String(result.ratingsSkipped)} already here`,
      );
      io.out(
        `prices: ${String(result.pricesCreated)} new, ` +
          `${String(result.pricesSkipped)} already here`,
      );
      io.out(
        `photos: ${String(result.photosCreated)} new, ` +
          `${String(result.photosSkipped)} already here`,
      );

      if (result.unknownUsers.length > 0) {
        io.err(`taken over by --owner: ${result.unknownUsers.join(', ')}`);
      }
      for (const problem of result.problems) {
        io.err(problem);
      }

      return result.problems.length > 0 ? EXIT_FAILURE : EXIT_OK;
    });
  },
};
