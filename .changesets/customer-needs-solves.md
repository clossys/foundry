---
customer: minor
---

The `foundry` manifest block now declares `needs` and `solves` (package
framework, issue #1172). `needs` names Strategist's
`audience-understanding` (the named Audience a keep speaks as) and
Publisher's `surface-documents` (the shipped surface a keep inhabits). These
are the `keep-verdict` capability's own inputs. `solves` claims the
`customer-would-they-keep-it` problem, measured by the customer keep rate,
backed by `keep-verdict` and shown by the `keep-satisfied` case. Its
evidence is `designed`: no retained qualification record covers this
version yet.

Minor, not patch: these are new declared manifest fields that discovery and
the Advisor catalogue read. Nothing that already existed changes shape.
