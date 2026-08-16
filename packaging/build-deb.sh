#!/usr/bin/env bash
#
# build-deb.sh
#
# Description:
#   Builds the Debian package of product-rating. Compiles both workspaces,
#   assembles a runtime-only dependency tree, lays out the installation tree
#   under packaging/build/ and turns it into a .deb with dpkg-deb. If lintian
#   is installed, the result is checked with it.
#
#   The package is architecture dependent, because better-sqlite3, sharp and
#   @node-rs/argon2 carry native binaries. Those come from the build host, so
#   the script refuses to label a package as an architecture it is not running
#   on - see --arch below.
#
# Program flow:
#   1. Parse arguments and resolve configuration (CLI > env > default).
#   2. Verify the prerequisites: node, npm, dpkg-deb, and a matching
#      architecture.
#   3. Build the server bundle and the web client (unless --skip-build).
#   4. Install the runtime dependencies of the server into a staging directory,
#      then drop the binaries of every foreign platform from it.
#   5. Lay out the installation tree: /opt, /etc, /usr/bin, the systemd unit,
#      the logrotate rule and the documentation.
#   6. Fill in DEBIAN/: control with its substitutions, conffiles, templates,
#      the maintainer scripts and md5sums.
#   7. Build the .deb with dpkg-deb and report where it is.
#   8. Run lintian, if it is available.
#
# Usage:
#   build-deb.sh [-v|--verbose] [-s|--silent] [-o|--output DIR]
#                [--version VERSION] [-a|--arch ARCH] [--skip-build]
#                [--skip-lintian]
#
# Version: 1.0.0  (2026-08-15)

# Robustness baseline: a package assembled from a half finished tree would
# install and then fail at run time, which is the worst of both worlds.
set -euo pipefail

# Script name, used as the logger tag and in messages.
SCRIPT_NAME="$(basename -- "${0}")"

# Repository root, derived from the location of this script rather than from
# the working directory, so the script works from anywhere.
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Name of the package and of the directories it owns. In one place because the
# layout appears in a dozen paths below.
PACKAGE_NAME="product-rating"
INSTALL_PREFIX="/opt/${PACKAGE_NAME}"

# --- Defaults seeded from environment variables ---------------------------
# Precedence: command-line argument > environment variable > built-in default.
OUTPUT_DIR="${BUILD_DEB_OUTPUT:-${REPO_ROOT}/packaging/build}"
VERSION="${BUILD_DEB_VERSION:-}"
ARCH="${BUILD_DEB_ARCH:-}"
# Node's name for the same architecture; derived from ARCH once it is settled.
NODE_ARCH=""
SKIP_BUILD="${BUILD_DEB_SKIP_BUILD:-0}"
SKIP_LINTIAN="${BUILD_DEB_SKIP_LINTIAN:-0}"
VERBOSE="${BUILD_DEB_VERBOSE:-0}"
SILENT="${BUILD_DEB_SILENT:-0}"

# Print usage information.
usage() {
    cat <<'EOF'
Usage: build-deb.sh [OPTIONS]

Builds the Debian package of product-rating for the architecture of the build
host and writes it to the output directory.

Options:
  -o, --output DIR    Directory for the build tree and the finished .deb.
                      Env: BUILD_DEB_OUTPUT       Default: packaging/build
      --version VER   Version of the package.
                      Env: BUILD_DEB_VERSION      Default: version in package.json
  -a, --arch ARCH     Debian architecture to label the package with. Has to be
                      the architecture of the build host: the native modules
                      are the ones installed here, and a package that claims
                      otherwise installs and then fails to start.
                      Env: BUILD_DEB_ARCH         Default: dpkg --print-architecture
      --skip-build    Reuse the existing server/dist and web/dist instead of
                      building them again.
                      Env: BUILD_DEB_SKIP_BUILD   Default: 0
      --skip-lintian  Do not check the finished package with lintian.
                      Env: BUILD_DEB_SKIP_LINTIAN Default: 0
  -v, --verbose       Enable verbose (debug) output.
                      Env: BUILD_DEB_VERBOSE      Default: 0
  -s, --silent        Suppress all non-error output.
                      Env: BUILD_DEB_SILENT       Default: 0
  -h, --help          Show this help and exit.

Precedence for every option: command-line argument > environment variable
> built-in default. Silent and verbose are mutually exclusive.

Building for the other architecture means building on it. In a container:

  docker run --rm -v "${PWD}:/src" -w /src --platform linux/arm64 \
    node:22-bookworm bash -c 'apt-get update && apt-get install -y dpkg-dev \
      && npm run package:deb'

Example:
  build-deb.sh --version 1.0.0 --output /tmp/debs --verbose
EOF
}

# log LEVEL MESSAGE...
# LEVEL is one of: error, warn, info, debug.
#
# Records every entry in syslog/journal, so an unattended build in a pipeline
# leaves a trace, and prints to the console when one is attached. logger is
# called only if it exists - a build container often has no syslog at all, and
# a missing log line must not fail the build.
log() {
    local level="${1}"
    shift
    local message="$*"

    local priority="user.notice"
    case "${level}" in
        error) priority="user.err" ;;
        warn)  priority="user.warning" ;;
        info)  priority="user.info" ;;
        debug) priority="user.debug" ;;
    esac

    if [ "${level}" = "debug" ] && [ "${VERBOSE}" -ne 1 ]; then
        return 0
    fi

    if command -v logger > /dev/null 2>&1; then
        logger -t "${SCRIPT_NAME}" -p "${priority}" -- "${message}" || true
    fi

    if [ -t 1 ]; then
        if [ "${SILENT}" -eq 1 ] && [ "${level}" != "error" ]; then
            return 0
        fi
        if [ "${level}" = "error" ] || [ "${level}" = "warn" ]; then
            printf '%s: %s\n' "${level}" "${message}" >&2
        else
            printf '%s: %s\n' "${level}" "${message}"
        fi
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
        -o|--output)
            if [ "$#" -lt 2 ]; then
                printf '%s: option %s requires an argument\n' "${SCRIPT_NAME}" "${1}" >&2
                exit 2
            fi
            OUTPUT_DIR="${2}"
            shift 2
            ;;
        --output=*)
            OUTPUT_DIR="${1#*=}"
            shift
            ;;
        --version)
            if [ "$#" -lt 2 ]; then
                printf '%s: option %s requires an argument\n' "${SCRIPT_NAME}" "${1}" >&2
                exit 2
            fi
            VERSION="${2}"
            shift 2
            ;;
        --version=*)
            VERSION="${1#*=}"
            shift
            ;;
        -a|--arch)
            if [ "$#" -lt 2 ]; then
                printf '%s: option %s requires an argument\n' "${SCRIPT_NAME}" "${1}" >&2
                exit 2
            fi
            ARCH="${2}"
            shift 2
            ;;
        --arch=*)
            ARCH="${1#*=}"
            shift
            ;;
        --skip-build)
            SKIP_BUILD=1
            shift
            ;;
        --skip-lintian)
            SKIP_LINTIAN=1
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
            # No positional arguments are expected.
            printf '%s: unexpected argument: %s\n' "${SCRIPT_NAME}" "${1}" >&2
            usage >&2
            exit 2
            ;;
    esac
done

# Silent and verbose are mutually exclusive.
if [ "${SILENT}" -eq 1 ] && [ "${VERBOSE}" -eq 1 ]; then
    printf '%s: --silent and --verbose are mutually exclusive\n' "${SCRIPT_NAME}" >&2
    exit 2
fi

# Runs a command, letting its output through only in verbose mode. Its stderr
# is never touched: if the command fails, its own diagnostic is the most
# precise thing anyone will get, and set -e stops the build right there.
run() {
    if [ "${VERBOSE}" -eq 1 ]; then
        "$@"
    else
        "$@" > /dev/null
    fi
}

# Checks the tools this script needs and settles version and architecture.
#
# The architecture check is the important one: npm installs the native modules
# that match the machine it runs on, so a package labelled arm64 but assembled
# on amd64 would carry x86 binaries. That fails at the first database query,
# long after the install said it went fine.
check_prerequisites() {
    local tool
    for tool in node npm dpkg-deb dpkg; do
        command -v "${tool}" > /dev/null 2>&1 || die "required tool not found: ${tool}"
    done

    local host_arch
    host_arch="$(dpkg --print-architecture)"
    if [ -z "${ARCH}" ]; then
        ARCH="${host_arch}"
    elif [ "${ARCH}" != "${host_arch}" ]; then
        die "cannot build for ${ARCH} on a ${host_arch} host: the native modules would be the wrong ones. Build on the target architecture, or in a container for it - see --help."
    fi

    # Debian and node name the architectures differently, and both names are
    # needed below - the first for the package, the second to pick the right
    # prebuilt binaries out of the dependency tree.
    case "${ARCH}" in
        amd64) NODE_ARCH="x64" ;;
        arm64) NODE_ARCH="arm64" ;;
        *) die "no mapping from the Debian architecture ${ARCH} to a node architecture" ;;
    esac

    if [ -z "${VERSION}" ]; then
        VERSION="$(node -p "require('${REPO_ROOT}/package.json').version")"
    fi
    # dpkg is stricter about versions than this check, but catching the obvious
    # case here gives a message that names the option instead of a dpkg error.
    if ! printf '%s' "${VERSION}" | grep -Eq '^[0-9][A-Za-z0-9.+~-]*$'; then
        die "not a usable Debian version: ${VERSION} (has to start with a digit)"
    fi

    log debug "Repository: ${REPO_ROOT}"
    log debug "Version: ${VERSION}, architecture: ${ARCH}"
}

# Builds both workspaces. The server bundle carries the SQL migrations, which
# the migration runner reads from disk at run time - so dist/migrations has to
# be there before anything is packaged.
build_workspaces() {
    if [ "${SKIP_BUILD}" -eq 1 ]; then
        log warn "Skipping the build on request; using the existing server/dist and web/dist"
    else
        log info "Building server bundle and web client"
        run npm --prefix "${REPO_ROOT}" run build
    fi

    local required
    for required in \
        "${REPO_ROOT}/server/dist/index.js" \
        "${REPO_ROOT}/server/dist/migrate.js" \
        "${REPO_ROOT}/server/dist/fsck.js" \
        "${REPO_ROOT}/server/dist/migrations" \
        "${REPO_ROOT}/web/dist/index.html"
    do
        [ -e "${required}" ] || die "build output is missing: ${required}"
    done
}

# Installs the runtime dependencies of the server into the staging directory.
#
# Deliberately not "npm prune --omit=dev" in the repository: that would take
# the development tree of whoever runs the build apart. A separate directory
# with only the manifests and the lock file gets the same result from the same
# pinned versions, and the working tree stays untouched.
#
# The install is filtered to the server workspace. The runtime dependencies of
# the web workspace - React, the router, zxing-wasm - are bundled into the
# built client by Vite and are not needed a second time as node_modules.
install_runtime_dependencies() {
    local deps_dir="${1}"

    log info "Installing runtime dependencies"

    mkdir -p "${deps_dir}"/{shared,server,web}
    cp "${REPO_ROOT}/package.json" "${REPO_ROOT}/package-lock.json" "${REPO_ROOT}/.npmrc" "${deps_dir}/"
    cp "${REPO_ROOT}/shared/package.json" "${deps_dir}/shared/"
    cp "${REPO_ROOT}/server/package.json" "${deps_dir}/server/"
    cp "${REPO_ROOT}/web/package.json" "${deps_dir}/web/"

    run npm --prefix "${deps_dir}" ci --omit=dev \
        --workspace @product-rating/server --include-workspace-root

    # npm leaves the workspaces behind as symlinks into the source tree, which
    # does not exist on the target system. Nothing needs them there: the shared
    # workspace is bundled into the server bundle by tsup.
    rm -rf "${deps_dir}/node_modules/@product-rating"

    [ -d "${deps_dir}/node_modules" ] || die "dependency install produced no node_modules"
}

# Removes the binaries that belong to other platforms.
#
# The dependency tree of a node project holds prebuilt binaries for every
# platform the module supports: musl and glibc, x64 and arm64, sometimes
# Windows and macOS as well. This package is built for exactly one Debian
# architecture on glibc, so the rest is dead weight - it triples the size of
# the package and lintian would rightly ask what a win32 binary is doing in it.
#
# Only whole directories and prebuild files are removed, never anything the
# matching platform loads. What stays is verified afterwards by starting the
# server from this very tree.
prune_foreign_binaries() {
    local modules_dir="${1}"
    local node_arch="${NODE_ARCH}"

    log info "Removing binaries of other platforms (keeping linux-${node_arch}, glibc)"

    # better-sqlite3 ships a prebuild per platform plus the SQLite sources it
    # would need to compile one. It resolves prebuilds/<platform>-<arch>.node
    # at run time, so everything else can go.
    local sqlite_dir="${modules_dir}/better-sqlite3"
    if [ -d "${sqlite_dir}/prebuilds" ]; then
        find "${sqlite_dir}/prebuilds" -type f -name '*.node' \
            ! -name "linux-${node_arch}.node" -delete
    fi
    rm -rf "${sqlite_dir}/deps" "${sqlite_dir}/src" "${sqlite_dir}/build" \
        "${sqlite_dir}/binding.gyp"

    # sharp and argon2 put each platform in its own optional package and try
    # them in turn, so an absent one is exactly the situation the module
    # already handles. Kept: the glibc build for this architecture, plus
    # @img/colour, which is platform independent.
    local candidate
    for candidate in "${modules_dir}/@img/"* "${modules_dir}/@node-rs/"*; do
        [ -d "${candidate}" ] || continue

        case "$(basename -- "${candidate}")" in
            colour|argon2)
                continue
                ;;
            *musl*|*wasm32*|*darwin*|*win32*)
                rm -rf "${candidate}"
                ;;
            *"-${node_arch}"|*"-${node_arch}-"*)
                # The build for this architecture stays.
                ;;
            *)
                rm -rf "${candidate}"
                ;;
        esac
    done

    # npm leaves the scope directories of removed optional packages behind.
    find "${modules_dir}" -mindepth 1 -maxdepth 1 -type d -empty -delete
}

# Removes what a dependency carries for its own development.
#
# A published npm package usually contains its test suite, its benchmarks, its
# documentation and the dotfiles of its CI - none of which is loaded at run
# time, all of which ends up in the package and in every backup of it. Two of
# them are worse than dead weight: pino's index.html pulls scripts from three
# CDNs when someone opens it, and the shipped test fixtures include
# deliberately broken files.
#
# Only directories and file names that are development material by convention
# are removed. Nothing that a "require" can resolve is touched: no .js, no
# .json, no .node, and in particular no .d.ts, which is where the type
# information of drizzle-orm and zod lives.
prune_development_files() {
    local modules_dir="${1}"

    log info "Removing test suites, documentation and CI metadata of the dependencies"

    find "${modules_dir}" -type d \
        \( -name test -o -name tests -o -name __tests__ \
        -o -name benchmark -o -name benchmarks \
        -o -name integration -o -name .github -o -name .husky \
        -o -name doc -o -name docs \
        -o -name scripts -o -name tools \) \
        -prune -exec rm -rf {} +

    find "${modules_dir}" -type f \
        \( -name '*.md' -o -name '*.markdown' -o -name 'index.html' \
        -o -name '.gitattributes' -o -name '.gitignore' -o -name '.npmignore' \
        -o -name '.editorconfig' -o -name '.travis.yml' \
        -o -name '.eslintrc*' -o -name 'eslint.config.*' \
        -o -name '.prettierrc*' \) \
        -delete
}

# Makes the executable bit below node_modules agree with what the file is.
#
# npm sets it as the publisher of a module happened to have it: licence files
# and library objects arrive executable, command line helpers arrive without
# the bit. The rule applied here is the obvious one - a file that starts with a
# shebang is a program and may be executed, everything else may not.
#
# Nothing below node_modules is executed by this application in either case: it
# loads .js through require and the native modules through dlopen, which wants
# the file readable, not executable.
fix_executable_bits() {
    local modules_dir="${1}"
    local file
    local first

    while IFS= read -r -d '' file; do
        # The first two bytes, read by the shell itself. A "head" and a command
        # substitution per file would be two processes for each of some ten
        # thousand files, and a command substitution also warns about the null
        # bytes that every binary starts with.
        first=""
        IFS= read -r -n 2 first < "${file}" || true

        if [ "${first}" = '#!' ]; then
            chmod 0755 -- "${file}"
        else
            chmod a-x -- "${file}"
        fi
    done < <(find "${modules_dir}" -type f -print0)
}

# Removes the debug symbols from the prebuilt native modules.
#
# They are built with symbols by their upstreams, which costs tens of megabytes
# in a package that no one will run a debugger against - and a stack trace from
# node names the JavaScript frames, not the ones inside the addon.
#
# --strip-unneeded is the variant that is safe for a shared object: it keeps
# every symbol needed to resolve a relocation and drops the rest.
strip_binaries() {
    local modules_dir="${1}"

    if ! command -v strip > /dev/null 2>&1; then
        log warn "strip is not installed (binutils); the native modules keep their debug symbols"
        return 0
    fi

    log info "Stripping the debug symbols of the native modules"
    find "${modules_dir}" -type f \( -name '*.node' -o -name '*.so' -o -name '*.so.*' \) \
        -exec strip --strip-unneeded {} +
}

# Lays out everything that will be installed, under the paths it will have on
# the target system.
assemble_tree() {
    local tree="${1}"
    local deps_dir="${2}"
    local debian_dir="${REPO_ROOT}/packaging/debian"

    log info "Assembling the installation tree"

    # The application bundle: dependencies, the server with its migrations and
    # the built web client. server/package.json travels with the bundle because
    # it declares "type": "module" - without it node reads the .js files as
    # CommonJS and refuses the first import.
    install -d -m 0755 "${tree}${INSTALL_PREFIX}" "${tree}${INSTALL_PREFIX}/server"
    cp -a "${deps_dir}/node_modules" "${tree}${INSTALL_PREFIX}/node_modules"
    cp -a "${REPO_ROOT}/server/dist" "${tree}${INSTALL_PREFIX}/server/dist"
    install -m 0644 "${REPO_ROOT}/server/package.json" "${tree}${INSTALL_PREFIX}/server/package.json"
    cp -a "${REPO_ROOT}/web/dist" "${tree}${INSTALL_PREFIX}/web"

    # Configuration. Registered as a conffile, so an edit survives an upgrade.
    install -d -m 0755 "${tree}/etc/${PACKAGE_NAME}"
    install -m 0644 "${debian_dir}/config.package.toml" \
        "${tree}/etc/${PACKAGE_NAME}/config.toml"

    install -d -m 0755 "${tree}/etc/logrotate.d"
    install -m 0644 "${debian_dir}/${PACKAGE_NAME}.logrotate" \
        "${tree}/etc/logrotate.d/${PACKAGE_NAME}"

    # The command line front end, with the package version filled in.
    install -d -m 0755 "${tree}/usr/bin"
    sed "s|@VERSION@|${VERSION}|g" "${debian_dir}/${PACKAGE_NAME}.wrapper" \
        > "${tree}/usr/bin/${PACKAGE_NAME}"
    chmod 0755 "${tree}/usr/bin/${PACKAGE_NAME}"

    # The unit goes to /usr/lib, not to /lib: on a merged-usr system the latter
    # is a symlink, and a package must not install through one.
    install -d -m 0755 "${tree}/usr/lib/systemd/system"
    install -m 0644 "${debian_dir}/${PACKAGE_NAME}.service" \
        "${tree}/usr/lib/systemd/system/${PACKAGE_NAME}.service"

    # The findings that were looked at and deliberately left as they are. They
    # travel with the package, so a later lintian run on the installed system
    # reaches the same conclusion without anyone having to remember why.
    install -d -m 0755 "${tree}/usr/share/lintian/overrides"
    install -m 0644 "${debian_dir}/lintian-overrides" \
        "${tree}/usr/share/lintian/overrides/${PACKAGE_NAME}"

    assemble_documentation "${tree}"
}

# Documentation below /usr/share/doc, as policy requires it: the copyright
# file, the changelog compressed, and the material an administrator actually
# needs on the machine - the commented example configuration and the README.
assemble_documentation() {
    local tree="${1}"
    local doc_dir="${tree}/usr/share/doc/${PACKAGE_NAME}"
    local debian_dir="${REPO_ROOT}/packaging/debian"

    install -d -m 0755 "${doc_dir}"
    install -m 0644 "${debian_dir}/copyright" "${doc_dir}/copyright"

    # changelog.gz, not changelog.Debian.gz: this is a native package - the
    # application and its packaging are one source tree, so there is no
    # separate Debian revision and no second changelog to tell apart.
    #
    # -n keeps the timestamp out of the gzip header, so two builds of the same
    # source produce the same bytes.
    gzip -9nc "${debian_dir}/changelog" > "${doc_dir}/changelog.gz"
    chmod 0644 "${doc_dir}/changelog.gz"

    gzip -9nc "${REPO_ROOT}/README.md" > "${doc_dir}/README.md.gz"
    chmod 0644 "${doc_dir}/README.md.gz"

    install -m 0644 "${REPO_ROOT}/config/config.example.toml" \
        "${doc_dir}/config.example.toml"

    # The configurations for nginx, Apache, Caddy and friends arrive with M12.
    # Packaged as soon as they exist, so this build does not have to change
    # again for them.
    if [ -d "${REPO_ROOT}/packaging/examples" ]; then
        cp -a "${REPO_ROOT}/packaging/examples" "${doc_dir}/examples"
        log debug "Packaged the example configurations"
    else
        log debug "No packaging/examples yet (M12), skipping them"
    fi
}

# Works out which C libraries the prebuilt native modules need, so the package
# can name them instead of relying on nodejs to have pulled them in by chance.
#
# sharp's libvips brings libstdc++ and libgcc with it, which a dependency on
# nodejs alone does not guarantee. dpkg-shlibdeps answers that question from
# the binaries themselves and from the packages that own the libraries they
# link against.
SHLIBS_DEPENDS=""
resolve_library_dependencies() {
    local tree="${1}"

    if ! command -v dpkg-shlibdeps > /dev/null 2>&1; then
        log warn "dpkg-shlibdeps is not installed (dpkg-dev); the package will not name the C libraries it needs"
        return 0
    fi

    local binaries=()
    mapfile -t binaries < <(find "${tree}" -type f \
        \( -name '*.node' -o -name '*.so' -o -name '*.so.*' \) | LC_ALL=C sort)
    if [ "${#binaries[@]}" -eq 0 ]; then
        log warn "no native modules found in the tree; skipping the library check"
        return 0
    fi

    log info "Resolving the shared libraries of ${#binaries[@]} native module(s)"

    # dpkg-shlibdeps insists on running from the root of a source package and
    # reads the package name out of debian/control. There is no source package
    # here - the tree is assembled by this script - so it gets a minimal one
    # for the length of the call and nothing else.
    local work
    work="$(mktemp -d)"
    mkdir -p "${work}/debian"
    printf 'Source: %s\n\nPackage: %s\nArchitecture: %s\n' \
        "${PACKAGE_NAME}" "${PACKAGE_NAME}" "${ARCH}" > "${work}/debian/control"

    # -l adds the private directory in which sharp keeps its copy of libvips;
    # it is on no system search path, and without it every libvips symbol
    # counts as unresolved.
    # --ignore-missing-info: a node addon resolves the napi_* symbols against
    # the node binary that loads it, and node is not a shared library that dpkg
    # has any information about.
    local output=""
    if output="$(cd "${work}" && dpkg-shlibdeps -O --ignore-missing-info \
        -l"${tree}${INSTALL_PREFIX}/node_modules/@img/sharp-libvips-linux-${NODE_ARCH}/lib" \
        "${binaries[@]}" 2> "${work}/stderr")"; then
        SHLIBS_DEPENDS="${output#shlibs:Depends=}"
        log info "Library dependencies: ${SHLIBS_DEPENDS}"
        # The napi symbols above produce a warning per symbol; they are only
        # worth reading when something else went wrong with them.
        if [ "${VERBOSE}" -eq 1 ]; then
            cat "${work}/stderr" >&2
        fi
    else
        # The tool's own diagnostic is the precise one, so it is passed through
        # rather than replaced. The build continues: a package without the
        # library dependencies still installs on a machine that runs nodejs.
        log warn "dpkg-shlibdeps failed; the package will not name the C libraries it needs"
        cat "${work}/stderr" >&2
    fi

    rm -rf "${work}"
}

# Writes the DEBIAN/ directory: the metadata dpkg reads and the scripts it runs.
assemble_control() {
    local tree="${1}"
    local debian_dir="${REPO_ROOT}/packaging/debian"
    local control_dir="${tree}/DEBIAN"

    log info "Writing the package metadata"

    install -d -m 0755 "${control_dir}"

    # Installed-Size is in KiB and counts the installed files, not the control
    # information; apt shows it before it downloads anything.
    local installed_size
    installed_size="$(du -sk --exclude=DEBIAN "${tree}" | cut -f1)"

    # The library dependencies are appended to the ones the control file names
    # itself; an empty result leaves the line as it is, without a dangling
    # comma.
    local shlibs_field=""
    if [ -n "${SHLIBS_DEPENDS}" ]; then
        shlibs_field=", ${SHLIBS_DEPENDS}"
    fi

    sed -e "s|@VERSION@|${VERSION}|g" \
        -e "s|@ARCH@|${ARCH}|g" \
        -e "s|@INSTALLED_SIZE@|${installed_size}|g" \
        -e "s|@SHLIBS_DEPENDS@|${shlibs_field}|g" \
        "${debian_dir}/control" > "${control_dir}/control"
    chmod 0644 "${control_dir}/control"

    install -m 0644 "${debian_dir}/conffiles" "${control_dir}/conffiles"
    install -m 0644 "${debian_dir}/templates" "${control_dir}/templates"

    local script
    for script in config postinst prerm postrm; do
        install -m 0755 "${debian_dir}/${script}" "${control_dir}/${script}"
    done

    write_md5sums "${tree}"
}

# Writes DEBIAN/md5sums, which dpkg and debsums use to tell a modified file
# from an intact one. Conffiles are left out: dpkg tracks their checksums
# itself, and they are expected to be edited.
write_md5sums() {
    local tree="${1}"

    (
        cd "${tree}"
        # Paths are relative and without a leading ./, which is the format
        # dpkg expects.
        find . -type f ! -path './DEBIAN/*' -printf '%P\n' \
            | LC_ALL=C sort \
            | grep -v -x -F -f <(sed 's|^/||' "${REPO_ROOT}/packaging/debian/conffiles") \
            | xargs -r -d '\n' md5sum -- \
            > DEBIAN/md5sums
    )
    chmod 0644 "${tree}/DEBIAN/md5sums"
}

# Normalises the permissions of the tree.
#
# npm creates its files with the umask of whoever ran the build, so the same
# source could produce a package that is group writable on one machine and not
# on the next. Group and other write is taken away everywhere; the modes this
# script sets itself stay as they are.
normalise_permissions() {
    local tree="${1}"

    chmod -R go-w "${tree}"
    # Directories have to stay traversable for everyone, otherwise the service
    # user cannot reach its own bundle.
    find "${tree}" -type d ! -path "${tree}/DEBIAN*" -exec chmod a+rx {} +
}

# Builds the .deb. The result is handed on in PACKAGE_FILE rather than on
# stdout: inside a command substitution the log function sees no terminal and
# would swallow every message of this step.
PACKAGE_FILE=""
build_package() {
    local tree="${1}"
    PACKAGE_FILE="${OUTPUT_DIR}/${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"

    log info "Building ${PACKAGE_FILE}"

    # --root-owner-group records every file as root:root without needing
    # fakeroot; the postinst hands the data directories to the service user.
    run dpkg-deb --build --root-owner-group "${tree}" "${PACKAGE_FILE}"
}

# Checks the finished package. lintian is not a build dependency - it is not
# installed everywhere - so a missing one is reported and the build still
# counts as successful.
check_package() {
    local package_file="${1}"

    if [ "${SKIP_LINTIAN}" -eq 1 ]; then
        log debug "Skipping lintian on request"
        return 0
    fi
    if ! command -v lintian > /dev/null 2>&1; then
        log warn "lintian is not installed, skipping the check"
        return 0
    fi

    log info "Checking the package with lintian"
    # A finding must not fail the build: lintian knows a lot about packages
    # that go into Debian itself and rather less about one that is installed
    # from a file. Its output is printed either way, so nothing goes unnoticed.
    #
    # The display limit is lifted, because a truncated list is what makes a new
    # finding easy to miss; what stays hidden is only what the shipped
    # lintian-overrides file explains.
    lintian --tag-display-limit 0 "${package_file}" || true
}

main() {
    check_prerequisites

    local build_root="${OUTPUT_DIR}"
    local tree="${build_root}/${PACKAGE_NAME}_${VERSION}_${ARCH}"
    local deps_dir="${build_root}/deps"

    # A build starts from an empty tree: a file left over from an earlier run
    # would end up in the package without anything pointing at it.
    rm -rf "${tree}" "${deps_dir}"
    install -d -m 0755 "${build_root}" "${tree}"

    build_workspaces
    install_runtime_dependencies "${deps_dir}"
    prune_foreign_binaries "${deps_dir}/node_modules"
    prune_development_files "${deps_dir}/node_modules"
    fix_executable_bits "${deps_dir}/node_modules"
    strip_binaries "${deps_dir}/node_modules"
    assemble_tree "${tree}" "${deps_dir}"
    normalise_permissions "${tree}"
    # After the tree is complete, so every native module is where it will be
    # installed, and before the control file that carries the result.
    resolve_library_dependencies "${tree}"
    assemble_control "${tree}"

    build_package "${tree}"
    check_package "${PACKAGE_FILE}"

    log info "Done, $(du -h "${PACKAGE_FILE}" | cut -f1)"
    # The path on stdout even in silent mode, so a pipeline can pick it up.
    printf '%s\n' "${PACKAGE_FILE}"
}

main "$@"
