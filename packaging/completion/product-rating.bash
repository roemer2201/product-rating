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
# Version: 1.0.0 (2026-10-18)
#
# Nothing here runs product-rating or reads its database: account names and
# invite codes are not offered, because looking them up on TAB would open the
# database of whatever instance the configuration points at.

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
# word. Candidates are built for the whole word, so drop the kept prefix.
# Only '=' and ':' are reassembled by the helpers; other breaks split anyway.
_product_rating_trim()
{
    local word="${1}" prefix='' i
    if [[ "${COMP_WORDBREAKS}" == *'='* && "${COMP_WORDBREAKS}" == *':'* ]]; then
        [[ "${word}" == *[=:]* ]] && prefix="${word%"${word##*[=:]}"}"
    elif [[ "${COMP_WORDBREAKS}" == *'='* ]]; then
        [[ "${word}" == *=* ]] && prefix="${word%"${word##*=}"}"
    elif [[ "${COMP_WORDBREAKS}" == *':'* ]]; then
        [[ "${word}" == *:* ]] && prefix="${word%"${word##*:}"}"
    fi
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
        server.trust_proxy|uploads.strip_exif|app.external_lookup)
            _product_rating_candidates true false ;;
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
    local filedir command_name='' subcommand='' expecting='' word full_cur
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
    full_cur="${cur}"

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

    command_name="${words[1]}"
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
        word="${words[i]}"
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
        _product_rating_trim "${full_cur}"
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
