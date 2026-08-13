# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-13

### Security

- **Breaking:** the Clerk sign-in adapter (`ClerkSignInBlock`, in
  `@vespeneventures/auth/providers/clerk/web/client`) now passes the
  sanitized redirect as `forceRedirectUrl` instead of `fallbackRedirectUrl`.
  Per Clerk's own type docs, `fallbackRedirectUrl` applies only "when no
  other redirect props, environment variables or search params are
  present," while `forceRedirectUrl` "has precedence over other redirect
  props, environment variables or search params." Clerk's `<SignIn>` widget
  independently reads its own `redirect_url` search param at render time —
  so with `fallbackRedirectUrl`, an attacker-controlled query param could
  override the value this package had just validated with
  `resolveSafeRedirect`, silently defeating the point of sanitizing it at
  all. Breaking because a consumer relying on some other redirect source
  outranking `redirect_url` will now see the sanitized value win instead.
  Under this repo's pre-1.0 semver policy a breaking change to a 0.x
  package is a MINOR bump, not MAJOR.
- New README guidance generalizing the lesson: whenever a sanitized
  `resolveSafeRedirect` result is wired into an auth widget, confirm — for
  that specific widget, by reading its actual prop/parameter semantics —
  that the sanitized value is the one that wins, not merely one candidate
  among several the widget consults.

### Changed

- **Breaking:** `resolveSafeRedirect` now throws `TypeError` when a
  path-style `target` is passed with no `baseOrigin`, where it previously
  returned `undefined`. A missing `baseOrigin` is a caller programming
  error, while `undefined` is the answer for untrusted input that was
  rejected — previously both produced the identical sentinel, so a
  misconfiguration was indistinguishable from a blocked attack. Untrusted
  `target` input still returns `undefined` and never throws.
- `createAllowedOriginPolicy` now dedupes duplicate origins (preserving
  first-occurrence order) instead of throwing `TypeError`. Building an
  allowlist from configuration where two entries fall back to the same
  default is normal and benign; malformed, non-string, empty, or
  credential-bearing origins still throw.

## [0.1.1] - 2026-08-13

### Fixed

- Moved `svix` from an unconditional `dependencies` entry to an optional
  peer, matching how `@clerk/nextjs`/`next`/`react`/`react-dom` were already
  declared. `svix` is only ever imported by the Clerk webhook adapter
  (`./providers/clerk`) — a consumer who installs this package for only its
  pure root/`/agent` primitives previously still pulled `svix` into their
  install regardless. Surfaced by a consumer integration (#153).

## [0.1.0] - 2026-08-11

### Added

- Initial authorization package with provider-neutral core primitives,
  delegated-agent guards, and optional Clerk webhook and web subpath exports.
