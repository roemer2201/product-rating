#!/usr/bin/env bash
#
# entrypoint.sh
#
# Description:
#   Container entrypoint of product-rating. Prepares the writable state of the
#   container - data directories and the session secret - brings the database
#   schema up to date and then hands the process over to the API server.
#
#   Everything it does is idempotent: a restart of the container finds its
#   directories, keeps the existing secret and applies only migrations that are
#   still missing.
#
# Program flow:
#   1. Parse arguments and resolve configuration (CLI > env > default).
#   2. Create the data directories (db, uploads, tmp) below the data root.
#   3. Create the session secret with mode 0600 if it does not exist yet.
#   4. Apply the database migrations, unless they were switched off.
#   5. Replace this shell with the API server ("product-rating serve"), so it
#      becomes PID 1 and receives SIGTERM from "docker stop" directly.
#
# Usage:
#   entrypoint.sh [-v|--verbose] [-s|--silent] [-d|--data DIR] [--] [SERVER ARGS]
#
# Version: 1.1.0  (2026-08-16)

# Robustness baseline: a half prepared container must not start serving.
set -euo pipefail

# Script name, used as the log tag and in messages.
SCRIPT_NAME="$(basename -- "${0}")"

# --- Defaults seeded from environment variables ---------------------------
# Precedence: command-line argument > environment variable > built-in default.
# The defaults match the layout of the image: the application lives in
# /app/server, its data in the volume /data.
DATA_DIR="${PRODUCT_RATING_DATA:-/data}"
APP_DIR="${PRODUCT_RATING_APP:-/app/server}"
SECRET_FILE="${PRODUCT_RATING_SECRET_FILE:-/data/secret.env}"
SKIP_MIGRATIONS="${PRODUCT_RATING_SKIP_MIGRATIONS:-0}"
VERBOSE="${PRODUCT_RATING_VERBOSE:-0}"
SILENT="${PRODUCT_RATING_SILENT:-0}"

# Bytes of randomness for a generated secret; the start-up check demands at
# least 32 characters, 32 bytes as hex are 64.
SECRET_BYTES=32

# Print usage information.
usage() {
    cat <<'EOF'
Usage: entrypoint.sh [OPTIONS] [--] [SERVER ARGS]

Prepares the container state of product-rating and starts the API server.
Arguments after "--" are passed on to "product-rating serve" unchanged, for
example "-- --log-level debug".

Every other command of the application is reached through the same bundle,
for instance:
  docker compose exec app node /app/server/dist/index.js user add anna
  docker compose exec app node /app/server/dist/index.js backup --to /data/backups

Options:
  -d, --data DIR      Data root; db/, uploads/ and tmp/ are created below it.
                      Env: PRODUCT_RATING_DATA            Default: /data
  -a, --app DIR       Directory of the application bundle, containing dist/.
                      Env: PRODUCT_RATING_APP             Default: /app/server
      --secret FILE   File holding the session secret, created with mode 0600
                      if missing. Has to match auth.secret_file of the
                      configuration.
                      Env: PRODUCT_RATING_SECRET_FILE     Default: /data/secret.env
      --skip-migrations
                      Start without applying database migrations.
                      Env: PRODUCT_RATING_SKIP_MIGRATIONS Default: 0
  -v, --verbose       Enable verbose (debug) output.
                      Env: PRODUCT_RATING_VERBOSE         Default: 0
  -s, --silent        Suppress all non-error output.
                      Env: PRODUCT_RATING_SILENT          Default: 0
  -h, --help          Show this help and exit.

Precedence for every option: command-line argument > environment variable
> built-in default. Silent and verbose are mutually exclusive.

The configuration itself is not read by this script. The server looks for
/etc/product-rating/config.toml, which the image ships and a deployment may
replace by mounting its own file over it; single values can be overridden with
PR_<SECTION>__<KEY> environment variables.

Example:
  entrypoint.sh --data /srv/product-rating --verbose
EOF
}

# log LEVEL MESSAGE...
# LEVEL is one of: error, warn, info, debug.
#
# Deliberate deviation from the usual convention of logging through "logger":
# a container has no syslog daemon, and its log is what the main process writes
# to stdout and stderr - that is where "docker logs" and every log driver look.
# The level filtering (silent < normal < verbose) stays the same, and errors go
# to stderr so they can be told apart from progress messages.
log() {
    local level="${1}"
    shift
    local message="$*"

    if [ "${level}" = "debug" ] && [ "${VERBOSE}" -ne 1 ]; then
        return 0
    fi
    if [ "${SILENT}" -eq 1 ] && [ "${level}" != "error" ]; then
        return 0
    fi

    if [ "${level}" = "error" ] || [ "${level}" = "warn" ]; then
        printf '%s: %s: %s\n' "${SCRIPT_NAME}" "${level}" "${message}" >&2
    else
        printf '%s: %s: %s\n' "${SCRIPT_NAME}" "${level}" "${message}"
    fi
}

# die MESSAGE...  Report an explicit failure and exit non-zero.
die() {
    log error "$*"
    exit 1
}

# --- Argument parsing (highest precedence) --------------------------------
while [ "$#" -gt 0 ]; do
    case "${1}" in
        -d|--data)
            if [ "$#" -lt 2 ]; then
                printf '%s: option %s requires an argument\n' "${SCRIPT_NAME}" "${1}" >&2
                exit 2
            fi
            DATA_DIR="${2}"
            shift 2
            ;;
        --data=*)
            DATA_DIR="${1#*=}"
            shift
            ;;
        -a|--app)
            if [ "$#" -lt 2 ]; then
                printf '%s: option %s requires an argument\n' "${SCRIPT_NAME}" "${1}" >&2
                exit 2
            fi
            APP_DIR="${2}"
            shift 2
            ;;
        --app=*)
            APP_DIR="${1#*=}"
            shift
            ;;
        --secret)
            if [ "$#" -lt 2 ]; then
                printf '%s: option %s requires an argument\n' "${SCRIPT_NAME}" "${1}" >&2
                exit 2
            fi
            SECRET_FILE="${2}"
            shift 2
            ;;
        --secret=*)
            SECRET_FILE="${1#*=}"
            shift
            ;;
        --skip-migrations)
            SKIP_MIGRATIONS=1
            shift
            ;;
        -v|--verbose)
            VERBOSE=1
            shift
            ;;
        -s|--silent)
            SILENT=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --)
            shift
            break
            ;;
        -*)
            printf '%s: unknown option: %s\n' "${SCRIPT_NAME}" "${1}" >&2
            usage >&2
            exit 2
            ;;
        *)
            # Everything else belongs to the server and stays in "$@".
            break
            ;;
    esac
done

# Silent and verbose are mutually exclusive.
if [ "${SILENT}" -eq 1 ] && [ "${VERBOSE}" -eq 1 ]; then
    printf '%s: --silent and --verbose are mutually exclusive\n' "${SCRIPT_NAME}" >&2
    exit 2
fi

# Creates the writable directories of the container.
#
# The server would create them itself, but it is done here so an unusable
# volume is reported with the one mistake that actually causes it: a bind mount
# from the host belongs to the host user, and the container runs unprivileged.
prepare_directories() {
    local directory
    for directory in "${DATA_DIR}" "${DATA_DIR}/db" "${DATA_DIR}/uploads" "${DATA_DIR}/tmp"; do
        if [ -d "${directory}" ]; then
            continue
        fi
        if ! mkdir -p -- "${directory}"; then
            die "Cannot create ${directory} as uid $(id -u). A bind mounted directory has to belong to the container user, for example: chown -R $(id -u):$(id -g) <host directory>"
        fi
        log debug "Created ${directory}"
    done

    if [ ! -w "${DATA_DIR}" ]; then
        die "Data directory is not writable by uid $(id -u): ${DATA_DIR}"
    fi
}

# Creates the session secret on first start.
#
# Written through node instead of openssl, which the runtime image does not
# carry; the umask keeps the file private from the moment it exists, because a
# secret that is briefly world readable has been leaked.
prepare_secret() {
    if [ -s "${SECRET_FILE}" ]; then
        log debug "Session secret exists: ${SECRET_FILE}"
        return 0
    fi

    local directory
    directory="$(dirname -- "${SECRET_FILE}")"
    mkdir -p -- "${directory}"

    (
        umask 077
        node -e "process.stdout.write(require('node:crypto').randomBytes(${SECRET_BYTES}).toString('hex') + '\n')" \
            > "${SECRET_FILE}"
    )
    chmod 600 -- "${SECRET_FILE}"

    log info "Generated a session secret: ${SECRET_FILE}"
}

# Brings the database schema up to date before the first query runs. The runner
# takes a snapshot of the database itself, so an interrupted upgrade can be
# rolled back to the state before it.
apply_migrations() {
    if [ "${SKIP_MIGRATIONS}" -eq 1 ]; then
        log warn "Skipping database migrations on request"
        return 0
    fi

    log info "Applying database migrations"
    node "${APP_DIR}/dist/index.js" migrate
}

main() {
    log debug "Data directory: ${DATA_DIR}, application: ${APP_DIR}"

    if [ ! -f "${APP_DIR}/dist/index.js" ]; then
        die "Application bundle not found: ${APP_DIR}/dist/index.js"
    fi

    prepare_directories
    prepare_secret
    apply_migrations

    log info "Starting the server"
    # exec, so the server becomes PID 1: "docker stop" then delivers SIGTERM to
    # the process that knows how to shut down, and no shell swallows it.
    # "serve" is one command of the application; the same entry point answers
    # "migrate", "backup" and the rest.
    exec node "${APP_DIR}/dist/index.js" serve "$@"
}

main "$@"
