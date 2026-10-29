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
Publisher's app-local API. The other four verbs remain dispatch stubs in this
build and exit `2` with `not implemented in this build`. Help exits `0`.

`--root <dir>` starts discovery at a directory relative to the current working
directory. Discovery selects the nearest ancestor containing
`clossys/clossys.config.ts`. Publish reads literal configuration data without
executing configuration code.
`--check` preserves files, hashes, and modification times. `--json` emits one
result object. `produce` also accepts `--once`, `--port <0..65535>`, and
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
