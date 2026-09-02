#!/usr/bin/env bash
# Print the ERROR lines of a log file.
#
# Usage: tail-errors.sh [logfile]
set -euo pipefail

FILE="${1:-logs/app.log}"
if [ ! -f "$FILE" ]; then
  echo "usage: tail-errors.sh <logfile>" >&2
  exit 2
fi

while read -r timestamp level rest || [ -n "${timestamp:-}" ]; do
  if [ "${level:-}" = "ERROR" ]; then
    echo "$timestamp $level $rest"
  fi
done < "$FILE"
