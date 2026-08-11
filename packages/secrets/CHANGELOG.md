# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- Initial provider-neutral client and adapter contracts.
- Late-bound environment and mutable in-memory test adapters.
- Async and synchronous resolution with safe, value-free errors.
- Value-free secret catalog types and a frozen catalog authoring helper.
- Infisical v4 API integration at the `./infisical` subpath with injected
  configuration, access-token and OIDC authentication, value-free readiness,
  child-process injection, and a provider-specific CLI that never prints
  secret values.
- Separately constructed, policy-gated Infisical replacement with optional
  verification and no unsafe automatic rollback.
