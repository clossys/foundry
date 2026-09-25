---
advisor: minor
---

`validateRegistrySnapshot()` checks a registry snapshot, the record of what the registry said about the packages a plan asks for, against the new shared registry snapshot contract: its schema (which, like the plan contract, limits a package name to 214 characters and each number of a version to 16 digits), then its code rules N1-N3 (`registrySnapshotRuleViolations()`: no package named twice, no version recorded twice for one package, no `latest` or versions for a package that was not found). Each violation names a rule and a position, never a value or an undeclared key. The types are `RegistrySnapshot`, `RegistrySnapshotPackage`, `RegistrySnapshotVersion`, `RegistrySnapshotRuleId` and `RegistrySnapshotViolation` (#1178).
