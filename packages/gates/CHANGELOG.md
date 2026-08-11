# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - Unreleased

### Added

- Exported `RunFoundationCheckOptions` so composed check packages can preserve
  the foundation check's public option contract.

## [0.1.0] - Unreleased

### Added

- Pure raw sensitive environment-read and secret-name checks.
- Value-free secret catalog and readiness checks.
- Value-free credential inventory and credential-surface drift checks.
- Path-only local secret-file checks.
- Consumer-configured provider resource naming checks.
