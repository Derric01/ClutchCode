#!/usr/bin/env bash
# fetch-references.sh — re-pin the reference repos ClutchCode studies + the Codex
# fork base, at the exact SHAs recorded in research/00_METHOD.md.
#
# They are cloned OUTSIDE the ClutchCode git tree (default: ../clutchcode-references)
# so no third-party source ever enters our history. Study these; do not copy source
# or prompt text (see LICENSE_AND_REUSE_ANALYSIS.md). Codex is the FORK BASE (M0);
# the rest are studied and reimplemented independently.
#
# Usage: bash scripts/fetch-references.sh [dest-dir]
set -euo pipefail

DEST="${1:-../clutchcode-references}"
mkdir -p "$DEST"

clone() { # url sha dir
  local url="$1" sha="$2" dir="$3"
  if [ -d "$DEST/$dir/.git" ]; then
    echo "exists : $dir (skipping)"; return
  fi
  echo "clone  : $dir"
  git clone --quiet "$url" "$DEST/$dir"
  git -C "$DEST/$dir" checkout --quiet "$sha"
  echo "pinned : $dir @ $(git -C "$DEST/$dir" rev-parse --short HEAD)"
}

# --- Fork base (M0) ---
clone https://github.com/openai/codex.git           7093e8c480715667a5a75b602fd8c9ca2cad1780 codex

# --- Studied (ideas reimplemented independently; credited in docs/PRIOR_ART.md) ---
clone https://github.com/Aider-AI/aider.git         5dc9490 aider
clone https://github.com/cline/cline.git            a56af4e cline
clone https://github.com/All-Hands-AI/OpenHands.git 2e7136c openhands
clone https://github.com/block/goose.git            88709b2 goose
clone https://github.com/continuedev/continue.git   5522c6f continue
clone https://github.com/SWE-agent/SWE-agent.git    3ea751c swe-agent

echo
echo "Done. References in: $DEST"
echo "Keep this directory OUTSIDE the ClutchCode git tree (it is not tracked)."
echo "See research/00_METHOD.md for the full provenance and research/repos/*.md for the notes."
