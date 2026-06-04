#!/usr/bin/env bash

# Fails the build if any source file in apps/console/{app,components,hooks,lib}
# uses an arbitrary design value where a named token exists. See DESIGN.md.
#
# Carve-outs: arbitrary text- literals containing clamp(), calc(), or var()
# for fluid sizes; bg-accent/N opacity syntax (accent is a token).

set -euo pipefail

cd "$(dirname "$0")/.."

ROOTS=(app components hooks lib)
EXTS='-e .ts -e .tsx'

# shellcheck disable=SC2207
files=($(find "${ROOTS[@]}" -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null))

if [ ${#files[@]} -eq 0 ]; then
  exit 0
fi

# Forbidden patterns.
hits=$(grep -nE \
  -e 'text-\[[0-9]+(\.[0-9]+)?px\]' \
  -e 'rounded-\[[0-9]+(\.[0-9]+)?px\]' \
  -e 'bg-\[#[0-9A-Fa-f]+\]' \
  -e 'text-\[#[0-9A-Fa-f]+\]' \
  -e 'border-\[#[0-9A-Fa-f]+\]' \
  -e 'bg-\[rgba?\([^)]*\)\]' \
  -e '(bg|text|border|ring|fill|stroke)-(gray|slate|zinc|neutral|stone|blue|red|green|yellow|orange|pink|purple|indigo|emerald|teal|cyan|sky|violet|fuchsia|rose|amber|lime)-[0-9]' \
  "${files[@]}" 2>/dev/null || true)

# Strip carve-outs.
violations=$(printf '%s\n' "$hits" \
  | grep -vE 'text-\[(clamp|calc|var)' \
  || true)

if [ -n "$violations" ]; then
  echo "check-design-tokens: forbidden arbitrary design values found (see DESIGN.md):"
  echo "$violations"
  exit 1
fi
