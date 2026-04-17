#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# PPlus AI Sync Tool — one-command setup.
#
#   curl -fsSL https://raw.githubusercontent.com/<OWNER>/<REPO>/main/scripts/setup.sh | bash
#   # or, after clone:
#   bash scripts/setup.sh
#
# Checks prerequisites, installs deps, and brings the dev server up.
# ──────────────────────────────────────────────────────────────────────────

BOLD=$(tput bold 2>/dev/null || echo "")
DIM=$(tput dim 2>/dev/null || echo "")
GREEN=$(tput setaf 2 2>/dev/null || echo "")
YELLOW=$(tput setaf 3 2>/dev/null || echo "")
RED=$(tput setaf 1 2>/dev/null || echo "")
RESET=$(tput sgr0 2>/dev/null || echo "")

ok()   { echo "${GREEN}✓${RESET} $*"; }
warn() { echo "${YELLOW}!${RESET} $*"; }
fail() { echo "${RED}✗${RESET} $*"; exit 1; }
step() { echo; echo "${BOLD}▸ $*${RESET}"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

step "Checking prerequisites"

# Node.js 22+
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js not found. Install Node 22+ from https://nodejs.org or via nvm."
fi
NODE_MAJOR=$(node -p "parseInt(process.versions.node.split('.')[0], 10)")
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node $NODE_MAJOR is too old — need Node 22+. Try: nvm install 22 && nvm use 22"
fi
ok "Node $(node -v)"

# pnpm 9+ via corepack
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found — enabling via corepack"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@9.15.9 --activate >/dev/null
  else
    fail "corepack not available. Install pnpm manually: npm i -g pnpm@9"
  fi
fi
ok "pnpm $(pnpm -v)"

# Claude CLI (needed at runtime, not at install time — warn only)
if command -v claude >/dev/null 2>&1; then
  ok "claude CLI found at $(command -v claude) ($(claude --version 2>&1 | head -n1))"
else
  warn "claude CLI not found on PATH. Install with: npm i -g @anthropic-ai/claude-code"
  warn "Then run \`claude\` once to sign in. The app boots without it; AI features stay disabled."
fi

step "Installing workspace dependencies"
pnpm install --prefer-offline

step "Generating database migrations (idempotent)"
pnpm --filter @pplus-sync/db exec drizzle-kit generate --name init >/dev/null || true
ok "Drizzle migrations ready at packages/db/drizzle/"

step "Preparing environment"
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  ok ".env.local created from .env.example"
else
  ok ".env.local already exists (leaving as-is)"
fi

echo
echo "${BOLD}Setup complete.${RESET}"
echo "  ${DIM}Start the app:${RESET}  ${BOLD}pnpm dev${RESET}  ${DIM}→ http://localhost:3000${RESET}"
echo "  ${DIM}Default login:${RESET} ${BOLD}admin / admin${RESET} ${DIM}(override via SEED_USER / SEED_PASSWORD)${RESET}"
echo
