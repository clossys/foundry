# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-21

### Added

- Initial `@clossys/customer` role package: first-person inhabit of a named
  Audience JSON seam, with `parseKeepRecord`, `parseInhabitRecord`,
  `parseAudience`, `checkKeepForm`, and `checkInhabitForm`.
- Session intents `keep`, `feedback`, `compare`, `refer`, and `churn` on
  the same inhabit. Keep remains the seal gate. The others are on-demand
  first-person testimony (lived functional and experiential feedback,
  alternatives the person actually knows, referral, and churn) — never a
  reviewer, QA contractor, or strategy memo.
- `customer-check <record.json> <audience.json>` gate for inhabit-form
  shape and consistency. The CLI never certifies a five-star quality score.
- `assessCustomerKeepRate()` for the charter metric `customer keep rate`,
  counting keep-intent observations only, plus
  `customer-rate-check <assessment.json>` with `foundry.assessment`
  `{ "bin": "customer-rate-check", "invocation": "single-json-input" }`.
- Public npm install documentation and MIT license aligned with sibling roles.

### Notes

- This release does not claim the position is grounded or closed.
