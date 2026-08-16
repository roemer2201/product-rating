#!/usr/bin/env node
/**
 * Process entry point of the server bundle.
 *
 * Everything it does is hand the arguments to the command dispatcher and turn
 * its answer into an exit code. `serve` is a command like any other, so the
 * systemd unit, the container entrypoint and an administrator on a terminal
 * all go through the same path.
 */

import { runCli } from './cli/index.js';

process.exitCode = await runCli(process.argv.slice(2));
