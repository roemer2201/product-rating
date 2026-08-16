import type { DbHandle } from '../db/index.js';
import { createInvite, listInvites, revokeInvite } from '../services/invites.js';
import { findUserById, findUserByUsername, listUsers } from '../services/users.js';
import { EXIT_OK, formatMoment, formatTable, type CliCommand } from './command.js';
import { numberOption, parseArguments, stringOption, UsageError } from './options.js';
import { loadRuntimeConfig, withDatabase } from './runtime.js';

const USAGE = `Usage: product-rating invite <subcommand> [OPTIONS]

Invite codes. There is no open registration: an account only comes into
existence with a code, and a code is single use and short lived.

Subcommands:
  create              Hand out a new code and print it.
  list                List the codes with their state.
  revoke CODE         Delete a code that has not been used yet.

Options:
      --as USERNAME   Account the new code is attributed to. Defaults to the
                      oldest active administrator.
      --note TEXT     Note for the code, so a list of them stays readable.
      --ttl DAYS      Lifetime of the code; defaults to auth.invite_ttl_days.
      --help          Show this help and exit.

Configuration options are accepted as well; "product-rating help" lists them.

Examples:
  product-rating invite create --note "for Tom"
  product-rating invite list
  product-rating invite revoke A1B2-C3D4-E5F6`;

/**
 * Decides whose name a code is handed out under.
 *
 * `invites.created_by` points at an account, so a code needs one. Without
 * `--as` that is the oldest active administrator — the person who would have
 * created it in the web interface anyway.
 */
function resolveIssuer(db: DbHandle, username: string | undefined): { id: string; name: string } {
  if (username !== undefined) {
    const user = findUserByUsername(db, username);
    if (user === undefined) throw new Error(`no account named "${username}"`);
    if (user.disabledAt !== null) throw new Error(`the account "${user.username}" is disabled`);
    return { id: user.id, name: user.username };
  }

  const admin = listUsers(db)
    .filter((user) => user.role === 'admin' && user.disabledAt === null)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(0);

  if (admin === undefined) {
    throw new Error(
      'there is no active administrator to attribute the code to; create one with: ' +
        'product-rating user add NAME --role admin',
    );
  }

  return { id: admin.id, name: admin.username };
}

/** Username behind an id, for the list. Deleted accounts do not exist. */
function usernameOf(db: DbHandle, id: string | null): string {
  if (id === null) return '-';
  return findUserById(db, id)?.username ?? id;
}

export const inviteCommand: CliCommand = {
  name: 'invite',
  summary: 'Manage invite codes: create, list, revoke',
  usage: USAGE,

  async run({ argv, io }) {
    const { options, positionals, configArgs } = parseArguments(argv, {
      help: 'boolean',
      as: 'string',
      note: 'string',
      ttl: 'string',
    });

    if (options.help === true) {
      io.out(USAGE);
      return EXIT_OK;
    }
    if (positionals.length === 0) throw new UsageError('no subcommand given');

    const [subcommand, argument] = positionals;
    const { config } = loadRuntimeConfig(configArgs);

    return withDatabase(config, ({ db }) => {
      switch (subcommand) {
        case 'create': {
          const issuer = resolveIssuer(db, stringOption(options, 'as'));
          const ttlDays = numberOption(options, 'ttl', config.auth.invite_ttl_days, 1);

          const invite = createInvite(db, config, {
            createdBy: issuer.id,
            note: stringOption(options, 'note') ?? null,
            ttlDays,
          });

          io.out(invite.code);
          io.err(
            `created by ${issuer.name}, valid until ${formatMoment(invite.expiresAt)} ` +
              `(${String(ttlDays)} day(s))`,
          );
          return EXIT_OK;
        }

        case 'list': {
          const rows = listInvites(db);
          if (rows.length === 0) {
            io.out('no invite codes yet');
            return EXIT_OK;
          }

          const table = formatTable([
            ['CODE', 'STATE', 'EXPIRES', 'CREATED BY', 'USED BY', 'NOTE'],
            ...rows.map((invite) => [
              invite.code,
              invite.status,
              formatMoment(invite.expiresAt),
              usernameOf(db, invite.createdBy),
              usernameOf(db, invite.usedBy),
              invite.note ?? '-',
            ]),
          ]);
          for (const line of table) io.out(line);
          return EXIT_OK;
        }

        case 'revoke': {
          if (argument === undefined) throw new UsageError('invite revoke needs a code');
          revokeInvite(db, argument);
          io.out(`revoked ${argument.trim().toUpperCase()}`);
          return EXIT_OK;
        }

        default:
          throw new UsageError(`unknown subcommand: invite ${String(subcommand)}`);
      }
    });
  },
};
