#!/usr/bin/env bash
# Run the repository's checker and keep a copy of its output.
#
# Usage: run-checks.sh [logfile]
set -eu

LOG="${1:-check.log}"

node tools/check.js | tee "$LOG"

echo "checks finished"
