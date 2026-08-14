# Changelog

All notable changes to `@vespeneventures/provisioning` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-08-14

### Fixed

- A `links` entry declared with `target` — one pointing at another managed
  destination rather than at the source tree — is now applied after copies and
  managed blocks instead of alongside other links.

  Applying every link in one phase worked only while each chained target
  happened to be produced by another link. The first manifest to chain a link
  onto a **copy** hit `Link source does not exist` and died partway through the
  install, leaving the machine half-configured. Ordering now derives from the
  dependency rather than from where entries happen to sit in a manifest.

  `PlanOperation` gained a `chained` flag recording that edge, which is the only
  one this manifest format can express.

## [0.1.0] - 2026-08-13

### Added

- `loadManifest` for validating a parsed manifest without reading a file.
  Rejects a destination managed more than once, a templated link, malformed or
  identical block markers, and a non-octal mode.
- `createRuntimeContext`, `expandTokens`, and `planInstallation` for pure,
  filesystem-free resolution. The home directory and source root are supplied by
  the caller, and there is no fallback that invents a workspace root.
- `applyInstallation` for idempotent application through an injected
  `FileSystemPort`, backing up every replaced destination first.
- `verifyInstallation` for drift detection that reads the machine rather than
  the manifest, reporting every operation rather than stopping at the first.
- `renderManagedBlock`, `withoutManagedBlock`, `composeManagedBlock`, and
  `hasExactlyOneBlock` for marker-delimited regions inside files the engine does
  not own, including recognition of a pre-marker wholesale copy.
- `createNodeFileSystem` as the default port, in its own module so that
  importing the engine never implies touching a disk.

[0.1.1]: https://github.com/vespeneventures/foundry/releases/tag/provisioning-v0.1.1
[0.1.0]: https://github.com/vespeneventures/foundry/releases/tag/provisioning-v0.1.0
