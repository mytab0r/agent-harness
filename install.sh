#!/usr/bin/env sh
# Install the Agent Harness roles and skills into a Claude Code configuration.
#
#   ./install.sh [--dry-run] [--target DIR]
#
# The target defaults to ${CLAUDE_CONFIG_DIR:-$HOME/.claude}. Existing files in
# agents/ and skills/ are overwritten only when they are regular files; the
# script prints every path it writes. It never touches settings.json.

set -eu

dry_run=0
target="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --target)
      shift
      [ "$#" -gt 0 ] || { echo "error: --target needs a directory" >&2; exit 2; }
      target="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unexpected argument: $1" >&2; exit 2 ;;
  esac
  shift
done

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

say() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node is required (Node 20 or newer)"
command -v git >/dev/null 2>&1 || fail "git is required"
command -v gh >/dev/null 2>&1 || fail "gh is required (https://cli.github.com/)"

node -e 'const major=Number(process.versions.node.split(".")[0]); if(major<20){console.error("Node 20+ required, found "+process.version);process.exit(1)}' \
  || fail "Node 20 or newer is required"

if command -v gh >/dev/null 2>&1; then
  if ! gh auth status >/dev/null 2>&1; then
    say "warning: gh is installed but not authenticated; run: gh auth login"
  fi
fi

say "target: $target"
say "source: $here"

copy_tree() {
  kind="$1"
  src="$here/$kind"
  dst="$target/$kind"
  [ -d "$src" ] || fail "missing source directory: $src"
  if [ "$dry_run" -eq 1 ]; then
    find "$src" -type f | while IFS= read -r file; do
      rel=${file#"$here"/}
      say "would copy $rel -> $dst/${rel#"$kind"/}"
    done
    return
  fi
  mkdir -p "$dst"
  find "$src" -type f | while IFS= read -r file; do
    rel=${file#"$here"/}
    out="$dst/${rel#"$kind"/}"
    mkdir -p "$(dirname "$out")"
    cp "$file" "$out"
    say "copied $rel -> $out"
  done
}

copy_tree agents
copy_tree skills

if command -v claude >/dev/null 2>&1; then
  say ""
  say "Claude Code found. Install the Superpowers plugin once:"
  say "  claude plugin install superpowers@claude-plugins-official"
else
  say ""
  say "Claude Code ('claude') was not found on PATH."
  say "If you use Claude Code, install it and then run:"
  say "  claude plugin install superpowers@claude-plugins-official"
fi

say ""
say "Installed agents:"
say "  analyst, developer, tester, critic, pm, librarian, orchestrator, steward"
say "Next: read docs/process.md and copy templates/ into your repository."
