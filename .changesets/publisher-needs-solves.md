---
publisher: minor
---

The `foundry` manifest block now declares `needs` and `solves` (package
framework, issue #1172). `needs` names four artifacts other roles feed:
Strategist's `strategy-brief`, Designer's
`token-contract-and-brand-overlay-binding`, Writer's `copy-registry`, and
Customer's `keep-verdict`. Designer's components are not listed. They reach
this package as imports of `@clossys/designer`, recorded in
`dependencies`, and a `needs` entry names an artifact another role feeds,
not a package import. Designer's logo and identity files are not listed
either, because that capability is still `planned`. `solves` claims the
`publisher-verified-release` problem, measured by the verified publication
rate, backed by `sealing-and-the-publication-record` and shown by the
`rate-violated` case, at `designed` evidence.

Minor, not patch: these are new declared manifest fields that discovery and
the Advisor catalogue read. Nothing that already existed changes shape.
