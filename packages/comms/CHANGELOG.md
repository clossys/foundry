# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-10

### Added

- Initial provider-neutral email message, policy, dispatch, lease, acceptance,
  and delivery-event contracts.
- Built-in `./resend` subpath with strict Resend email transport, provider tag
  normalization, raw webhook verification, and delivery/inbound event mapping.
