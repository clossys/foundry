---
id: foundry-public-repo-facts
source: https://github.com/clossys/foundry
observed: 2026-11-02
by: director
---
- The repository README, LICENSE and package manifests on the release base read on 2026-11-02; this finding records what the public source tree says, not shipped runtime behavior or approval.
- The repository is public and MIT licensed, and current `@clossys` package releases are public on npm.
- The README thesis says every check runs against what is actually on disk or installed, never against what a manifest claims about itself.
- Director is `@clossys/strategist` (facts traceability, brand coverage and direction currency gates); Designer is `@clossys/designer` (token, brand and contrast gates); Writer is `@clossys/writer` (approved-only copy registry with traceability, addressability, voice and locale gates); Publisher is `@clossys/publisher` (web, email, print, image and slides renderers plus an append-only publication record).
- `@clossys/producer` provides the `clossys` CLI; its dispatcher names the verbs check, produce, write, design, direct and publish, plus `migrate slots --check` for the slot model.
- The slot model stores every L3 slot as a folder with `slot.json`, candidate files under `candidates/` and at most one `pin.json`; a pin names its candidate, a sha256 and `pinnedBy`, so candidates carry no approval state.
- The Director IA lists 57 L3 slots under 7 L1 groups, sourced from `@clossys/strategist#leaf-freeze:2026-10-28`.
- NEED: The tree holds no market sizing, customer interviews, pricing, revenue, funding or team records; any slot that depends on those facts has no evidence here.
