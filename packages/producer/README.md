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

[Changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/producer.md)
