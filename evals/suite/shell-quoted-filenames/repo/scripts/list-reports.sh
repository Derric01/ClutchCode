#!/usr/bin/env bash
# Print the name of every file in a directory, one per line.
#
# Usage: list-reports.sh [directory]
set -eu

DIR="${1:-reports}"

for f in $(ls "$DIR"); do
  echo "$f"
done
