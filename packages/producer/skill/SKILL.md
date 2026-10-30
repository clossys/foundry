---
name: clossys-producer
disable-model-invocation: true
description: Inspect the private clossys CLI scaffold and its agent resolution contract.
---

Use `clossys --help` to inspect supported verbs and flags. This private build
recognizes `direct`, `design`, `write`, `publish`, and `produce`. `direct`, `design`,
`write` and `publish` without `--target` exit `2` with `not implemented in this build`.
`publish --target preview` renders and serves the active pages and writes a build report.

Use `--root <dir>` to select the starting directory for discovery of an ancestor
containing `clossys/clossys.config.ts`. The scaffold does not evaluate the config.
Use `--json` for one result object and `--check` for a run that preserves files.

Resolve agent packages through `resolveAgent` and `AGENT_PACKAGES`. Director
prefers the Director package and falls back to Strategist. A resolution failure
reports the package names tried and exit code `2`.
