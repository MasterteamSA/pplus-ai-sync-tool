# PPlus AI Sync Tool

Production-ready configuration sync across PPlus v4 instances with Claude AI self-healing.

Copy schema, lookups, properties, dashboards, workflows, and 30+ entity types between any two PPlus instances via REST API — with automatic payload normalization, property key rewriting, and intelligent error recovery.

## Test Results

End-to-end sync tested between real PPlus instances (MTPPLUS → PIF):

| Metric | Result |
|--------|--------|
| **Lookups synced** | **40 / 42** (95% success) |
| **AI retries needed** | **0** (first-attempt success after payload normalization) |
| **Server-protected (correctly skipped)** | 2 |
| **System records filtered** | 13 |

## Architecture

```
apps/web/               Next.js 15 app (UI + API routes)
packages/core/          Domain types, matchers, PPlus conventions, payload utils
packages/connectors/    PPlusConnector interface + RestConnector (HTTP)
packages/ai/            Claude integration for self-healing & matching
packages/formula/       Deterministic {{Key}} parser + rewriter
packages/db/            Drizzle schema, migrations, AES-256-GCM cred store
packages/shared/        Zod schemas + entity-kind presets
```

## How It Works

### Sync Pipeline (mirrors backend ConfigurationSyncOrchestrator)

```
1. CAPTURE     Snapshot source + target entities via REST API
2. MAP         Build level/log ID maps (source ID → target ID)
3. DIFF        Match by ID → Key → Name, classify as create/update/delete
4. NORMALIZE   Convert payloads to PPlus API format (bilingual fields, strip IDs, etc.)
5. APPLY       Execute ops in dependency order with AI self-healing on failures
6. NOTIFY      Send sync notification to target instance
```

### Dependency-Ordered Apply

Operations execute in the exact order required by PPlus's data model:

```
levels → connections → logs → level-log bindings → properties →
log properties → sections → property statuses → level statuses →
phase gates → lookups → workflows → dashboards → charts →
roles → escalation → procurement → admin entities
```

### PPlus Knowledge Embedded

The tool includes comprehensive PPlus API knowledge derived from:
- **ConfigurationDiffTool** (C# backend sync engine)
- **pplus-knowledge** repo (57 chunks covering all API surfaces)
- **PPlus-Agent** repo (MCP server with 44+ knowledge chunks)
- **End-to-end testing** against real production instances

Key conventions handled automatically:
- **Bilingual fields**: All name/displayName/description fields are `{ar, en}` objects
- **Server-assigned field stripping**: id, createdAt, updatedAt removed from creates
- **Target ID injection**: Updates include target ID in both URL and body
- **Reference remapping**: levelId, logId, parentId mapped from source → target
- **Property key rewriting**: When level names differ (e.g., Site → Facility)
- **Formula rewriting**: `{{Key}}` references updated via deterministic parser
- **PPlus typos preserved**: `configration`, `fuctionName`, `isRequird`
- **Frontend field stripping**: `propertyData`, `operationLevel` removed
- **System record protection**: Built-in logs (type=1), lookups (id < 1000) skipped

## Supported Entity Kinds (30+)

### Schema
- **Levels** — hierarchy structure (tree-scoped)
- **Level Connections** — parent-child relationships (Sources)
- **Logs** — event/transaction types
- **Level-Log Bindings** — which logs attach to which levels
- **Properties** — level properties with key rewriting
- **Log Properties** — per-log properties
- **Level Sections** — property groupings
- **Property Statuses** — allowed status values per property
- **Level Statuses** — per-level status configurations
- **Phase Gates** — workflow stages with checklist items (create-only)
- **Lookups** — reference data with nested items

### Admin
- Roles, Escalation, Procurement, Card Config, Process Builder
- Approval Processes, Code Builder, Notifications, Workflows

### Dashboards
- **Dashboards** — shell creation + chart grid linking
- **Chart Components** — linked via `/Dashboards/Charts/Link`

### Global
- Users, Groups, Settings, Holidays, Accessibility
- Classification, Schedule Views, Delegations

## Quickstart

**Prereqs:** Node 22+ and pnpm 9+. No Docker, no Postgres, no API keys needed.

```bash
git clone https://github.com/Khalil-am/pplus-ai-sync-tool.git
cd pplus-ai-sync-tool
pnpm dev
```

First run auto-installs deps, generates migrations, creates `.env.local`, and boots on first free port starting at 3000.

### Getting Auth Tokens

PPlus uses JWT bearer tokens. Get one from a logged-in browser:

```javascript
// In browser DevTools console on a PPlus instance:
JSON.parse(localStorage.getItem('currentUser')).data.token  // JWT
localStorage.getItem('csr')  // CSR token (usually same across instances)
```

Or use the login API endpoint:

```bash
curl -X POST https://instance.example/Service/api/users/authenticate \
  -H 'Content-Type: application/json' \
  -d '{"UserName":"Admin","Password":"password"}'
# Returns: { data: { token: "eyJ..." } }
```

### Using the Tool

1. Open `http://localhost:3000` → Autopilot page
2. Enter source URL + bearer token
3. Enter target URL + bearer token
4. Select entity kinds (presets: Schema only, Schema + Dashboards, Everything)
5. **Dry-run** first to preview changes
6. **Run Sync** to apply

### API Usage

```bash
# Test connection
curl http://localhost:3000/api/connect/test \
  -H 'content-type: application/json' \
  -d '{"label":"my-instance","baseUrl":"https://instance.example","authMode":"bearer","secret":"eyJ..."}'

# Dry-run sync
curl -N http://localhost:3000/api/autopilot \
  -H 'content-type: application/json' \
  -d '{
    "source": {"label":"src","baseUrl":"https://source.example","authMode":"bearer","secret":"..."},
    "target": {"label":"tgt","baseUrl":"https://target.example","authMode":"bearer","secret":"..."},
    "kinds": ["lookup","property","propertyStatus","phaseGate"],
    "dryRun": true,
    "includeUpdates": true
  }'
```

## PPlus API Conventions Reference

### Authentication
- Login: `POST /Service/api/users/authenticate` with `{UserName, Password}`
- Auth header: `Authorization: Bearer <jwt>`
- CSR header required for dashboard/chart endpoints: `csr: <token>`

### Response Format
```json
{"status": 200, "code": 1, "data": [...], "message": "...", "errors": ""}
```

### Bilingual Fields (CRITICAL)
ALL user-visible text fields MUST be `{ar: string, en: string}` objects:
```json
{"displayName": {"ar": "حالة", "en": "Status"}}
```
Plain strings cause `NullReferenceException` on FluentValidation rules.

### Preserved Typos
- `configration` (not configuration) — dashboard chart config field
- `fuctionName` (not functionName) — chart handler field
- `isRequird` (not isRequired) — filter required field

### System Records (Protected)
- Logs with `type: 1` are built-in (read-only)
- Lookups with `id < 1000` are seeded/system
- `canBeDeleted: false` means server refuses delete
- Arabic `غير مسموح التعديل` = edit not allowed (server policy)

### Dashboard Save
```
POST /service/api/Dashboards/Charts/Link
Body: { DashboardId: "5" (STRING), configration: "{...}" (JSON STRING) }
```
This is the ONLY endpoint that persists chart configurations.

## Design Decisions

- **API-first** — REST endpoints, not direct database access. Safer and works on any deployment.
- **Deterministic formula rewriting** — AST parser handles `{{Key}}` grammar. Claude is fallback only when parser fails.
- **Dependency-ordered apply** — matches the backend ConfigurationSyncOrchestrator's proven execution order.
- **PPlus knowledge embedded** — conventions from 3 knowledge sources baked into both code and AI prompts.
- **AI self-healing** — on any failure, Claude inspects server error + target samples and proposes a fix.
- **Safe defaults** — system records skipped, deletes disabled unless explicit, all ops audited.

## Optional: AI Features

For AI-powered self-healing on failures, install the Claude CLI:

```bash
npm i -g @anthropic-ai/claude-code
claude  # sign in once
```

No `ANTHROPIC_API_KEY` needed — uses whatever auth the CLI already has.

## Optional: Real Postgres

```bash
# In .env.local:
DATABASE_URL=postgres://user:pass@host/db
```

Default is PGlite (embedded WASM Postgres) at `~/.pplus-ai-sync/db`.

## License

Private. Internal MasterteamSA tooling.
