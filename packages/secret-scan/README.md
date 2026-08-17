# @vespeneventures/secret-scan

Verified gitleaks binary download and secret-scan gate utilities. Pure,
provider-agnostic mechanism for CI secret scanning with SHA-256 verified
binary downloads.

```bash
npm install @vespeneventures/secret-scan
```

## The problem this closes

Repositories that adopt a secret-scan gate using gitleaks often download the
binary directly from GitHub releases without verifying its integrity:

```bash
# Unverified — the standard pattern found across many repos
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz" \
  -o /tmp/gitleaks.tar.gz
tar -xzf /tmp/gitleaks.tar.gz -C /tmp gitleaks
/tmp/gitleaks version
```

If the release asset is replaced (compromised CDN, supply-chain attack, or
even a maintainer error), every CI run executes the tampered binary. The
gitleaks Action (`gitleaks/gitleaks-action`) avoids this by pinning the
Action version, but it requires a paid `GITLEAKS_LICENSE` for organization
repositories — the binary itself is MIT-licensed and free.

## What this package provides

- **Verified downloads**: Each release version has a hardcoded SHA-256
  checksum. The downloader fetches the asset, computes its hash, and throws
  if it doesn't match the expected value.
- **Cross-platform**: Supports Linux (x64, arm64), macOS (x64, arm64), and
  Windows (x64).
- **Caching**: Downloaded and verified binaries are cached per
  version/platform/arch. Subsequent runs use the cached binary instantly.
- **Pure mechanism**: No account values, no GitHub API calls, no provider
  coupling. The caller supplies the version and expected checksum (or uses
  the built-in known releases).
- **CLI + programmatic API**: Use the exported functions directly or the
  CLI for ad-hoc verification.

## Usage

### Programmatic API

```ts
import {
  downloadAndVerifyGitleaks,
  getCachedGitleaksPath,
  resolveGitleaksRelease,
} from "@vespeneventures/secret-scan";

// Check cache first
const cached = getCachedGitleaksPath("8.30.1");
if (cached) {
  console.log("Using cached binary:", cached);
} else {
  // Download and verify
  const result = await downloadAndVerifyGitleaks({
    version: "8.30.1",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  });
  console.log("Downloaded and verified:", result.path);
}

// Or resolve a known release (includes the expected checksum)
const release = resolveGitleaksRelease("8.30.1");
if (release) {
  const result = await downloadAndVerifyGitleaks({
    version: release.version,
    sha256: release.sha256,
  });
}
```

### CI Integration

In a GitHub Actions workflow (reusable workflow example):

```yaml
name: Secret scan (reusable)

on:
  workflow_call:
    inputs:
      gitleaks-version:
        type: string
        default: "8.30.1"
      gitleaks-sha256:
        type: string
        required: true

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Verify and run gitleaks
        uses: ./.github/actions/verify-gitleaks
        with:
          version: ${{ inputs.gitleaks-version }}
          sha256: ${{ inputs.gitleaks-sha256 }}
```

Or use the programmatic API in a composite action:

```yaml
# .github/actions/verify-gitleaks/action.yml
name: Verify and run gitleaks
inputs:
  version:
    type: string
    required: true
  sha256:
    type: string
    required: true
runs:
  using: node20
  main: dist/index.js
  pre: install.js
  post: cleanup.js
```

The `dist/index.js` would call `downloadAndVerifyGitleaks` with the inputs.

## Known Releases

The package includes built-in checksums for known gitleaks releases:

| Version | SHA-256 (linux x64) |
|---------|---------------------|
| 8.30.1 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Additional versions can be added by updating the `KNOWN_RELEASES` constant
and publishing a new package version. Callers can also supply their own
checksum for versions not yet in the built-in list.

## Cache Location

Binaries are cached in `$TMPDIR/vespeneventures/secret-scan/gitleaks/`
(or `$HOME/.cache/...` on Windows) organized by
`gitleaks-<version>-<platform>-<arch>/`. The cache is per-user and
survives across CI runs on self-hosted runners.

## Non-Goals

- **Does not run the scan**: This package only handles verified binary
  acquisition. The actual gitleaks invocation (flags, commit range, output
  format) remains the caller's responsibility.
- **Does not manage gitleaks config**: `.gitleaksignore`, rule customization,
  etc. are repository-local concerns.
- **No GitHub API dependency**: Checksums are embedded in the package, not
  fetched from the releases API at runtime.

## Requirements

Node.js >= 20. No runtime dependencies (except optional `adm-zip` for
Windows `.zip` extraction and `tar` for Unix archives).

## License

MIT