# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-23

### Added

- Initial provider-neutral Messenger role with mandatory authorization policy,
  durable claim/completion ledger, finished email validation, and normalized
  delivery outcomes.
- `messenger-check delivery-closure`, measuring timely verified delivery from
  independent evidence and returning indeterminate when no delivery intent is
  due.
- Optional `./providers/resend` adapter for outbound email and signed delivery
  webhook normalization. Person-request admission intentionally remains outside
  this role.
