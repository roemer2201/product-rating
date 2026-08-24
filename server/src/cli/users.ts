import { displayNameSchema, type UserRole } from '@product-rating/shared';
import type { AppConfig } from '../config/index.js';
import type { DbHandle } from '../db/index.js';
import { createPasswordReset } from '../services/passwordResets.js';
import { revokeAllSessions } from '../services/sessions.js';
import {
  createUser,
  findUserByUsername,
  listUsers,
  lockPassword,
  setPassword,
  updateUser,
} from '../services/users.js';
import { EXIT_OK, formatMoment, formatTable, type CliCommand } from './command.js';
import { readStdinLine, type CliIo } from './io.js';
import { numberOption, parseArguments, stringOption, UsageError } from './options.js';
import { loadRuntimeConfig, withDatabase } from './runtime.js';

const USAGE = `Usage: product-rating user <subcommand> [OPTIONS]

Account management from the command line - the way in when nobody can log in
any more, and the way to script the first accounts of a new installation.

Subcommands:
  add USERNAME        Create an account. Asks for the password unless
                      --password-stdin is given.
  list                List the accounts with role and state.
  disable USERNAME    Disable an account and end its sessions. Accounts are
                      never deleted, so ratings and photos keep their owner.
  enable USERNAME     Allow a disabled account to log in again.
  passwd USERNAME     Set a new password and end every session of that account.
  reset-link USERNAME Issue a password link for an account and print it. The
                      account owner opens it and chooses their own password;
                      an earlier link stops working. This application sends no
                      mail, so pass the link on yourself.
  lock USERNAME       Take the password away: nothing but a reset link gets
                      into the account afterwards. For a lost device, or after
                      an import that brought accounts without passwords.
  display-name USERNAME [NAME]
                      Set the name the other accounts see. An empty NAME, or
                      none at all, gives it up again and the username is shown
                      instead. Everybody can do this for themselves in the web
                      interface; this is the way in for a script.

Options:
      --role ROLE     Role of a new account: user (default) or admin.
      --email ADDRESS E-mail address of a new account.
      --display-name NAME
                      Name of a new account as the others see it.
      --ttl-hours N   Lifetime of a reset link, overriding
                      auth.password_reset_ttl_hours.
      --password-stdin
                      Read the password from standard input instead of asking
                      for it. The only way that keeps it out of the shell
                      history and out of the process list.
      --help          Show this help and exit.

Configuration options are accepted as well; "product-rating help" lists them.

Examples:
  product-rating user add anna --role admin --display-name "Anna"
  product-rating user display-name anna "Anna aus dem Bad"
  echo "correct horse battery staple" | product-rating user add tom --password-stdin
  product-rating user passwd anna
  product-rating user reset-link anna
  product-rating user disable tom`;

/**
 * Checks a display name against the same rule the API applies.
 *
 * An empty value means "no display name" rather than an error: that is how a
 * name is given up again, on the command line as well as in a form.
 */
function parseDisplayName(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0) return null;

  const parsed = displayNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new UsageError(`display name: ${parsed.error.issues[0]?.message ?? 'not a valid name'}`);
  }
  return parsed.data;
}

/** Roles the CLI accepts, matching the ones in the database. */
const ROLES = ['user', 'admin'] as const;

function isRole(value: string): value is UserRole {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Obtains the password for a new or changed account.
 *
 * A password on the command line would end up in the shell history and, for
 * as long as the process runs, in the process list of every user on the
 * machine — so there is no `--password` option. What is left is a pipe for
 * scripts and a prompt for people, the second one asked twice because a typo
 * in a password nobody can see locks an account out.
 */
async function readPassword(io: CliIo, fromStdin: boolean): Promise<string> {
  if (fromStdin) {
    const password = await readStdinLine();
    if (password.length === 0) throw new Error('no password arrived on standard input');
    return password;
  }

  const password = await io.askSecret('New password: ');
  const repeated = await io.askSecret('Repeat the password: ');

  if (password !== repeated) throw new Error('the two passwords do not match');
  if (password.length === 0) throw new Error('the password is empty');

  return password;
}

/** Looks an account up by name and says so clearly when there is none. */
function requireUser(db: DbHandle, username: string): { id: string; username: string } {
  const row = findUserByUsername(db, username);
  if (row === undefined) throw new Error(`no account named "${username}"`);
  return { id: row.id, username: row.username };
}

async function addUser(
  db: DbHandle,
  config: AppConfig,
  io: CliIo,
  username: string,
  options: {
    role?: string | undefined;
    email?: string | undefined;
    displayName?: string | undefined;
    stdin: boolean;
  },
): Promise<number> {
  const role = options.role ?? 'user';
  if (!isRole(role)) throw new UsageError(`--role has to be one of: ${ROLES.join(', ')}`);

  const password = await readPassword(io, options.stdin);
  const user = await createUser(db, config, {
    username,
    password,
    email: options.email ?? null,
    displayName: parseDisplayName(options.displayName),
    role,
  });

  io.out(`created ${user.username} (${user.role}), id ${user.id}`);
  return EXIT_OK;
}

export const userCommand: CliCommand = {
  name: 'user',
  summary: 'Manage accounts: add, list, disable, enable, passwd, reset-link, lock, display-name',
  usage: USAGE,

  async run({ argv, io }) {
    const { options, positionals, configArgs } = parseArguments(argv, {
      help: 'boolean',
      role: 'string',
      email: 'string',
      'display-name': 'string',
      'ttl-hours': 'string',
      'password-stdin': 'boolean',
    });

    if (options.help === true) {
      io.out(USAGE);
      return EXIT_OK;
    }
    if (positionals.length === 0) throw new UsageError('no subcommand given');

    const [subcommand, name] = positionals;
    const { config } = loadRuntimeConfig(configArgs);
    const fromStdin = options['password-stdin'] === true;

    return withDatabase(config, async ({ db }) => {
      switch (subcommand) {
        case 'add': {
          if (name === undefined) throw new UsageError('user add needs a username');
          return addUser(db, config, io, name, {
            role: stringOption(options, 'role'),
            email: stringOption(options, 'email'),
            displayName: stringOption(options, 'display-name'),
            stdin: fromStdin,
          });
        }

        case 'list': {
          const rows = listUsers(db);
          if (rows.length === 0) {
            io.out('no accounts yet');
            return EXIT_OK;
          }

          const table = formatTable([
            ['USERNAME', 'DISPLAY NAME', 'ROLE', 'STATE', 'CREATED', 'EMAIL'],
            ...rows.map((user) => [
              user.username,
              user.displayName ?? '-',
              user.role,
              user.disabledAt !== null
                ? 'disabled'
                : user.passwordResetRequired
                  ? 'needs password'
                  : 'active',
              formatMoment(user.createdAt),
              user.email ?? '-',
            ]),
          ]);
          for (const line of table) io.out(line);
          return EXIT_OK;
        }

        case 'disable':
        case 'enable': {
          if (name === undefined) throw new UsageError(`user ${subcommand} needs a username`);
          const target = requireUser(db, name);
          const disabled = subcommand === 'disable';

          updateUser(db, target.id, { disabled });

          // A disabled account keeps no way back in until it is enabled
          // again; the same rule the web interface follows.
          const revoked = disabled ? revokeAllSessions(db, target.id) : 0;
          io.out(
            disabled
              ? `disabled ${target.username}, ${String(revoked)} session(s) ended`
              : `enabled ${target.username}`,
          );
          return EXIT_OK;
        }

        case 'passwd': {
          if (name === undefined) throw new UsageError('user passwd needs a username');
          const target = requireUser(db, name);

          const password = await readPassword(io, fromStdin);
          await setPassword(db, config, target.id, password);

          // A new password only helps if the old sessions go with it.
          const revoked = revokeAllSessions(db, target.id);
          io.out(`password of ${target.username} changed, ${String(revoked)} session(s) ended`);
          return EXIT_OK;
        }

        case 'reset-link': {
          if (name === undefined) throw new UsageError('user reset-link needs a username');
          const target = requireUser(db, name);

          const link = createPasswordReset(db, config, {
            userId: target.id,
            // Nobody is logged in on a command line; the row records that.
            createdBy: null,
            ...(options['ttl-hours'] === undefined
              ? {}
              : { ttlHours: numberOption(options, 'ttl-hours', 48, 1) }),
          });

          // The link on standard output, everything else on standard error, so
          // it can be piped into a message without the explanation around it.
          io.out(link.url);
          io.err(
            `password link for ${link.username}, valid until ` +
              `${formatMoment(link.expiresAt)}. It is shown once - only its hash ` +
              'is stored. Any earlier link no longer works.',
          );
          return EXIT_OK;
        }

        case 'lock': {
          if (name === undefined) throw new UsageError('user lock needs a username');
          const target = requireUser(db, name);

          lockPassword(db, target.id);
          const revoked = revokeAllSessions(db, target.id);

          io.out(
            `password of ${target.username} removed, ${String(revoked)} session(s) ended; ` +
              `issue a link with "product-rating user reset-link ${target.username}"`,
          );
          return EXIT_OK;
        }

        case 'display-name': {
          if (name === undefined) throw new UsageError('user display-name needs a username');
          const target = requireUser(db, name);

          // The name may contain spaces, so it is the rest of the line rather
          // than one word: "user display-name anna Anna aus dem Bad" works
          // without quotes, and quoting it works just as well.
          const wanted = parseDisplayName(positionals.slice(2).join(' '));
          const updated = updateUser(db, target.id, { displayName: wanted });

          io.out(
            updated.displayName === null
              ? `${target.username} is shown by its username again`
              : `${target.username} is shown as "${updated.displayName}"`,
          );
          return EXIT_OK;
        }

        default:
          throw new UsageError(`unknown subcommand: user ${String(subcommand)}`);
      }
    });
  },
};
