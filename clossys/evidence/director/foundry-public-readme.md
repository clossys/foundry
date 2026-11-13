---
id: foundry-public-readme
source: https://github.com/clossys/foundry/blob/main/README.md
observed: 2026-11-12
by: director
---
- The repository README on the release base, read on 2026-11-12; this finding records how the public source tree describes and words the project, not shipped runtime behavior or owner approval.
- Thesis: every check runs against what is actually on disk or installed, never against what a manifest claims about itself.
- The README states what packages are not, in plain words, and scopes its claims: several packages make "no claim of legal compliance", and a could-not-evaluate result is never turned into a pass.
- The README table lists Director, Designer, Writer and Publisher as separate role packages, each with its own gates, plus `@clossys/producer` for the `clossys` CLI.
- The README calls its package table a source-tree inventory, not a promise that every named package is available in the registry.
- NEED: The README holds no market, pricing, revenue, funding, team or audience-size records.
