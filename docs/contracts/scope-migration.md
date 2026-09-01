# Scope migration contract: `@vespeneventures` to `@clossys`

This is the authoritative consumer-facing contract for moving a repository off
the retired `@vespeneventures` package scope and onto `@clossys`. It exists so
that a consuming repository can migrate against a stated source of truth
instead of rediscovering these facts by reading installed tarballs.

Foundry is the producing repository for the `@clossys` package family. It is a
neutral supplier: it does not install into a consumer, hold consumer authority,
or claim that any consumer has adopted anything. This document states what the
published artifacts are. What a consumer does with them is that consumer's
record to keep.

## How to read this document

Every claim below was verified against a published artifact on
`registry.npmjs.org` or against a file in this repository, and each section
names the evidence. Claims that could not be settled that way are marked
**UNVERIFIED** and say what would settle them. An unverifiable claim published
as a contract gets trusted by every reader at once, so an admitted gap is
preferred to a confident guess.

### Observation window and version drift

The registry observations in this document were taken at
**2026-08-31T04:31:34Z** (the `observedAt` field of
[`governance/release-cleanup/clossys-npmjs-affected.json`](../../governance/release-cleanup/clossys-npmjs-affected.json)),
cross-checked live while this document was written.

Publication of this family is active and versions move. **Do not copy a version
number out of this document into a lockfile.** Adopt the floors as caret ranges,
and re-derive the current version at migration time:

```bash
npm view @clossys/controller version
npm view @clossys/controller --json | jq '{name, version, bin: (.bin | keys), repository}'
```

The name mapping, the bin names, the role roster, and the registry and
authentication facts are stable across these version bumps. Only the version
numbers move.

## 1. Package name mapping

A blind scope substitution of `@vespeneventures` to `@clossys` is **not** a
correct migration. 25 packages in this family were renamed, not merely
rescoped. A consumer that only swaps the scope prefix will silently retain
25 package names that do not exist under `@clossys`.

The authority for this mapping is
[`docs/contracts/package-lifecycle.json`](package-lifecycle.json), a
`schemaVersion: 1` document with 63 entries: 19 `active` (`@clossys`),
19 `published` (`@vespeneventures`, pure scope swap), and 25 `retired`
(renamed, each carrying an explicit `replacement`).

### 1a. Pure scope swaps (19 packages)

For these, the local part of the name is unchanged and only the scope moves.

| Old name | New name |
| --- | --- |
| `@vespeneventures/advisor` | `@clossys/advisor` |
| `@vespeneventures/architect` | `@clossys/architect` |
| `@vespeneventures/bouncer` | `@clossys/bouncer` |
| `@vespeneventures/builder` | `@clossys/builder` |
| `@vespeneventures/butler` | `@clossys/butler` |
| `@vespeneventures/controller` | `@clossys/controller` |
| `@vespeneventures/designer` | `@clossys/designer` |
| `@vespeneventures/giver` | `@clossys/giver` |
| `@vespeneventures/influencer` | `@clossys/influencer` |
| `@vespeneventures/inspector` | `@clossys/inspector` |
| `@vespeneventures/integrator` | `@clossys/integrator` |
| `@vespeneventures/keeper` | `@clossys/keeper` |
| `@vespeneventures/locksmith` | `@clossys/locksmith` |
| `@vespeneventures/messenger` | `@clossys/messenger` |
| `@vespeneventures/observer` | `@clossys/observer` |
| `@vespeneventures/publisher` | `@clossys/publisher` |
| `@vespeneventures/starter` | `@clossys/starter` |
| `@vespeneventures/strategist` | `@clossys/strategist` |
| `@vespeneventures/writer` | `@clossys/writer` |

### 1b. Renames (25 packages)

For these, the local part of the name changes too. Each row is a name a blind
scope substitution would leave dangling.

| Old name | New name | Range | Compatibility stub forwards? |
| --- | --- | --- | --- |
| `@vespeneventures/auth` | `@clossys/bouncer` | `^0.1.0` | no |
| `@vespeneventures/catalog` | `@clossys/controller` | `^0.8.0` | no |
| `@vespeneventures/comms` | `@clossys/messenger` | `^0.1.0` | no |
| `@vespeneventures/consent` | `@clossys/butler` | `^0.1.0` | no |
| `@vespeneventures/conventions` | `@clossys/controller` | `^0.8.0` | no |
| `@vespeneventures/copy` | `@clossys/writer` | `^0.3.0` | no |
| `@vespeneventures/deployment` | `@clossys/builder` | `^0.7.0` | no |
| `@vespeneventures/domain` | `@clossys/architect` | `^0.1.0` | no |
| `@vespeneventures/domain-model` | `@clossys/architect` | `^0.1.0` | no |
| `@vespeneventures/gates` | `@clossys/controller` | `^0.8.0` | no |
| `@vespeneventures/governance` | `@clossys/controller` | `^0.8.0` | no |
| `@vespeneventures/ledger` | `@clossys/publisher` | `^0.1.0` | no |
| `@vespeneventures/policy` | `@clossys/controller` | `^0.8.0` | no |
| `@vespeneventures/provisioning` | `@clossys/builder` | `^0.7.0` | no |
| `@vespeneventures/release` | `@clossys/controller` | `^0.8.0` | no |
| `@vespeneventures/repository` | `@clossys/controller` | `^0.8.0` | no |
| `@vespeneventures/review` | `@clossys/controller` | `^0.8.0` | no |
| `@vespeneventures/secret-scan` | `@clossys/inspector` | `^0.1.0` | no |
| `@vespeneventures/secrets` | `@clossys/locksmith` | `^0.1.0` | no |
| `@vespeneventures/strategy` | `@clossys/strategist` | `^0.1.0` | no |
| `@vespeneventures/surface` | `@clossys/publisher` | `^0.1.0` | no |
| `@vespeneventures/tokens` | `@clossys/designer` | `^0.2.0` | no |
| `@vespeneventures/ui` | `@clossys/designer` | `^0.2.0` | no |
| `@vespeneventures/verify-standards` | `@clossys/inspector` | `^0.1.0` | no |
| `@vespeneventures/voice` | `@clossys/writer` | `^0.3.0` | no |

Note the `forwardsToReplacement` column. Every renamed package answers **no**:
there is no compatibility stub still forwarding to the replacement. An install
of any old name resolves to nothing under `@clossys`. The consolidation stubs
that once existed for `governance` and `policy` were removed rather than kept.

### The `governance` to `controller` case, stated precisely

`@vespeneventures/governance` maps to `@clossys/controller` at range
`^0.8.0`. Two distinct steps produced that, and conflating them causes
confusion when reading the changelog:

1. **A merge and rename inside the old scope.** `@vespeneventures/controller`
   `0.1.0` was formed by merging `@vespeneventures/governance` (`0.15.0`),
   `@vespeneventures/conventions` (`0.8.0`), and `@vespeneventures/policy`
   (`0.1.0`) into one package. Evidence:
   [`packages/controller/CHANGELOG.md`](../../packages/controller/CHANGELOG.md)
   lines 793 to 823. The changelog states every subpath previously reachable
   under the three old names resolves unchanged, and that this was "a rename and
   a merge, not a rewrite".
2. **The scope move.** `@vespeneventures/controller` then became
   `@clossys/controller`. Evidence:
   [`governance/release-qualifications/controller-0.8.21.json`](../../governance/release-qualifications/controller-0.8.21.json)
   records candidate `@vespeneventures/controller` at `0.8.21`, and
   `clossys-controller-0.8.21.json` records `@clossys/controller` at the same
   `0.8.21`.

So the package was already called `controller` before the scope moved. A
consumer still on `@vespeneventures/governance` is behind on both steps and
should target `@clossys/controller` directly. `catalog`, `gates`, `release`,
`repository`, `review`, `conventions`, and `policy` all collapse into
`@clossys/controller` the same way.

## 2. Role roster

The installed role catalog is a `schemaVersion: 4` role contract shipped
inside `@clossys/controller`.

- **Path inside the package:** `contracts/role-loop-archetypes.json`
- **Consumer resolution specifier:**
  `@clossys/controller/contracts/role-loop-archetypes.json`
  (a declared `exports` subpath, not a deep reach into package internals)
- **Declared role count: 18**
- **`schemaVersion`: 4**
- **Universal stages (5):** sense, judge, act, verify, learnOrEscalate
- **Loop modes (6):** assure, reconcile, fulfill, interact, steward, optimize
- **Consumer bindings required per position:** 14

Evidence: extracted from the `@clossys/controller@0.8.23` tarball fetched from
`registry.npmjs.org` and verified against the registry's own `dist.integrity`
SHA-512. The file is byte-identical to this repository's
[`docs/contracts/role-loop-archetypes.json`](role-loop-archetypes.json);
both are SHA-256 `86f4d38599744b65b6689a47e5baa312e5f5ed538e6fcecd4d8dc67061efe3ed`.
The `exports` map of the published manifest declares
`"./contracts/role-loop-archetypes.json"`.

**18 roles across 19 packages.** `@clossys/starter` is a scaffolding
package and is deliberately not a role. A consumer ledger that expects one role
per package will be off by one.

| Role | Primary mode | Owned metric | Unit / direction |
| --- | --- | --- | --- |
| `@clossys/advisor` | reconcile | `engagement-decision-currency-rate` | ratio / increase |
| `@clossys/controller` | reconcile | `rule conformance rate` | ratio / increase |
| `@clossys/architect` | optimize | `architecture exception rate` | ratio / decrease |
| `@clossys/inspector` | assure | `change escape rate` | ratio / decrease |
| `@clossys/builder` | fulfill | `desired-state realization rate` | ratio / increase |
| `@clossys/locksmith` | steward | `controlled key rate` | ratio / increase |
| `@clossys/integrator` | reconcile | `package currency rate` | ratio / increase |
| `@clossys/observer` | optimize | `unobserved outcome rate` | ratio / decrease |
| `@clossys/strategist` | assure | `strategy traceability rate` | ratio / increase |
| `@clossys/writer` | assure | `approved copy coverage rate` | ratio / increase |
| `@clossys/designer` | assure | `design conformance rate` | ratio / increase |
| `@clossys/publisher` | fulfill | `verified publication rate` | ratio / increase |
| `@clossys/influencer` | optimize | `qualified response yield per thousand` | rate / increase |
| `@clossys/bouncer` | reconcile | `unreconciled grant rate` | ratio / decrease |
| `@clossys/butler` | interact | `confirmed current intent rate` | ratio / increase |
| `@clossys/messenger` | fulfill | `timely verified delivery rate` | ratio / increase |
| `@clossys/giver` | fulfill | `timely semantic closure rate` | ratio / increase |
| `@clossys/keeper` | steward | `justified visible holding rate` | ratio / increase |

Validate a consumer ledger against this catalog with Controller's installed
executable:

```bash
foundry-position-check path/to/foundry-positions.json path/to/role-loop-archetypes.json
```

## 3. Installed executables

Consumers must write these exact names into governance records and invocation
lines. They cannot be guessed from the package name, and several do not match
it. Across the family there are **33 installed executables**.

| Package | Version read | Count | Installed executables |
| --- | --- | --- | --- |
| `@clossys/advisor` | 0.1.5 | 2 | `advisor-check`, `advisor-execution-readiness` |
| `@clossys/architect` | 0.1.2 | 1 | `architect-check` |
| `@clossys/bouncer` | 0.1.1 | 1 | `bouncer-check` |
| `@clossys/builder` | 0.7.3 | 2 | `builder-verify-toolchain`, `builder-verify-machine` |
| `@clossys/butler` | 0.1.1 | 1 | `butler-check` |
| `@clossys/controller` | 0.8.23 | 9 | `foundry-governance`, `foundry-check`, `repository-check`, `repository-profile-check`, `repository-package-adoption-check`, `review-check`, `foundry-position-check`, `foundry-completion-evidence-check`, `singular-authority-check` |
| `@clossys/designer` | 0.2.4 | 4 | `designer-token-check`, `designer-brand-check`, `designer-contrast-check`, `designer-environment-check` |
| `@clossys/giver` | 0.1.2 | 1 | `giver-check` |
| `@clossys/influencer` | 0.1.2 | 1 | `influencer-check` |
| `@clossys/inspector` | 0.1.18 | 1 | `inspector` |
| `@clossys/integrator` | 0.6.2 | 1 | `integrator-supersession-check` |
| `@clossys/keeper` | 0.1.2 | 1 | `keeper-check` |
| `@clossys/locksmith` | 0.1.6 | 1 | `vespene-secrets-infisical` |
| `@clossys/messenger` | 0.1.2 | 1 | `messenger-check` |
| `@clossys/observer` | 0.2.3 | 1 | `observer-coverage-check` |
| `@clossys/publisher` | 0.1.10 | 2 | `publisher-media-check`, `publisher-record-check` |
| `@clossys/starter` | 0.1.4 | 1 | `foundry-starter` |
| `@clossys/strategist` | 0.1.1 | 1 | `strategist-check` |
| `@clossys/writer` | 0.3.2 | 1 | `writer-check` |

Evidence: the `bin` key of each published `package.json`, read from the
tarball each package's registry document points at. All 19 tarballs were
downloaded credentiallessly and each one's SHA-512 was confirmed against the
`dist.integrity` value in its registry document before being read.

Four traps in that table:

- **`@clossys/controller` installs 9 executables**, and only two of them start
  with a word resembling the package name. `foundry-governance`,
  `foundry-check`, `foundry-position-check`, and
  `foundry-completion-evidence-check` carry the `foundry-` prefix;
  `repository-check`, `repository-profile-check`,
  `repository-package-adoption-check`, `review-check`, and
  `singular-authority-check` carry no package-derived prefix at all.
- **`@clossys/starter` installs `foundry-starter`**, not `starter-check`.
- **`@clossys/inspector` installs `inspector`**, with no `-check` suffix,
  unlike most of its siblings.
- **`@clossys/locksmith` installs `vespene-secrets-infisical`.** This
  executable name still carries the retired brand. It is the current, correct,
  published name as of `@clossys/locksmith@0.1.6`. A consumer performing a
  global find-and-replace of the string `vespene` across its repository will
  corrupt this invocation. See section 6.

## 4. Version floors

### 4a. Do not adopt the currently published version of four packages

[`governance/release-cleanup/clossys-npmjs-affected.json`](../../governance/release-cleanup/clossys-npmjs-affected.json)
is a closed, value-free inventory of published versions whose npm metadata
carries the retired producer identity. Those versions are immutable and cannot
be corrected in place, so the producer's disposition is a replacement version.

| Package | Affected version | Replacement version | Affected metadata fields |
| --- | --- | --- | --- |
| `@clossys/advisor` | 0.1.3 | 0.1.6 | `repository`, `bugs`, `homepage`, `_from`, `_resolved` |
| `@clossys/advisor` | 0.1.5 | 0.1.6 | `repository`, `bugs`, `homepage`, `_from`, `_resolved` |
| `@clossys/controller` | 0.8.21 | 0.8.24 | `repository`, `bugs`, `homepage`, `_from`, `_resolved` |
| `@clossys/controller` | 0.8.23 | 0.8.24 | `repository`, `bugs`, `homepage`, `_from`, `_resolved` |
| `@clossys/starter` | 0.1.2 | 0.1.5 | `repository`, `bugs`, `homepage`, `_from`, `_resolved` |
| `@clossys/starter` | 0.1.4 | 0.1.5 | `repository`, `bugs`, `homepage`, `_from`, `_resolved` |
| `@clossys/strategist` | 0.1.1 | 0.1.2 | `repository`, `bugs`, `homepage`, `_from`, `_resolved` |

Verified independently: of the 19 published packages, exactly these four carry
a `repository.url` still pointing at the historical producer repository
rather than at `clossys/foundry`. The other 15 already point at
`clossys/foundry`. The inventory is complete and correct.

This affects package metadata only (`repository`, `bugs`, `homepage`,
`_from`, `_resolved`). It does not affect runtime code, the API surface, or
the executables. A consumer that adopts an affected version gets working code
with a stale source link.

### 4b. Floors per package

| Package | Published at observation | Producer replacement | Floor to adopt |
| --- | --- | --- | --- |
| `@clossys/advisor` | 0.1.5 | 0.1.6 | **do not adopt 0.1.5**, floor `^0.1.6` |
| `@clossys/architect` | 0.1.2 | (not affected) | floor `^0.1.2` |
| `@clossys/bouncer` | 0.1.1 | (not affected) | floor `^0.1.1` |
| `@clossys/builder` | 0.7.3 | (not affected) | floor `^0.7.3` |
| `@clossys/butler` | 0.1.1 | (not affected) | floor `^0.1.1` |
| `@clossys/controller` | 0.8.23 | 0.8.24 | **do not adopt 0.8.23**, floor `^0.8.24` |
| `@clossys/designer` | 0.2.4 | (not affected) | floor `^0.2.4` |
| `@clossys/giver` | 0.1.2 | (not affected) | floor `^0.1.2` |
| `@clossys/influencer` | 0.1.2 | (not affected) | floor `^0.1.2` |
| `@clossys/inspector` | 0.1.18 | (not affected) | floor `^0.1.18` |
| `@clossys/integrator` | 0.6.2 | (not affected) | floor `^0.6.2` |
| `@clossys/keeper` | 0.1.2 | (not affected) | floor `^0.1.2` |
| `@clossys/locksmith` | 0.1.6 | (not affected) | floor `^0.1.6` |
| `@clossys/messenger` | 0.1.2 | (not affected) | floor `^0.1.2` |
| `@clossys/observer` | 0.2.3 | (not affected) | floor `^0.2.3` |
| `@clossys/publisher` | 0.1.10 | (not affected) | floor `^0.1.10` |
| `@clossys/starter` | 0.1.4 | 0.1.5 | **do not adopt 0.1.4**, floor `^0.1.5` |
| `@clossys/strategist` | 0.1.1 | 0.1.2 | **do not adopt 0.1.1**, floor `^0.1.2` |
| `@clossys/writer` | 0.3.2 | (not affected) | floor `^0.3.2` |

At the observation instant none of the four replacement versions had been
published: the registry's `latest` was still the affected version in each case.

Since then `@clossys/advisor@0.1.6` has published, and it confirms what section
4a describes. Read from the registry on 2026-09-01, it carries `repository`
`git+https://github.com/clossys/foundry.git`, `bugs`
`https://github.com/clossys/foundry/issues`, and a `homepage` under
`clossys/foundry`, alongside the same two executables 0.1.5 ships and a
provenance attestation. The metadata is corrected and the runtime surface is
unchanged, which is exactly what a replacement version is supposed to be.

`@clossys/controller@0.8.24`, `@clossys/starter@0.1.5`, and
`@clossys/strategist@0.1.2` had still not published at that same reading.
Publication is in progress. Re-check with `npm view <name> version` and adopt
each replacement floor once it resolves. The floors in the table above do not
change when that happens; only their availability does.

### 4c. Newly-required contract fields: what actually changed

This section corrects a belief that appears in the migration lane.

**`firstWave.workItems[].bin` is not new in `@clossys/advisor@0.1.5`.**

The field is required, and the constraint is real: `validateWorkItem` in
`src/assessment.ts` requires `initiativeId`, `targetRepositoryId`,
`deliveryOwnerRef`, `bin`, `invocation`, and `placement` to be non-empty,
and separately requires `bin` to match `/^[a-z0-9][a-z0-9-]*$/` with the
finding `work-item-bin` and the message "bin must name one portable installed
executable."

But it did not arrive in `0.1.5`. Evidence:

- `@clossys/advisor@0.1.3` and `@clossys/advisor@0.1.5` have **byte-identical
  `src/` and `dist/` trees**. `diff -rq` across the two extracted tarballs
  reports differences in `CHANGELOG.md` and `package.json` only, and the
  `package.json` diff is the single `version` line.
- The identical `work-item-bin` validation and the identical required-field
  list are present in `0.1.3`.
- `@clossys/advisor`'s own changelog describes `0.1.4` and `0.1.5` as
  "a bounded forward patch from unchanged runtime and API source so the exact
  package can be qualified for npm trusted publishing and provenance."

**No contract field was newly required by the scope move itself.** At the same
version number across the rename, the public surface is identical. Evidence,
comparing the pre-rename and post-rename qualification records:

| Pair | Bins before / after | Declared export keys before / after |
| --- | --- | --- |
| `@vespeneventures/advisor@0.1.3` to `@clossys/advisor@0.1.3` | 2 / 2 | 1 / 1 |
| `@vespeneventures/controller@0.8.21` to `@clossys/controller@0.8.21` | 9 / 9 | 21 / 21 |
| `@vespeneventures/starter@0.1.2` to `@clossys/starter@0.1.2` | 1 / 1 | 3 / 3 |

The `packageTreeSha1` and tarball digests do differ across each pair, which is
expected: the package name string itself changed inside the tarball.

Likewise `@clossys/controller@0.8.21` to `0.8.23` differs only in
`CHANGELOG.md` and `package.json`, and `@clossys/starter@0.1.2` to `0.1.4`
only in `CHANGELOG.md`, `README.md`, `documents/caller-workflow.md`, and
`package.json`. None of the published `@clossys` version bumps to date carry a
runtime or API change.

**UNVERIFIED: the version at which `bin` first became required.** It is present
in the earliest version reachable on `registry.npmjs.org` (`0.1.3`).
Versions `0.1.0` through `0.1.2` were published only to GitHub Packages under
`@vespeneventures`, which requires authentication this session does not hold,
and the changelog entries for those versions do not mention the field. To settle
it: read `@vespeneventures/advisor@0.1.2` from
`https://npm.pkg.github.com` with a credentialed reader and check
`validateWorkItem`. Practically this does not change the migration: any
consumer moving to `@clossys/advisor` lands on `0.1.3` or later, where the
field is required.

**UNVERIFIED: whether any other package has a comparable newly-required field.**
Ruled out for the scope move itself by the surface comparison above, and ruled
out across every published `@clossys` version pair by the byte-level diffs
above. Not ruled out for changes made **before** the first `@clossys`
publication of each package, for the same GitHub Packages access reason. To
settle it: a credentialed diff of each package's last `@vespeneventures`
tarball against its first `@clossys` tarball.

## 5. Registry and authentication

State this plainly, because it is the item most likely to be over-configured:

- `@clossys/*` is published to **public `registry.npmjs.org`**.
- **No authentication is required to install.** Reads are credentialless.
- **No scope-registry routing line is needed.** `registry.npmjs.org` is already
  npm's default registry, so `@clossys:registry=https://registry.npmjs.org` is
  redundant. Adding it is harmless but is not a migration step.
- Consumers should **remove** their `@vespeneventures:registry=` line rather
  than repoint it. See section 6.
- Consumers should also remove any `//npm.pkg.github.com/:_authToken=` line
  that existed only to reach this family, and retire the token that backed it if
  nothing else uses it.

Evidence: all 19 tarballs and all 19 registry documents were fetched over plain
HTTPS with no `Authorization` header and no `.npmrc`, returning HTTP 200. Each
published manifest declares
`"publishConfig": {"registry": "https://registry.npmjs.org", "access": "public"}`,
and each `dist.tarball` is hosted on `registry.npmjs.org`. Published versions
also carry `dist.attestations`, so provenance can be checked with
`npm audit signatures`.

The producer-side authority for this is
[`governance/package-identity-transition.json`](../../governance/package-identity-transition.json),
whose `candidate` tuple is scope `@clossys`, registry
`https://registry.npmjs.org`, access `public`, repository `clossys/foundry`.

> **Known defect in this repository, not in the published packages.**
> [`.npmrc.example`](../../.npmrc.example) is stale and self-contradictory. Its
> header comment claims "Both installing FROM and publishing TO this scope go
> through GitHub Packages, not public npmjs", which is no longer true, while the
> line beneath it correctly reads
> `@clossys:registry=https://registry.npmjs.org`. It also still carries a
> `//npm.pkg.github.com/:_authToken=` line. Consumers should follow this
> section, not that file. Correcting it is out of scope for this document.

## 6. The two reference forms

`@vespeneventures/` and `@vespeneventures:` are different things. They live in
different files, they are found by different searches, and handling one does not
handle the other. A migration that fixes only the first leaves a broken registry
route; a migration that fixes only the second leaves unresolvable dependencies.

| Form | Example | Where it lives | Correct action |
| --- | --- | --- | --- |
| Package specifier, with `/` | `@vespeneventures/controller` | `package.json`, lockfiles, import statements, CI invocations, governance records | Rename per section 1 |
| Scope-registry config, with `:` | `@vespeneventures:registry=https://npm.pkg.github.com` | `.npmrc`, CI registry setup steps, `setup-node` `scope` inputs | **Remove.** Do not repoint |

Remove rather than repoint, because `@clossys` needs no routing line at all
(section 5). Repointing it to `registry.npmjs.org` leaves a line that does
nothing and implies a routing requirement that does not exist.

Search for both forms independently:

```bash
grep -rn "@vespeneventures/" .    # specifiers
grep -rn "@vespeneventures:" .    # registry routing
```

**A third form exists and must not be rewritten.** The string `vespene` appears
inside at least one current, correct published executable name,
`vespene-secrets-infisical` from `@clossys/locksmith` (section 3). Never run a
bare find-and-replace on `vespene`. Match on the two anchored forms above.

## 7. Do not rescope dated, content-addressed records

Some files are historical records rather than live configuration. Renaming a
package name inside one does not update it; it makes the record assert something
that was never true, and recomputing its digests to match destroys the evidence
the record exists to carry.

Leave a record alone when it has any of these properties:

- **A dated observation field**, such as `asOf`, `observedAt`, or
  `publishedCommit`. The record states what was true at an instant. That
  instant does not move.
- **Content-addressed integrity**, such as `sha512`, `sha256`,
  `packageTreeSha1`, `lineSha256`, or `integrity`. The digest is over the old
  bytes. A renamed body no longer hashes to it, and rehashing asserts the old
  artifact had the new name.
- **A GitHub-Packages-era artifact source**, such as a `reference` field
  pointing at `https://npm.pkg.github.com/download/...`. That URL is where the
  artifact actually came from.

Worked examples in this repository, all of which correctly retain
`@vespeneventures` names:

- [`governance/release-qualifications/advisor-0.1.3.json`](../../governance/release-qualifications/advisor-0.1.3.json)
  records candidate `@vespeneventures/advisor@0.1.3` with `tarball.sha512`,
  `packageTreeSha1`, `publishedCommit`, and a
  `reference` of
  `https://npm.pkg.github.com/download/@vespeneventures/advisor/0.1.3/...`.
  The tarball at that URL is named `@vespeneventures/advisor`. Rewriting the
  name makes all four fields false at once.
- [`governance/package-identity-transition.json`](../../governance/package-identity-transition.json)
  holds the `current` tuple naming scope `@vespeneventures` and registry
  `https://npm.pkg.github.com`. That is the record of what is being migrated
  from. Rewriting it erases the transition.
- [`governance/release-catalog.json`](../../governance/release-catalog.json)
  keeps a target with `"status": "historical"` and scope `@vespeneventures`
  alongside the active `@clossys` target.

The consumer-side rule follows the same shape. In a consuming repository, a
governance record that pins an exact version with an `integrity` digest is a
statement about an artifact that was actually installed. Migrating means adding
a **new** record for the `@clossys` artifact, with its own freshly observed
digest, not editing the old record's name in place.

Applied to a lockfile: do not hand-edit package names in
`package-lock.json` or `pnpm-lock.yaml`. Change the manifest, delete the
lock entry or the lockfile, and let the package manager resolve and record the
new integrity digests itself.

## What this document does not establish

- It does not verify any consumer repository's state. Foundry cannot read a
  consumer's tree and does not claim to.
- It does not establish that any package has been adopted. An install is not an
  adoption. See [`docs/ADOPTION.md`](../ADOPTION.md).
- It does not supersede
  [`docs/contracts/package-lifecycle.json`](package-lifecycle.json), which
  remains the machine-readable authority for the name mapping. Where this
  document and that file disagree, that file wins and this document is the
  defect.
