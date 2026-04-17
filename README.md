# PPlus AI Sync Tool

Standalone, AI-assisted configuration sync across PPlus instances — dev ↔ stage ↔ prod, or any custom target fan-out.

Built because the previous `ConfigurationDiffTool` (in `MasterteamSA/pplus4-backend`) **didn't copy all configuration** (Dashboards, ChartComponents, Level.Sources were captured but never synced) and **didn't map renamed keys correctly** (naive `string.Replace`, formula rewriting commented out). This rebuild fixes both, adds a proper preview + audit + rollback, and uses Claude to handle semantic entity matching and formula rewriting.

## What's in this repo

```
apps/web/               Next.js 15 app (UI + API routes)
packages/core/          Domain types, matchers, pipeline contracts
packages/connectors/    PPlusConnector interface + RestConnector (HTTP)
packages/ai/            Anthropic client, tool schemas, prompts
packages/formula/       Deterministic {{Key}} parser + rewriter
packages/db/            Drizzle schema, migrations, AES-256-GCM cred store
packages/shared/        Zod schemas + entity-kind presets shared server/client
```

## Current status

Scaffolding pass 1 is done:

- Types / matchers / formula parser are implemented and unit-tested (`pnpm --filter @pplus-sync/formula test`).
- `RestConnector` wires up endpoints, retries, and auth (cookie / bearer / basic).
- `AiClient` wraps the Anthropic SDK with prompt-cached catalogs and the `proposeMapping` / `rewriteFormula` / `classifyRisk` / streamed `explainDiff` tools.
- Drizzle schema covers `runs`, `target_runs`, `snapshots`, `mapping_decisions`, `sync_plans`, `audit_entries`, `applied_ops`, `env_credentials`, `users`.
- Next.js app boots with `/connect` (source + N targets, with Test connection), plus stub pages for `/snapshot`, `/match`, `/diff`, `/apply`, `/history`.

Not yet implemented (next pass):

- Pipeline stage execution (capture / match / diff / plan / apply / rollback)
- Auth (NextAuth operator login) and encrypted credential persistence
- Per-target diff viewer, mapping editor, apply-with-nonce confirm flow

The approved plan is at `~/.claude/plans/curried-inventing-tulip.md`.

## Getting started

Prereqs: **Node 22+**, **pnpm 9+**, and either Docker (for the bundled Postgres) or any reachable Postgres 16.

```bash
# install
pnpm install

# env
cp .env.example .env.local
# then fill in ANTHROPIC_API_KEY, PPLUS_SYNC_MASTER_KEY, AUTH_SECRET
# (commands to generate the last two are in .env.example)

# database (optional for scaffolding smoke-test)
docker compose up -d postgres
pnpm --filter @pplus-sync/db generate
pnpm db:migrate
pnpm db:seed

# run
pnpm dev       # http://localhost:3000
```

If you don't have Docker, point `DATABASE_URL` at any Postgres; the rest of the tool is unchanged.

## Design decisions

- **API-first** — the connector hits PPlus REST endpoints, not the database. Safer (goes through app-layer validation) and works against any deployed instance. A `DbConnector` stub exists for entities the REST API can't round-trip; drivers ship as optional peer deps per install.
- **Formula rewriting is deterministic** — a tiny AST parser handles the `{{Key}}` grammar. Claude's `rewriteFormula` is the fallback only when the parser fails or the formula is embedded JS. Every rewrite is re-parsed and rejected if it introduces an unknown key.
- **Nothing writes without explicit confirmation** — `/apply` requires typing `APPLY <targetHost>` and is gated by a 60 s server nonce.
- **Credentials stay server-side** — AES-256-GCM in Postgres; UI only ever sees `****`.
- **Scope is per-run** — check-box matrix of entity kinds with presets (`Schema only`, `Schema + Dashboards`, `Everything`). Dashboards default to off.
- **Multi-target fan-out** — one source, many targets. Each target is its own sub-run with independent match / diff / plan / apply / rollback state.

## License

Private. Internal MasterteamSA tooling.
