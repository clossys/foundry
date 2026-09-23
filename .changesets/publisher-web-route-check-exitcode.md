---
publisher: patch
---

Fix a `process.exit()`-after-write race in `publisher-web-route-check` (the
`checkWebRoutesCli.ts` CLI) that could truncate stdout under load; the CLI
now sets `process.exitCode` and lets the process exit naturally, matching
the pattern the rest of the repo's CLIs use.
