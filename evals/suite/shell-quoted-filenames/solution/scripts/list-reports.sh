#!/usr/bin/env bash
# Print the name of every file in a directory, one per line.
#
# Usage: list-reports.sh [directory]
#
# A glob, not `$(ls)`: command substitution is word-split on $IFS, so a
# filename containing a space became two loop iterations. `"$DIR"/*`
# expands to one word per entry however it is spelled.
set -euo pipefail

DIR="${1:-reports}"

shopt -s nullglob
for path in "$DIR"/*; do
  echo "${path##*/}"
done
