# BUILD REPORT — porefind

Rebuild of `com.filtrous/mcp-catalog` v1.0.1 (remote-only, keyless
capture) as `@reneturcios/porefind` 0.1.0 /
`io.github.CloudCorpRecords/porefind`.

## Labelled subset statement

This build is a **labelled subset: 3 of the 4 captured tools**. The
captured fourth tool, `request_quote` (required: `items`, `contact`),
submits a quote request carrying a `contact` object to the vendor —
PII lead routing into a sales pipeline — and is **omitted under the
program's SAFETY rule** (the propdata/tunecatalog/bookbind
omitted-tool precedent). It is not registered in `TOOL_DEFS`, does
not appear in the served MCP tools/list, is rejected at the MCP
layer and as a CLI subcommand like any unknown name, and is never
forwarded. Tests assert its absence from both the local tool
registry and the served MCP tools/list, plus rejection at the MCP
layer (with zero upstream calls made) and at the CLI (exit 2).

The 3 kept tools are the read-only catalog surface: product search
by specification text, product details, and price/lead-time reads.

## Fixture conflicts

**One conflict, resolved in favour of the fixture's tool objects:**

- The fixture file's `_source` note describes the capture as
  carrying "name/title/description/inputSchema as captured", but
  the fixture's three tool **objects** carry exactly the keys
  `name`, `description`, `inputSchema` — **no `title` key on any
  tool**. The objects win: the rebuild serves the literals with no
  titles and invents none, and a registration test asserts each
  served tool's key set is exactly
  `["description", "inputSchema", "name"]`. (The spec prose's own
  slimming note — "name, description, inputSchema" — agrees with
  the objects; only the `_source` string mentions `title`.)

Otherwise the brief, the spec prose, and the fixture agree on all
tool names and every required field. Required fields as served,
from the fixture:

- `search_products` — required: [`query`]
- `get_product_details` — required: [`handle`]
- `get_price_and_lead_time` — required: [`sku`]

The fixture's tool literals (descriptions, property descriptions,
`limit` minimum 1 / maximum 50, `additionalProperties: false`, and
the `$schema` draft-07 key) are served verbatim from
`src/forward.ts`. The capture's `outputSchema`/`execution` blocks
are not reproduced, per the spec (parity compares inputSchema).

## What was built

All 19 factory files under `builds/porefind/`, plus this report:

- `package.json` (`@reneturcios/porefind` 0.1.0, bin
  `porefind` → `dist/cli.js`, deps exactly
  `@modelcontextprotocol/sdk ^1` + `zod ^3`; devDeps
  `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 76-char string
  "Search lab-filtration products by specification, with prices and
  lead times."; npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/porefind:0.1.0` carries **no** version
  field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/porefind"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose, states the subset
  and the omission plainly), `LICENSE` (MIT, Copyright (c) 2026
  Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-27,
  states the omission)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/porefind`, smoke assertion on server
  name `porefind`)

## Design

- Forwarding client to
  `https://filtrous-mcp-catalog.filtrous.workers.dev/mcp` (pinned),
  overridable via `FILTROUS_MCP_URL` (labelled reconstruction).
  tools/call is forwarded as a streamable-HTTP JSON-RPC client:
  initialize (protocolVersion `2025-03-26`, clientInfo `porefind`)
  → notifications/initialized → tools/call, honouring
  `Mcp-Session-Id` when issued; session established lazily and
  reused per client. Plain-JSON and SSE replies both parsed; the
  matching-id message wins; upstream results pass through verbatim
  (including `isError` and extra fields such as
  `structuredContent`).
- When `FILTROUS_API_KEY` is set, `Authorization: Bearer <key>` is
  sent on every upstream request (labelled reconstruction; the
  capture was keyless); when unset, no auth header is sent. Both
  branches are covered by tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed
  body, throwing/timing-out fetch) surface as `porefind error:`
  text results (labelled reconstruction).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers)
  serving the fixture literals exactly; no `McpServer` + zod
  registration. `src/mcp.ts` also exports `createServer` /
  `startMcpServer` / `handleCallTool` so the MCP layer is testable
  without a stdio transport; the CLI's `mcp` subcommand starts it
  over stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all
  tests run against a stubbed JSON-RPC upstream. No live network
  calls in tests; no live call claimed anywhere.

## Lockfile (Route 3, clean from birth)

Generated in a temp dir containing only the new `package.json`:
`npm install --package-lock-only --ignore-scripts --offline`.
Verified: parses, `name == @reneturcios/porefind`, **128 package
entries**; copied into the build dir with matching sha256
(`f38d4e4663a5cb844d8f4844a3b020699536bc8d5c00c7dc0c2da4dcc61eff12`
on both sides). Then `npm install --offline --ignore-scripts` in
the build dir for `node_modules`. No write-guard failure occurred;
the /tmp staging was the Route 3 generation step itself, not a
fallback.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js 2400 B, forward.js
  11099 B, mcp.js 2772 B, all non-empty, with `.d.ts` + source
  maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand →
  usage on stderr, exit 2
- `npm test` → **40 tests, 40 pass, 0 fail** (9 suites:
  registration integrity — served literals deep-equal the
  fixture's 3 tool objects, names in order, required fields per
  tool, exact key sets, `request_quote` absent from the registry;
  served MCP tools/list via an in-memory client — deep-equals the
  fixture and omits `request_quote`; session
  establishment/reuse/session-id handling; env URL override +
  Bearer header when the key is set / absent when unset; verbatim
  argument forwarding for all 3 tools; verbatim result
  pass-through incl. upstream isError and SSE; JSON-RPC/init/
  malformed/HTTP/throw/timeout failures → `porefind error:`;
  parseRpcBody; MCP-layer validation incl. `request_quote`
  rejection; CLI --version / unknown exit 2 / `request_quote`
  exit 2 / bad-JSON exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/filtrous-tools-original.json --rebuild
  "stdio:node builds/porefind/dist/cli.js mcp" --out
  builds/porefind/parity-out` (run from
  `~/workspace/mcp-rebuild-100`) → **PASS, parity 100.0,
  3/3 identical, no missing/extra/schema diffs** (see
  `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json
  top-level = npm-entry version = OCI tag = core `VERSION` =
  CHANGELOG heading (0.1.0); package.json `mcpName` = server.json
  `name` = Dockerfile label; server.json description measured at
  76 chars; OCI entry confirmed to have no `version` field.

Clean-room: all prose and code written fresh for porefind (only
the forwarding mechanics follow the proven sibling pattern); only
the fixture's tool literals are served verbatim.
