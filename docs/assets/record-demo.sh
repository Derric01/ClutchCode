#!/bin/bash
# Regenerates docs/assets/demo.gif from a real, scripted terminal session
# against the actual compiled CLI. No fabricated output: everything shown is
# what the commands genuinely print, using `--provider fake` (the same
# no-key, no-model path the test suite uses) so this runs anywhere, offline,
# with no API key.
#
# Requires: pnpm build (run first), asciinema, agg
#   apt-get install -y asciinema
#   cargo install --git https://github.com/asciinema/agg
#
# Usage: bash docs/assets/record-demo.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="node $REPO_ROOT/apps/cli/dist/cli.js"
DEMO_REPO="$(mktemp -d)"
CAST="$(mktemp --suffix=.cast)"

cleanup() { rm -rf "$DEMO_REPO" "$CAST"; }
trap cleanup EXIT

git -C "$DEMO_REPO" init -q .
git -C "$DEMO_REPO" config user.email demo@example.com
git -C "$DEMO_REPO" config user.name demo
echo '{"name":"demo"}' > "$DEMO_REPO/package.json"
git -C "$DEMO_REPO" add -A
git -C "$DEMO_REPO" commit -qm init

cat > /tmp/clutchcode-record-demo-inner.sh <<SCRIPT
#!/bin/bash
CLI="$CLI"
cd "$DEMO_REPO"

type_cmd() {
  printf '\033[1;32m\$\033[0m '
  for ((i=0; i<\${#1}; i++)); do printf '%s' "\${1:\$i:1}"; sleep 0.025; done
  echo
  sleep 0.4
}

clear
type_cmd 'clutchcode doctor'
\$CLI doctor --repo "$DEMO_REPO"
sleep 2.2

echo
type_cmd 'clutchcode run "fix the failing parser test" --provider fake'
\$CLI run "fix the failing parser test" --provider fake --repo "$DEMO_REPO"
sleep 3
SCRIPT
chmod +x /tmp/clutchcode-record-demo-inner.sh

asciinema rec --command=/tmp/clutchcode-record-demo-inner.sh --overwrite --cols 100 --rows 24 "$CAST"
agg --font-size 16 --theme monokai --speed 1.0 "$CAST" "$REPO_ROOT/docs/assets/demo.gif"
rm -f /tmp/clutchcode-record-demo-inner.sh

echo "Wrote $REPO_ROOT/docs/assets/demo.gif"
