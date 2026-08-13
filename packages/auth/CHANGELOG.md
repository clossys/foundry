# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Moved `svix` from an unconditional `dependencies` entry to an optional
  peer, matching how `@clerk/nextjs`/`next`/`react`/`react-dom` were already
  declared. `svix` is only ever imported by the Clerk webhook adapter
  (`./providers/clerk`) — a consumer who installs this package for only its
  pure root/`/agent` primitives previously still pulled `svix` into their
  install regardless.

## [0.1.0] - 2026-08-11

### Added

- Initial authorization package with provider-neutral core primitives,
  delegated-agent guards, and optional Clerk webhook and web subpath exports.
