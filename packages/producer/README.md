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

`direct`, `design`, and `publish` are dispatch stubs in this build.
They exit `2` with `not implemented in this build`. Help exits `0`.

`clossys write --brief` assembles a structured, read-only brief from the active
Director cells, including their ids and versions and the Writer leaves to fill.
It prints the brief; `--json` puts it in the result's `brief` field.
`clossys write --check` checks Director links, version freshness, voice derivation,
banned claims and locale coverage using Writer's native checks. Findings appear
in the message and the JSON result's `checks` field. Both commands preserve cell
files and outputs. `--brief` and `--check` cannot be combined.

Plain `clossys write` compiles active Writer cells to
`clossys/agents/writer/compiled` using the existing compile manifest. It does not
require a clean traceability check or an active Director. Draft cells remain
outside the compiled copy. These commands make no model or network calls and
create no drafts; creative derivation follows the Writer package skill in the
consumer session, followed by the existing cell check and activation flow.

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
`clossys/clossys.config.ts`. The scaffold locates that file without evaluating it.
`--check` preserves files, hashes, and modification times. `--json` emits one
result object (on shutdown for a serving command). `produce` accepts `--once`, `--port <0..65535>`, and
`--no-open`; `publish` accepts `--target <id>`.

| Exit | Contract |
| --- | --- |
| `0` | Successful result, including help |
| `1` | Writer traceability or coverage findings |
| `2` | Usage error, missing root, unresolved agent, or current stub refusal |

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

## Build and install a local sprint

From the Foundry checkout, install its locked workspace dependencies with `npm ci`,
then pack the current sprint into a fresh directory outside the checkout:

```sh
node packages/producer/scripts/pack-five.mjs --out-dir <tarball-directory>
```

The script clean-builds the mapped agents, their local dependencies, and Producer,
then runs native `npm pack` for the five packages. It preserves their current
versions and Producer's private flag. When Studio App Router source and a Next config are present, it
also runs `scripts/build-studio.mjs` and includes the standalone Studio output.
`--help` describes the interface. Build logs use stderr; stdout and the output
directory's `summary.json` contain the package names, versions, filenames,
integrities, source Git head, and dirty-state evidence. Existing tarballs are
never overwritten.

Use a complete sprint head containing the Studio source for consumer installation.
Check that `summary.json` reports `complete: true` and `studio.status: "built"`.
An earlier scaffold-only checkout can still produce five tarballs, but explicitly
reports `complete: false` and `studio.status: "missing-source"`; that result does
not establish Studio readiness.

At the consumer repository's root, install all five generated tarballs into its
existing `clossys/` npm workspace in one command. Set `PACK_DIR` to the absolute
output directory from the pack step:

```sh
PACK_DIR=<tarball-directory>
npm install --workspace ./clossys "$PACK_DIR"/*.tgz
```

The fresh output directory contains exactly the four resolved agent tarballs and
the private Producer tarball. This uses local files and publishes nothing; it
does not change the consumer's workspace layout.

[Changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/producer.md)
