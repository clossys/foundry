# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.0 - 2026-09-24

- The `foundry` manifest block now declares `capabilities` (manifest schema
version 3, #1196), a capability map of this role's craft: seven
capabilities, all `built`, one per existing inhabit intent (keep, feedback,
compare, refer, churn, adopt, and worth, as the capabilities
`keep-verdict`, `lived-feedback`, `comparison-against-alternatives`,
`refer`, `churn`, `adopt`, and `worth`), each a first-person record that
`customer-check` validates. Each capability names as its `proofCase` a
release-qualification case that runs that intent through `customer-check`
(`keep-satisfied`, `feedback-satisfied`, `compare-satisfied`,
`refer-satisfied`, `churn-satisfied`, `adopt-satisfied`, and
`worth-satisfied`), rather than one case standing in for all seven (#1272).
- The `foundry` manifest block now declares `outputs` (the seven
`clossys/customer/*.json` session records this role owns), `feeds` (the
`keep-verdict` at `clossys/customer/keep.json`, which Publisher waits for
before it seals), and `fit`, which names a new shipped `fit-signals.json`
with two signals: a named audience to speak as, and an audience-facing
candidate to keep or fail. `intake` and `status` are not declared yet. The
README now documents every exported type.
- The `foundry` manifest block now declares `needs` and `solves` (package
framework, #1172). `needs` names Strategist's `audience-understanding` (the
named audience a keep speaks as) and Publisher's `surface-documents` (the
shipped surface a keep inhabits), the `keep-verdict` capability's own
inputs. `solves` claims the `customer-would-they-keep-it` problem, measured
by the customer keep rate, backed by `keep-verdict` and shown by the
`keep-satisfied` case. Its evidence is `designed`: no retained
qualification record covers this version yet.
- The changelog is no longer included in the package; it now lives in the public repository, linked from the README.
- Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).
- Packed skill: cite the strategist handoff. writer cites an audience id,
approved claim ids (`claim:<id>`), applicable constraint ids
(`constraint:<id>`), and the current direction id, and never edits
`clossys/strategist/`. designer cites constraint ids and derived token slot names,
and never adds a brand attribute, color value, or type pairing inside
strategy records. customer speaks only from the audience
`situation`/`pains` Strategist recorded, never authors the audience
record, and does not inhabit until `strategist-check handoff` is green.
publisher seals against the projected strategy provenance
(`projectStrategyContract` / `createStrategyProvenance`) and never
authors strategy. Refs: #1120, #1121, #1122, #1123.

## [0.1.3] - 2026-09-23

### Notes

- No packed content changed. This package's test suite changed as part of
  fixing leaking temp fixture directories (issue #1250), and its 0.1.1
  qualification record was already retained -- once a version's record is
  retained, any further change to that package, packed or not, requires a
  new version. 0.1.2 is claimed by open PRs #1258 and #1280 for real
  feature work (version-collision rule, issue #1187).

## [0.1.1] - 2026-09-22

### Added

- `skill/SKILL.md` now describes the bounded, independent keep procedure
  (#1067): required inputs (desktop screenshot, one narrow-width
  screenshot, and the live URL — never the source tree), the requirement
  that the procedure runs in a session separate from the doer's own
  session, the vision-capability requirement (actual image-reading, not
  text-only reasoning about a screenshot's existence), and a pointer to the
  "Bounded taste pass" section of the PRE-AUTH-QUALITY brief that ships
  with `@clossys/designer` for the exact round and wall-clock caps, so the
  numbers stay declared in one place instead of drifting between packages.

## [0.1.0] - 2026-09-21

### Added

- Initial `@clossys/customer` role package: first-person inhabit of a named
  Audience JSON seam, with `parseKeepRecord`, `parseInhabitRecord`,
  `parseAudience`, `checkKeepForm`, and `checkInhabitForm`.
- Session intents on the same inhabit. Keep remains the seal gate and the
  only charter metric. Speed-dial testimony is the same person, never a
  second role:
  - `feedback` — lived functional and experiential testimony on any topic
    (synthetic power user, not a QA contractor). At least one lived
    channel is required. Records `blockedMe`, `whatIDidInstead`, and
    `wantedInstead`.
  - `compare` — alternatives from this person's actual consideration set,
    with lived `whatTheyDoBetter`, `whatThisDoesBetter`,
    `whenIReachForThem`, and `switchingCost`. Empty alternatives is a
    finding. Not a competitive-intel memo.
  - `refer` — whether I would tell a peer, the words I would use, what
    stops me, and `whatItWouldTake`.
  - `churn` — `theWarning`, the moment I leave, where I would go, what
    would keep me.
  - `adopt` — whether I would start, what stops me, the first real job I
    would give it.
  - `worth` — whether this is worth my time, money, or attention.
- `customer-check <record.json> <audience.json>` gate for inhabit-form
  shape and consistency. The CLI never certifies a five-star quality score.
- `assessCustomerKeepRate()` for the charter metric `customer keep rate`,
  counting keep-intent observations only, plus
  `customer-rate-check <assessment.json>` with `foundry.assessment`
  `{ "bin": "customer-rate-check", "invocation": "single-json-input" }`.
- Public npm install documentation and MIT license aligned with sibling roles.
- Packed `skill/` in the npm `files` list so an installed pin carries the
  `@clossys-customer` voice (#1017).

### Notes

- This release does not claim the position is grounded or closed.
