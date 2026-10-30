# @clossys/producer

Private executable tooling scaffold for the `clossys` command and agent package resolution.
Version 0.1.0 is unreleased.

## CLI

```sh
clossys --help
clossys <verb> [--check] [--root <dir>] [--json]
```

| Verb | Agent |
| --- | --- |
| `direct` | Director, with Strategist as the workspace fallback |
| `design` | Designer |
| `write` | Writer |
| `publish` | Publisher |
| `produce` | The four agents in sequence |

`publish --target <id>` validates the selected target and delegates emission to
Publisher's app-local API. The direct, design and write verbs remain dispatch
stubs and exit `2` with `not implemented in this build`. Help exits `0`.

`clossys produce [--port 4300] [--no-open]` compiles Designer and Writer cells,
then serves the read-only Studio on `127.0.0.1`. The browser opens by default.
`--once` compiles and exits: `0` when both agents compiled, `2` when a required
agent is missing or compilation failed. Missing inputs remain visible as gaps;
normal serving continues so initial Director drafts can be inspected. `--check`
checks existing projections without writing and exits without starting a server.
Compilation writes only `clossys/agents/designer/compiled` and
`clossys/agents/writer/compiled` beneath the discovered consumer root. It uses
each agent's shipped compiler and active pointers, leaving drafts uncompiled.

Studio is a required Next standalone build under `dist/studio`. Producer first
reads `manifest.json` schema version 1 and uses its relative `serverEntry`,
validating that the resolved file remains under that output directory.
Without a manifest, it tries `dist/studio/server.js`.
The nested Next standalone layout `dist/studio/packages/producer/studio/server.js`
is also supported. Producer starts it with `HOSTNAME=127.0.0.1`, an allocated
internal `PORT`, `NODE_ENV=production`, and `CLOSSYS_PRODUCER_ORIGIN` set to
the public loopback origin. It awaits a real HTTP response before declaring
readiness, proxies non-API requests, and stops the child on shutdown or signals.
A missing build or failed child is reported as an error.

### Studio HTTP endpoints

Every request requires Host `127.0.0.1:<bound-port>` or `localhost:<bound-port>`.
Origins, when present, must match that exact HTTP origin. Mutating requests
additionally require `X-Clossys-Token` with the cryptographically random token
from `/api/config`. The token changes each run and is omitted from logs, browser
URLs, and child proxy headers. Responses do not enable cross-origin access.

| GET route | Response |
| --- | --- |
| `/api/health` | `{ok, studio}` |
| `/api/config` | `{token, tokenHeader, readOnly: true, compilation, agents}` |
| `/api/cells` | `{agents: [{agent, packageName, state, cells, tree?, message?}]}` |
| `/api/cells/:agent/:id` | `{agent, state, cell: {id, version, status, path, fields, source}}` |
| `/api/events` | SSE `ready` followed by filesystem `change` events |

Inventory returns the latest permanent version per id, including drafts and
retired cells. Detail accepts `?version=N` to read an earlier version. Summary
cells contain `{id, version, status, path, fields}`; `tree` preserves validated
grouping, active pointers, and metadata. Uninitialized agents return `missing`
with an empty list; invalid cell state returns `error`. Detail returns `404` for
missing cells and `400` for invalid ids or traversal. Paths are root-relative.
The SSE `ready` payload is `{reload:true}`. A `change` payload is
`{agent, id, reload:true}`; unknown agent/id values are `null`. Refetch the
inventory or detail after a change. A single recursive watcher observes the
actual consumer filesystem, including directory creation during initial setup;
disconnect and server shutdown release streams, timers, watchers, and child.

The current agent packages share the real Strategist cell-format store for
confined reads. Producer uses `listCells` for all versions and agent profile
parsers for Director, Designer, and Writer. Designer/Writer compiler and parser
modules are shipped under `dist` but lack exported package subpaths; Producer
loads those files from the package roots selected by `resolveAgent`. Their
layout is an integration dependency until those packages export dedicated APIs.

`--root <dir>` starts discovery at a directory relative to the current working
directory. Discovery selects the nearest ancestor containing
`clossys/clossys.config.ts`. Publish reads literal configuration data without
executing configuration code.
`--check` preserves files, hashes, and modification times. `--json` emits one
result object (on shutdown for a serving command). `produce` accepts `--once`, `--port <0..65535>`, and
`--no-open`; `publish` accepts `--target <id>`.

| Exit | Contract |
| --- | --- |
| `0` | Successful result, including help |
| `1` | Publish verification reports drift or other findings |
| `2` | Usage error, missing root, unresolved agent, or current stub refusal |

## Publish targets

Create the target app directory, then declare the repository-root configuration:

```ts
import { defineConfig } from "@clossys/producer/config";

export default defineConfig({
  id: "example",
  archetype: "product",
  locales: { default: "en", supported: ["en"] },
  targets: {
    site: { app: "apps/site", format: "web.page.responsive", publication: "site" },
  },
});
```

```sh
clossys publish --target site
clossys publish --target site --check --json
```

The generated destination is `apps/site/src/clossys/`. The command does not
install dependencies, publish a package, deploy, or edit the app manifest.
Check mode computes expected outputs in memory and does not call the writer.
The installed Publisher must expose its app-local emitter; its absence is an
explicit error, rather than a fallback emitter. Dynamic configuration expressions
and imports other than the configuration helper are unsupported.

### Publication preview

`clossys publish --target preview` emits a read-only snapshot for Producer Studio.
An explicit `preview` web target takes priority; otherwise exactly one configured
web target (excluding Studio) is required. Multiple publications require an explicit
preview target. The original app supplies source and dependencies. Generated files
go only to `clossys/.producer/preview/<publication>/src/clossys`, including
`preview.json` with route entry files and the content map. The app stays unchanged.
`--check` verifies the snapshot without writing. Producer serves the rendered
snapshot; emitted TSX files are source modules rather than directly served HTML.

## Agent mapping API

| Export | Purpose |
| --- | --- |
| `AGENT_PACKAGES` | Ordered package candidates for each agent |
| `resolveAgent` | Resolve the first available candidate from Producer's location |
| `AgentResolutionError` | Resolution error carrying exit code `2` and package names tried |
| `AgentKind` | Type for Director, Designer, Writer, or Publisher |
| `AgentResolver` | Type for an injectable package resolver |
| `ResolvedAgent` | Type for the selected kind, package name, and package root |

Director tries `@clossys/director` before `@clossys/strategist`. Designer, Writer,
and Publisher each have one candidate. Dependencies pin the available agents
to their workspace versions; `esbuild` is also pinned to an exact version.

[Changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/producer.md)
