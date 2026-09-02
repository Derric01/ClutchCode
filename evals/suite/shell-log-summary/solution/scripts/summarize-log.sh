#!/usr/bin/env bash
# Count log lines by level.
#
# Usage: summarize-log.sh <logfile>
#
# The level is the SECOND whitespace-separated field, never a substring
# match on the whole line — an INFO line whose message mentions the word
# ERROR is an INFO line.
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "usage: summarize-log.sh <logfile>" >&2
  exit 2
fi

errors=0
warns=0
infos=0

while read -r timestamp level rest || [ -n "${timestamp:-}" ]; do
  case "${level:-}" in
    ERROR) errors=$((errors + 1)) ;;
    WARN) warns=$((warns + 1)) ;;
    INFO) infos=$((infos + 1)) ;;
  esac
done < "$FILE"

echo "ERROR $errors"
echo "WARN $warns"
echo "INFO $infos"
echo "TOTAL $((errors + warns + infos))"
