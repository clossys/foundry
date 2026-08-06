# @vespeneventures/policy

A content-addressed binding primitive: commit a policy document's digest
publicly without ever committing the document itself, then verify a
later-materialized copy matches it byte-for-byte.

```bash
npm install @vespeneventures/policy
```

## The problem this closes

Two different contexts can each require their own configuration file for
the same purpose — a denylist, an allowlist, any policy document — with
different content in each. If the wrong one's file gets materialized into
somewhere like a CI secret, nothing about that operation looks wrong: the
file exists, it parses, a check on its *shape* is clean. The only thing
wrong is that it's the wrong *content*, and a shape check cannot tell two
well-formed documents apart.

A `PolicyBinding` closes that gap:

```jsonc
"policy": {
  "policyId": "public-safety-denylist",
  "digestAlgorithm": "sha256",
  "digest": "<64 lowercase hex characters>"
}
```

A digest is safe to commit even when the document it describes is not — a
hash reveals nothing about its input, but lets anyone holding a candidate
copy of the document check, offline and without ever exposing the document,
whether it is the exact bytes committed to. Two different documents bound
this way have two different digests; materializing the wrong one now fails
a check instead of silently succeeding.

## Usage

```ts
import { computeDigest, validateBindingShape, verifyBinding } from "@vespeneventures/policy";
import type { PolicyBinding } from "@vespeneventures/policy";

// Once, when the policy document is authored: compute its digest and commit
// only the digest.
const digest = computeDigest(policyDocumentContent);

// Later, wherever the document gets materialized (a CI job, a build step):
const binding: PolicyBinding = {
  policyId: "public-safety-denylist",
  digestAlgorithm: "sha256",
  digest,
};
const findings = verifyBinding(binding, materializedContent);
if (findings.length > 0) {
  for (const f of findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
  process.exitCode = 1;
}
```

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `computeDigest(content, algorithm?)` | function | Hashes `content` (a `string`, hashed as UTF-8 bytes, or a `Uint8Array`, hashed as-is) with `node:crypto`'s `createHash`. Default algorithm `"sha256"`. Returns lowercase hex. Equivalent bytes under either input form produce identical digests. Throws on an unsupported algorithm — a producer-side error, not something to report as a finding. |
| `validateBindingShape(value)` | function | Structural validation only: is it an object, is `policyId` a non-empty string, is `digestAlgorithm` one of `DIGEST_ALGORITHMS`, is `digest` exactly the right number of lowercase hex characters for that algorithm. Returns a `Finding[]`; empty means valid. Never throws — `null`, a string, an array, a number, or an object missing every field are all findings, not exceptions. |
| `verifyBinding(binding, materializedContent)` | function | Runs `validateBindingShape(binding)` first. If that reports any `"error"`-severity finding, returns those findings immediately and computes nothing further — a binding whose own shape can't be trusted isn't one a digest comparison against it can be trusted either. Otherwise computes `computeDigest(materializedContent, binding.digestAlgorithm)` and compares it to `binding.digest`. Mismatch → one `Finding` with `rule: "digest-mismatch"`, `severity: "error"`; the message names the `policyId` but never either digest value or any content (see below). Match → `[]`. |
| `DIGEST_ALGORITHMS` | constant | `readonly DigestAlgorithm[]` — currently `["sha256"]`. A list, not a hardcoded literal check, so a second algorithm is one new entry plus one new case in `computeDigest`, not a rewrite of every call site that currently assumes sha256. |
| `OWN_LICENSE_BINDING` | constant | This package's own `PolicyBinding`, bound to the sha256 digest of its own `LICENSE` file — see "Self-hosting" below. |
| `PolicyBinding` | type | `{ policyId: string; digestAlgorithm: DigestAlgorithm; digest: string }`. |
| `DigestAlgorithm` | type | Currently just `"sha256"`. |
| `Finding` | type | One thing `validateBindingShape` (or `verifyBinding`) found wrong (or, at `"warning"`, worth a look): `rule`, `severity`, `message`, optional `path`. Defined by this package; not shared with, or borrowed from, any other. |

### Why `verifyBinding`'s mismatch message never contains a digest

Printing a digest in a log is harmless on its own — that's the whole point
of a digest. But this function's *contract* should not depend on every
future caller making that harmless-in-isolation judgement call correctly,
forever, at every place a `Finding` might get logged, forwarded, or
attached to an error report next to other, less harmless context. Omitting
both values from the message means there's nothing in it to accidentally
propagate anywhere. A caller that wants the digests for its own diagnostics
already has `binding.digest` and can recompute the other side itself.

## Self-hosting

This package demonstrates its own mechanism on itself: `OWN_LICENSE_BINDING`
binds to its own `LICENSE` file.

```ts
export const OWN_LICENSE_BINDING: PolicyBinding = {
  policyId: "self:license",
  digestAlgorithm: "sha256",
  digest: "6ddaee99b49e12fbb935212ff047634e6cb1d95d3dc8f9f84855ef8fb28e11b3",
};
```

A test reads the live `LICENSE` file at test time and calls
`verifyBinding(OWN_LICENSE_BINDING, liveContent)`, proving the binding
passes today — and that the same test would report a `digest-mismatch`
finding the moment the file's bytes changed and the constant weren't
updated to match. That's the property this whole package exists to make
checkable, applied to its own licence text instead of an external document.

## Non-goal: everything about what a policy document actually is

`policy` does not know what a "denylist" is. It does not read any file. It
does not know about any real filesystem path. And it does not decide what
should happen when `verifyBinding` reports a mismatch — fail the build,
warn, block a release — that decision belongs to whatever calls this
package, most plausibly the `gates` package. This is a general-purpose
content-addressed binding primitive; a denylist is its motivating use case,
not something it has any special knowledge of. The same mechanism binds
equally well to any other document a project needs to commit to by digest
without committing its contents.

## Requirements

Node 20+. ESM only. No runtime dependencies.

## Licence

MIT
