# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-23

### Added

- Initial provider-neutral Influencer role with complete consumer bindings,
  intent-bound authority, a paid-spend ceiling fixed at zero, atomic action
  claiming, injected configure/publish/reply actuation, and durable outcomes.
- `influencer-check response-yield`, computing independently verified qualified
  audience responses per thousand eligible exposures and returning an explicit
  indeterminate result when evidence cannot support the metric.
