# Changelog

## Unreleased

- Added the strict, locale-aware `CopyRegistry` and `CopyRef` resolution API
  for audience-facing rendered surfaces, including entry lifecycle and source
  provenance.
- Added `createCopyResolver` and `resolveCopyRef`; required copy now fails
  closed for unknown IDs, locale mismatch, unapproved lifecycle state, and
  placeholder mismatches.

## 0.1.0

- Consolidated the voice contract, template, validation, and checker into
  `@vespeneventures/copy`.
- Added `@vespeneventures/copy/voice` and
  `@vespeneventures/copy/voice-record.template.jsonc` entry points.
