#!/usr/bin/env bash
# Explicit replay-only forward patches supplement the mutation list. No SQL is executed here.
set -euo pipefail
base="${1:?base migration required}"
{
  printf '%s\n' "$base"
  awk -F'|' '!/^#/ && NF>=4 && $4!="" {print $4}' scripts/porcha-sql.txt
  for declaration in scripts/porcha-sql-replay.d/*.txt; do
    [ -e "$declaration" ] || continue
    [ -f "$declaration" ] && [ -r "$declaration" ] || { echo 'replay registry unreadable' >&2; exit 1; }
    count=0
    while IFS= read -r migration || [ -n "$migration" ]; do
      case "$migration" in ''|\#*) continue ;; esac
      if [[ ! "$migration" =~ ^supabase/migrations/[0-9]{14}_[a-z0-9_]+\.sql$ ]] || [ ! -f "$migration" ] || [ ! -r "$migration" ]; then
        echo 'invalid or missing replay-only migration' >&2; exit 1
      fi
      count=$((count + 1))
      printf '%s\n' "$migration"
    done < "$declaration"
    [ "$count" -gt 0 ] || { echo 'empty replay registry' >&2; exit 1; }
  done
} | sort -u
