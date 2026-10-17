# shellcheck shell=bash
# Name: product-rating.bash
# Purpose: Bash completion for the product-rating command line interface.
#          Completes commands, the subcommands of "user" and "invite", the
#          options of every command, the configuration flags they all share
#          and the values that have a known set or are paths.
# Usage: installed by the Debian package as
#          /usr/share/bash-completion/completions/product-rating
#        and loaded on the first TAB by bash-completion. By hand:
#          source packaging/completion/product-rating.bash
#        after bash-completion itself has been loaded.
# CLI: product-rating COMMAND [OPTIONS] [ARGUMENTS]
#      product-rating help [COMMAND] | version
#      The command has to come first; options are accepted anywhere after it,
#      with the value as the next word or after '=', until a standalone '--'.
#      Source of truth: server/src/cli/ and server/src/config/cli.ts.
#      server/src/cli/completion.test.ts fails when the lists below drift
#      away from them.
# Program flow:
#   1. Initialize the library context and decode the current shell word.
#   2. Parse the command and completed arguments without running the CLI.
#   3. Offer candidates and remove only the prefix Readline keeps in place.
# Version: 1.0.1 (2026-10-18)
#
# Nothing here runs product-rating or reads its database: account names and
# invite codes are not offered, because looking them up on TAB would open the
# database of whatever instance the configuration points at.

# Remove shell quotes and escapes without evaluating any input. Also return
# the literal prefix before the last unquoted, unescaped '=' or ':' which
# Readline keeps. Those are the only word breaks reassembled by our helpers;
# quoted/escaped breaks belong to the filename and must not trim candidates.
_product_rating_word()
{
    local input="${1}" decoded='' kept='' quote='' char next i
    for ((i = 0; i < ${#input}; i++)); do
        char="${input:i:1}"
        if [[ "${quote}" == "'" ]]; then
            if [[ "${char}" == "'" ]]; then
                quote=''
            else
                decoded+="${char}"
            fi
        elif [[ "${char}" == "\\" ]]; then
            next="${input:i+1:1}"
            # Inside double quotes a backslash only protects these characters.
            if [[ -n "${next}" ]] &&
                [[ -z "${quote}" || "${next}" == [\$\`\"\\] || "${next}" == $'\n' ]]; then
                ((i += 1))
                [[ "${next}" == $'\n' ]] || decoded+="${next}"
            else
                decoded+="${char}"
            fi
        elif [[ -n "${quote}" ]]; then
            if [[ "${char}" == "${quote}" ]]; then
                quote=''
            else
                decoded+="${char}"
            fi
        elif [[ "${char}" == "'" || "${char}" == '"' ]]; then
            quote="${char}"
        else
            decoded+="${char}"
            if [[ "${char}" == [=:] && "${COMP_WORDBREAKS}" == *"${char}"* ]]; then
                kept="${decoded}"
            fi
        fi
    done
    printf -v "${2}" '%s' "${decoded}"
    if (($# > 2)); then
        printf -v "${3}" '%s' "${kept}"
    fi
}

# Append literal candidates matching the current prefix, preserving spaces.
_product_rating_candidates()
{
    local candidate
    for candidate in "${@}"; do
        if [[ "${candidate}" == "${cur}"* ]]; then
            COMPREPLY+=("${candidate}")
        fi
    done
}

# Succeed when the first argument equals one of the others.
_product_rating_member()
{
    local wanted="${1}" entry
    shift
    for entry in "${@}"; do
        [[ "${entry}" == "${wanted}" ]] && return 0
    done
    return 1
}

# Readline replaces only the text after the last word break in the current
# word. Candidates are built for the whole word, so drop the literal prefix
# recorded before decoding quotes and escapes, rather than guessing from the
# last ':' or '=' (which may be protected by those quotes or escapes).
_product_rating_trim()
{
    local prefix="${1}" i
    [[ -n "${prefix}" ]] || return 0
    for i in "${!COMPREPLY[@]}"; do
        COMPREPLY[i]="${COMPREPLY[i]#"${prefix}"}"
    done
}

# Fill the caller's "flags" (no value) and "valued" (value required) arrays
# with the options of one command, configuration flags included. An option of
# the command itself wins over a configuration flag of the same name, as in
# server/src/cli/options.ts: "fsck --uploads" is a check, not a path.
_product_rating_options()
{
    local option
    flags=(--help -h)
    valued=()
    case "${1}" in
        serve|migrate) ;;
        user)
            flags+=(--password-stdin)
            valued+=(--role --email --display-name --ttl-hours)
            ;;
        invite) valued+=(--as --note --ttl) ;;
        backup) valued+=(--to --keep-days) ;;
        restore)
            flags+=(--yes)
            valued+=(--from)
            ;;
        export)
            flags+=(--no-users --with-photos --include-trash)
            valued+=(--to --format)
            ;;
        import)
            flags+=(--update --skip-users --dry-run)
            valued+=(--from --owner)
            ;;
        fsck) flags+=(--uploads --repair) ;;
        proxy-config)
            flags+=(--no-redirect --force)
            valued+=(--server --domain --base-path --cert --key --upstream
                --max-body --out)
            ;;
    esac
    for option in "${config_options[@]}"; do
        _product_rating_member "${option}" "${flags[@]}" && continue
        _product_rating_member "${option}" "${valued[@]}" && continue
        valued+=("${option}")
    done
}

# Complete the value of "--set": first the key, then what the key takes.
# Uses the caller's cur and filedir; the result is relative to the value.
_product_rating_set_value()
{
    local key value candidate
    # Keys of server/src/config/schema.ts.
    local -a config_keys=(server.host server.port server.base_url
        server.trust_proxy server.trusted_origins server.static_dir
        paths.database paths.uploads paths.temp
        uploads.max_file_size_mb uploads.allowed_mime uploads.thumbnail_px
        uploads.detail_px uploads.strip_exif
        auth.secret_file auth.session_ttl_days auth.session_renew_threshold_days
        auth.invite_ttl_days auth.password_reset_ttl_hours
        auth.login_rate_limit_per_minute auth.argon2_memory_mib
        auth.argon2_time_cost auth.argon2_parallelism auth.min_password_length
        log.level log.format log.destination log.file
        app.title app.external_lookup app.trash_retention_days app.currency)
    if [[ "${cur}" != *=* ]]; then
        for candidate in "${config_keys[@]}"; do
            [[ "${candidate}=" == "${cur}"* ]] && COMPREPLY+=("${candidate}=")
        done
        # The key is only half of the value; let the user type on after '='.
        ((${#COMPREPLY[@]} == 0)) || compopt -o nospace 2>/dev/null
        return 0
    fi

    key="${cur%%=*}"
    value="${cur#*=}"
    cur="${value}"
    case "${key}" in
        log.level) _product_rating_candidates error warn info debug ;;
        log.format) _product_rating_candidates json pretty ;;
        log.destination) _product_rating_candidates stdout file syslog ;;
        server.trust_proxy|uploads.strip_exif)
            _product_rating_candidates true false ;;
        # The schema reserves this key but rejects enabling it until an
        # external lookup implementation exists.
        app.external_lookup) _product_rating_candidates false ;;
        paths.database|auth.secret_file|log.file) "${filedir}" ;;
        paths.uploads|paths.temp|server.static_dir) "${filedir}" -d ;;
        *) ;;
    esac
    for candidate in "${!COMPREPLY[@]}"; do
        COMPREPLY[candidate]="${key}=${COMPREPLY[candidate]}"
    done
    cur="${key}=${value}"
}

# Complete the value of one option of one command.
_product_rating_value()
{
    local command_name="${1}" option="${2}"
    case "${option}" in
        --set) _product_rating_set_value ;;
        --config|--database|--cert|--key|--out) "${filedir}" ;;
        --uploads|--temp|--to) "${filedir}" -d ;;
        # restore wants a snapshot directory, import a directory or the
        # export file itself.
        --from)
            if [[ "${command_name}" == import ]]; then
                "${filedir}"
            else
                "${filedir}" -d
            fi
            ;;
        --log-level) _product_rating_candidates error warn info debug ;;
        --log-format) _product_rating_candidates json pretty ;;
        --log-destination) _product_rating_candidates stdout file syslog ;;
        --role) _product_rating_candidates user admin ;;
        --format) _product_rating_candidates json csv both ;;
        --server)
            _product_rating_candidates nginx apache apache2 httpd caddy traefik
            ;;
        # Free text, numbers and addresses: nothing sensible to offer.
        *) ;;
    esac
}

# Parse completed arguments, then complete a value or the current CLI context.
_product_rating()
{
    # Library helpers populate these locals through Bash's dynamic scoping.
    # shellcheck disable=SC2034
    local cur prev words cword comp_args
    local filedir command_name='' subcommand='' expecting='' word trim_prefix=''
    local end_options=0 positional_count=0 equal_value=0 offer_options=0 i
    local -a flags=() valued=()
    # Commands in the order of "product-rating help". The helpers below see
    # these lists through dynamic scoping; nothing is left in the shell.
    local -a commands=(serve migrate user invite backup restore export import
        fsck proxy-config)
    # Flags every command hands on to the configuration loader; all take a
    # value.
    local -a config_options=(--config --set --host --port --base-url
        --database --uploads --temp --log-level --log-format --log-destination)
    COMPREPLY=()

    # Reassemble words split at '=' and ':'; '=' is split below only in an
    # option context, ':' stays part of file names such as 'db-12:00.sql'.
    if declare -F _comp_initialize >/dev/null &&
        declare -F _comp_compgen_filedir >/dev/null; then
        _comp_initialize -n =: -- "${@}" || return 0
        filedir=_comp_compgen_filedir
    elif declare -F _init_completion >/dev/null &&
        declare -F _filedir >/dev/null; then
        _init_completion -n =: || return 0
        filedir=_filedir
    else
        return 0
    fi
    _product_rating_word "${cur}" cur trim_prefix

    # The command is always the first word (server/src/cli/index.ts).
    if ((cword == 1)); then
        if [[ "${cur}" == -* ]]; then
            _product_rating_candidates --help -h --version -V
        else
            _product_rating_candidates "${commands[@]}" \
                help version
        fi
        return 0
    fi

    _product_rating_word "${words[1]}" command_name
    case "${command_name}" in
        help|--help|-h)
            # Only the first argument is read, as the name of a command.
            if ((cword == 2)); then
                _product_rating_candidates "${commands[@]}"
            fi
            return 0
            ;;
    esac
    _product_rating_member "${command_name}" \
        "${commands[@]}" || return 0
    _product_rating_options "${command_name}"

    # Consume option values so they cannot be mistaken for a subcommand.
    for ((i = 2; i < cword; i++)); do
        _product_rating_word "${words[i]}" word
        if [[ -n "${expecting}" ]]; then
            expecting=''
            continue
        fi
        if ((end_options == 0)) && [[ "${word}" == -?* ]]; then
            if [[ "${word}" == -- ]]; then
                end_options=1
                continue
            fi
            # The command prints its help and ignores everything else.
            [[ "${word}" == --help || "${word}" == -h ]] && return 0
            if _product_rating_member "${word}" "${flags[@]}"; then
                continue
            fi
            if _product_rating_member "${word}" "${valued[@]}"; then
                expecting="${word}"
                continue
            fi
            if [[ "${word}" == *=* ]] &&
                _product_rating_member "${word%%=*}" "${valued[@]}"; then
                continue
            fi
            # Unknown option or a flag with '=': the command would refuse it.
            return 0
        fi
        if ((positional_count == 0)); then
            subcommand="${word}"
        fi
        ((positional_count += 1))
    done

    # Split the current --option=value only in an option context, not after '--'
    # and not while another option is waiting for its separate argument.
    if ((end_options == 0)) && [[ -z "${expecting}" && "${cur}" == --*=* ]]; then
        expecting="${cur%%=*}"
        _product_rating_member "${expecting}" "${valued[@]}" || return 0
        cur="${cur#*=}"
        equal_value=1
    fi

    # Required values take precedence over options, even if they start with '-'.
    if [[ -n "${expecting}" ]]; then
        _product_rating_value "${command_name}" "${expecting}"
        # Rebuild whole-word candidates so one trim rule fits every break set.
        if ((equal_value)); then
            for i in "${!COMPREPLY[@]}"; do
                COMPREPLY[i]="${expecting}=${COMPREPLY[i]}"
            done
        fi
        _product_rating_trim "${trim_prefix}"
        return 0
    fi

    # Show option names only where the command still accepts options.
    if ((end_options == 0)) && [[ "${cur}" == -* ]]; then
        _product_rating_candidates "${flags[@]}" "${valued[@]}"
        return 0
    fi

    # Positional arguments: the subcommands of "user" and "invite". Their own
    # arguments are account names, invite codes and free text.
    case "${command_name}" in
        user)
            if ((positional_count == 0)); then
                _product_rating_candidates add list disable enable passwd \
                    reset-link lock display-name
            elif [[ "${subcommand}" == list ]] ||
                [[ "${subcommand}" != display-name && positional_count -ge 2 ]]; then
                offer_options=1
            fi
            ;;
        invite)
            if ((positional_count == 0)); then
                _product_rating_candidates create list revoke
            elif [[ "${subcommand}" == create || "${subcommand}" == list ]] ||
                ((positional_count >= 2)); then
                offer_options=1
            fi
            ;;
        *) offer_options=1 ;;
    esac

    # A command that expects no further argument here gets its options on a
    # bare TAB, so "product-rating backup <TAB>" shows what it takes.
    if ((offer_options && end_options == 0)) && [[ -z "${cur}" ]]; then
        _product_rating_candidates "${flags[@]}" "${valued[@]}"
    fi
    return 0
}

complete -F _product_rating product-rating
