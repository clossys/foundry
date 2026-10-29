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

All five verbs are dispatch stubs in this build. They exit `2` with
`not implemented in this build`; they do not execute the agents. Help exits `0`.

`--root <dir>` starts discovery at a directory relative to the current working
directory. Discovery selects the nearest ancestor containing
`clossys/clossys.config.ts`. The scaffold locates that file without evaluating it.
`--check` preserves files, hashes, and modification times. `--json` emits one
result object. `produce` also accepts `--once`, `--port <0..65535>`, and
`--no-open`; `publish` accepts `--target <id>`.

| Exit | Contract |
| --- | --- |
| `0` | Successful result, including help |
| `1` | Reserved for a verdict failure when verb behavior is implemented |
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
