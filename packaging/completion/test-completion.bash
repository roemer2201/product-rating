#!/usr/bin/env bash
#
# test-completion.bash
#
# Description:
#   Checks the bash completion of product-rating against a real
#   bash-completion library. Every case sets COMP_WORDS, COMP_CWORD, COMP_LINE
#   and COMP_POINT the way Bash does on TAB, calls the completion function and
#   compares the candidates. Works with both helper generations of the
#   library (_init_completion up to 2.11, _comp_initialize from 2.12).
#   Includes quoted values and protected word breaks in filenames.
#
#   Called by server/src/cli/completion.test.ts when a library is installed;
#   can be run on its own as well. It sources the files it is given, so pass
#   only trusted ones.
#
# Program flow:
#   1. Parse arguments and resolve the inputs (CLI > env > default).
#   2. Source library and completion in this shell, with the user's own
#      completion files kept out.
#   3. Create file fixtures in a temporary directory and change into it.
#   4. Run every case; the first wrong result ends the run with exit code 1.
#   5. Print one PASS line with the number of cases and the versions.
#
# Usage:
#   test-completion.bash [LIBRARY [COMPLETION]]
#   test-completion.bash --help
#
# Output is a single PASS line or the description of the failed case; there
# is nothing to make quieter or louder, so no --silent and no --verbose.
#
# Version: 1.0.1  (2026-10-18)

# Explain inputs without sourcing anything.
usage() {
    cat <<'EOF'
Usage: test-completion.bash [LIBRARY [COMPLETION]]

Checks the bash completion of product-rating with real bash-completion
helpers.

Arguments:
  LIBRARY     bash_completion file of the library.
              Env: COMPLETION_TEST_LIBRARY
              Default: /usr/share/bash-completion/bash_completion
  COMPLETION  The completion under test.
              Env: COMPLETION_TEST_FILE
              Default: product-rating.bash next to this script
  -h, --help  Show this help and exit.

Precedence: command-line argument > environment variable > default.
Exit codes: 0 every case passed, 1 a case failed, 2 called wrongly.
EOF
}

case "${1-}" in
    -h|--help) usage; exit 0 ;;
esac
if (($# > 2)); then
    usage >&2
    exit 2
fi

# Locate inputs before changing directory; the fixtures live in a temp dir.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 1
library="${1:-${COMPLETION_TEST_LIBRARY:-/usr/share/bash-completion/bash_completion}}"
completion="${2:-${COMPLETION_TEST_FILE:-${script_dir}/product-rating.bash}}"
for input in "${library}" "${completion}"; do
    if [[ ! -r "${input}" ]]; then
        printf 'Cannot read input: %s\n' "${input}" >&2
        exit 2
    fi
done

# Keep library initialization independent of the user's own files. These are
# read by the sourced library, not by this script.
export BASH_COMPLETION_COMPAT_DIR=/nonexistent
export BASH_COMPLETION_USER_FILE=/nonexistent
# shellcheck disable=SC1090
source "${library}" || exit 1
# shellcheck disable=SC1090
source "${completion}" || exit 1
complete -p product-rating >/dev/null || exit 1

test_dir="$(mktemp -d "${TMPDIR:-/tmp}/product-rating-completion.XXXXXXXX")" || exit 1
trap 'rm -rf -- "${test_dir}"' EXIT
cd -- "${test_dir}" || exit 1
mkdir -- 'snap shots' backups || exit 1
touch -- 'my config.toml' 'db-12:00.db' export.json || exit 1
touch -- 'equal=sign.toml' || exit 1

# Simulate Bash's context for a cursor at the end of the line. COMP_LINE is
# given separately, because Bash splits words at '=' and ':' on its own.
run_completion() {
    local line="${1}"
    shift
    COMP_WORDS=("${@}")
    COMP_CWORD=$((${#COMP_WORDS[@]} - 1))
    COMP_LINE="${line}"
    COMP_POINT="${#COMP_LINE}"
    COMPREPLY=(stale)
    _product_rating "${COMP_WORDS[0]}" "${COMP_WORDS[COMP_CWORD]}" \
        "${COMP_WORDS[COMP_CWORD-1]}" || exit 1
    ((test_count += 1))
}

# Exact candidates, in order, for contexts with a fixed set.
expect_exact() {
    local expected=("${@}") i
    if ((${#COMPREPLY[@]} != ${#expected[@]})); then
        printf 'Wrong candidate count for: %s\n' "${COMP_LINE}" >&2
        printf 'Got: <%s>\n' "${COMPREPLY[@]}" >&2
        printf 'Expected: <%s>\n' "${expected[@]}" >&2
        exit 1
    fi
    for i in "${!expected[@]}"; do
        if [[ "${COMPREPLY[i]}" != "${expected[i]}" ]]; then
            printf 'Wrong candidate for: %s\n' "${COMP_LINE}" >&2
            printf 'Got: <%s>\n' "${COMPREPLY[@]}" >&2
            exit 1
        fi
    done
}

# Membership, for file contexts whose order is the library's business.
expect_contains() {
    local candidate
    for candidate in "${COMPREPLY[@]}"; do
        [[ "${candidate%/}" == "${1}" ]] && return 0
    done
    printf 'Missing candidate <%s> for: %s\n' "${1}" "${COMP_LINE}" >&2
    printf 'Got: <%s>\n' "${COMPREPLY[@]}" >&2
    exit 1
}

expect_lacks() {
    local candidate
    for candidate in "${COMPREPLY[@]}"; do
        if [[ "${candidate%/}" == "${1}" ]]; then
            printf 'Unexpected candidate <%s> for: %s\n' "${1}" "${COMP_LINE}" >&2
            exit 1
        fi
    done
}

test_count=0

# Commands, help and version.
run_completion 'product-rating ' product-rating ''
expect_exact serve migrate user invite backup restore export import fsck \
    proxy-config help version
run_completion 'product-rating pr' product-rating pr
expect_exact proxy-config
run_completion 'product-rating -' product-rating -
expect_exact --help -h --version -V
run_completion 'product-rating help i' product-rating help i
expect_exact invite import
run_completion 'product-rating help user ' product-rating help user ''
expect_exact
run_completion 'product-rating version ' product-rating version ''
expect_exact
run_completion 'product-rating bogus ' product-rating bogus ''
expect_exact

# Options of a command, configuration flags included.
run_completion 'product-rating backup --' product-rating backup --
expect_exact --help --to --keep-days --config --set --host --port \
    --base-url --database --uploads --temp --log-level --log-format \
    --log-destination
run_completion 'product-rating backup ' product-rating backup ''
expect_contains --to
run_completion 'product-rating proxy-config --no' product-rating proxy-config --no
expect_exact --no-redirect
# fsck --uploads is the check, a flag; it must not wait for a path.
run_completion 'product-rating fsck --uploads --r' product-rating fsck --uploads --r
expect_exact --repair
run_completion 'product-rating fsck --up' product-rating fsck --up
expect_exact --uploads
run_completion 'product-rating serve --help ' product-rating serve --help ''
expect_exact
run_completion 'product-rating serve --bogus ' product-rating serve --bogus ''
expect_exact

# Values in both spellings, and enumerations without a file fallback.
run_completion 'product-rating serve --log-level d' product-rating serve --log-level d
expect_exact debug
run_completion 'product-rating serve --log-level=' product-rating serve --log-level = ''
expect_exact error warn info debug
run_completion 'product-rating serve --log-format nope' product-rating serve --log-format nope
expect_exact
run_completion 'product-rating proxy-config --server ap' product-rating proxy-config --server ap
expect_exact apache apache2
run_completion 'product-rating export --format=c' product-rating export --format = c
expect_exact csv
run_completion 'product-rating user add anna --role a' product-rating user add anna --role a
expect_exact admin
# A value is consumed even when it looks like a command or subcommand.
run_completion 'product-rating user --role user a' product-rating user --role user a
expect_exact add

# Subcommands and their arguments.
run_completion 'product-rating user ' product-rating user ''
expect_exact add list disable enable passwd reset-link lock display-name
run_completion 'product-rating user add ' product-rating user add ''
expect_exact
run_completion 'product-rating user add anna ' product-rating user add anna ''
expect_contains --password-stdin
run_completion 'product-rating user display-name anna ' product-rating user display-name anna ''
expect_exact
run_completion 'product-rating invite r' product-rating invite r
expect_exact revoke
run_completion 'product-rating invite create ' product-rating invite create ''
expect_contains --note
run_completion 'product-rating invite revoke ' product-rating invite revoke ''
expect_exact
run_completion 'product-rating user -- --r' product-rating user -- --r
expect_exact

# --set: keys first, then what the key takes.
run_completion 'product-rating serve --set log.l' product-rating serve --set log.l
expect_exact log.level=
run_completion 'product-rating serve --set log.level=w' \
    product-rating serve --set log.level = w
expect_exact warn
run_completion 'product-rating serve --set=log.level=' \
    product-rating serve --set = log.level = ''
expect_exact error warn info debug
run_completion 'product-rating serve --set=server.trust_proxy=t' \
    product-rating serve --set = server.trust_proxy = t
expect_exact true
run_completion 'product-rating serve --set server.port=' \
    product-rating serve --set server.port = ''
expect_exact
run_completion 'product-rating serve --set app.external_lookup=' \
    product-rating serve --set app.external_lookup = ''
expect_exact false
run_completion 'product-rating serve --set paths.uploads=sn' \
    product-rating serve --set paths.uploads = sn
expect_exact 'snap shots'

# Files and directories, with spaces and ':' in their names.
run_completion 'product-rating serve --config my' product-rating serve --config my
expect_contains 'my config.toml'
run_completion 'product-rating serve --config=my' product-rating serve --config = my
expect_contains 'my config.toml'
run_completion 'product-rating backup --to ' product-rating backup --to ''
expect_contains 'snap shots'
expect_lacks export.json
run_completion 'product-rating restore --from sn' product-rating restore --from sn
expect_exact 'snap shots'
run_completion 'product-rating import --from ex' product-rating import --from ex
expect_contains export.json
# Readline inserts only the text after the last ':' of a file name.
run_completion 'product-rating serve --database db-12:' \
    product-rating serve --database db-12 :
expect_exact '00.db'

# Quotes and escapes protect word breaks: Readline replaces the whole quoted
# or escaped filename, even when it contains ':' or '='.
run_completion 'product-rating serve --database="db-12:' \
    product-rating serve --database = '"db-12:'
expect_exact 'db-12:00.db'
run_completion "product-rating serve --database='db-12:" \
    product-rating serve --database = "'db-12:"
expect_exact 'db-12:00.db'
run_completion 'product-rating serve --database=db-12\:' \
    product-rating serve --database = 'db-12\:'
expect_exact 'db-12:00.db'
run_completion 'product-rating serve --config=equal\=' \
    product-rating serve --config = 'equal\='
expect_exact 'equal=sign.toml'
run_completion 'product-rating serve --config="equal=' \
    product-rating serve --config = '"equal='
expect_exact 'equal=sign.toml'
run_completion 'product-rating serve --set paths.database="db-12:' \
    product-rating serve --set paths.database = '"db-12:'
expect_exact 'db-12:00.db'
run_completion 'product-rating serve --set=paths.database="db-12:' \
    product-rating serve --set = paths.database = '"db-12:'
expect_exact 'db-12:00.db'
run_completion 'product-rating serve --set="paths.database=db-12:' \
    product-rating serve --set = '"paths.database=db-12:'
expect_exact 'paths.database=db-12:00.db'
run_completion 'product-rating serve --log-level="d' \
    product-rating serve --log-level = '"d'
expect_exact debug
run_completion "product-rating serve --log-level='d" \
    product-rating serve --log-level = "'d"
expect_exact debug
run_completion 'product-rating serve --set log.level="d' \
    product-rating serve --set log.level = '"d'
expect_exact debug
run_completion 'product-rating serve --set="log.level=d' \
    product-rating serve --set = '"log.level=d'
expect_exact log.level=debug
run_completion 'product-rating serve --set "log.l' \
    product-rating serve --set '"log.l'
expect_exact log.level=

run_completion 'product-rating serve --database=db-12:0' \
    product-rating serve --database = db-12 : 0
expect_exact '00.db'

# Without '=' as a word break the whole word is replaced, prefix included.
COMP_WORDBREAKS="${COMP_WORDBREAKS//=/}"
run_completion 'product-rating serve --log-level=i' product-rating serve --log-level=i
expect_exact --log-level=info
run_completion 'product-rating serve --set=log.format=p' \
    product-rating serve --set=log.format=p
expect_exact --set=log.format=pretty

# Arguments to the right of the cursor do not change the parse.
COMP_WORDS=(product-rating user a --role admin)
COMP_CWORD=2
COMP_LINE='product-rating user a --role admin'
cursor_prefix='product-rating user a'
COMP_POINT="${#cursor_prefix}"
COMPREPLY=(stale)
_product_rating product-rating a user || exit 1
expect_exact add
((test_count += 1))

printf 'PASS: %s completion contexts; bash-completion %s; Bash %s\n' \
    "${test_count}" "${BASH_COMPLETION_VERSINFO[*]:-unknown}" "${BASH_VERSION}"
