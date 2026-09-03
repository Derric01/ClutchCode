#!/usr/bin/env bash
# Run the repository's checker and keep a copy of its output.
#
# Usage: run-checks.sh [logfile]
#
# `pipefail` is the fix: without it a pipeline's exit status is its LAST
# command's, so `node tools/check.js | tee "$LOG"` reported tee's success
# and `set -e` never fired.
set -euo pipefail

LOG="${1:-check.log}"

node tools/check.js | tee "$LOG"

echo "checks finished"
