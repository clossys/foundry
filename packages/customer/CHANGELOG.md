# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
