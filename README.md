# foundry

A small set of TypeScript packages for validating an npm workspace against
what is actually true of it — not against what its own packages claim about
themselves. This repository is public and MIT licensed; current `@clossys`
package releases are **public** on npm. Some source packages have not yet been
released (see Installing, below).

**Thesis:** every check here runs against what is actually on disk or
actually installed — never against what a manifest claims about itself. An
earlier design asked every package to self-report its own shape in a block
inside its own `package.json` and validated that block against itself; an
audit found the block was pure restatement of data already sitting a few
lines away, so it was deleted. See [docs/DECISIONS.md](docs/DECISIONS.md)
for the full account.

## Packages

| Package | What it does |
| --- | --- |
| [`@clossys/starter`](packages/starter) | Foundry Starter is non-role executable tooling for a consumer-owned two-phase adoption workflow: it joins an uncredentialed pull-request evidence snapshot to trusted-base GitHub Actions facts, fixed no-lifecycle-script npm or pnpm installation evidence, Advisor's runner-time execution readiness, and one exact installed target CLI. It rejects arbitrary shell commands, package-runner shortcuts, caller-selected executable paths, stale/foreign evidence, symlinked or escaping evidence files, and inconsistent raw output/exit pairs; it has no runtime dependencies and does not claim a role position, activation, adoption, grounding, or closure. |
| [`@clossys/advisor`](packages/advisor) | The Advisor role — does each active engagement have a current, evidence-backed, authority-bound next decision or action? Provider-neutral sponsor dialogue, engagement-state reconciliation, offering-fit and readiness assessment, blocker and initiative-collision detection, bounded first-wave recommendations, required next actions, reassessment triggers, and an execution gate that never treats unresolved pre-work as passive HOLD. |
| [`@clossys/architect`](packages/architect) | The architect role — do declared operating boundaries match how material changes actually cross systems? Provider-neutral topology contracts, the ontology API under `./ontology`, compatibility comparison, and architecture-exception assessment behind `architect-check`. It proposes changes but does not authorize or materialize provider resources. |
| [`@clossys/bouncer`](packages/bouncer) | The bouncer role — is this actor who they claim, and is what they are doing still inside what they were granted? A grant and provider-observation schema in which a session proves nothing, a runtime verdict that is a ternary (`authorized` / `denied` / `unverifiable`, because a provider that did not answer is neither of the other two), an isolated `./agent` subpath for delegated machine actors, provider adapters isolated behind `./providers/clerk` and its web/client/server/proxy subpaths so the root stays provider-neutral, and three gates behind one `bouncer-check` bin: authority reconciliation, delegation ceiling, and provider contract. An unreachable provider exits `2`, never `0`. Recut from `auth` (issue #458). |
| [`@clossys/controller`](packages/controller) | Owns every rule: package lifecycle records and no-write bootstrap planning at its root; focused subpaths provide workspace catalog, gates, release proof, caller-owned repository profiles and requirements evaluation, pure caller-supplied cross-plane composition, review evidence, workspace-cleanup classification, account-neutral agent conventions, and the content-addressed policy-binding primitive. It is the current package; its historical consolidation of the retired `governance`, `conventions`, and `policy` package names is recorded in issue #282. |
| [`@clossys/builder`](packages/builder) | Declared reality made actual: an idempotent provisioning-manifest engine and machine verification at its root, deployment-surface contracts and read-only provider inspectors under `./deployment`, a toolchain pin (runtime, package manager, build order), the shared `liveStateSurface` reconciliation contract (`verified` / `drifted` / `could-not-verify`, with a named-blocker requirement for the last), and importable CI gate mechanics with an installed `builder-verify-toolchain` CLI under `./ci`. One runtime dependency (`@clossys/controller`). |
| [`@clossys/butler`](packages/butler) | The butler role — do we have what this person wants, this request in their own confirmation and their standing instructions still current? A three-state want model (absent/denied/granted) plus a computed `stale` evaluation, so absence can never be read as permission; intents carrying a confidence read against a caller-declared floor; host-supplied storage and audit ports; an `./inbound` subpath for channel admission and an optional `./web` subpath whose React peer is asserted at import time. Three gates behind one `butler-check` bin: confirmation completeness, currency, and withdrawal parity. Carries no topics, no jurisdiction logic and no obligations, and makes no claim of legal compliance. Zero runtime dependencies. |
| [`@clossys/giver`](packages/giver) | The giver role — did this person get what they asked for, or a reason, or a human, and everything we owed them on time? A runtime verdict that is a ternary (`delivered` / `refused` / `handed off`, because a request handed to a person is not a request answered), an obligation ternary (`discharged` / `breached` / `unprovable`), and a decision core in which no collaborator is optional and no default is permissive: an indeterminate read cannot become a delivery, and cannot become a bare refusal either, because neither has a value it could be written as. Carries the precedence rule between a standing refusal and a thing we owe, reads the standing decision across a declared document seam, and owns a second versioned record of retained decision grounds that another role can inspect without importing it. Three gates behind one `giver-check` bin: hand-off placement, grounding, and obligation discharge — where a recorded send whose own state says it failed is a breach, not a delivery. Ships no obligation, no register and no jurisdiction logic; makes no claim of legal compliance. Zero runtime dependencies. |
| [`@clossys/keeper`](packages/keeper) | The keeper role — does everything we hold about this person trace to something they did, and can they see it and correct it? Held items that each name the source event they came from, including beliefs inferred from behaviour, so "why do you think that about me" is answerable; a runtime verdict that is a ternary (`held` / `forgotten` / `unjustifiable`) in which every basis for keeping something names a source event, so a holding justified by nothing the person did has no shape to be written in; and the boundary rule as a type — an understanding only informs, an instruction constrains, and a belief that constrains carries a confirmation field written explicitly or `null` on purpose. Three gates behind one `keeper-check` bin: attribution, visibility, and disposal. Visibility reads `giver`'s versioned retained-grounds JSON document without importing or duplicating it, and reports an unreachable decision ground distinctly from an unreachable holding. Disposal compares the declared retention schedule against the records rather than checking that a policy exists, and reports a class the schedule never covered as unverifiable rather than clean. The store is host-supplied through ports, because git cannot delete and this role must; no person-attributable record is ever written here. An optional `./web` subpath carries the showing step, where being forgotten is reachable through the same call shape as being shown. Ships no retention period, no holding class and no jurisdiction logic; makes no claim of legal compliance. Zero runtime dependencies. |
| [`@clossys/integrator`](packages/integrator) | Whether a consuming plane holds what it declared it holds, and whether it is current: an entitlement declaration where every opt-out carries a required reason, an installed-inventory reader over the plane's own manifests and lockfile through an injected filesystem port, a version reconciler producing the upgrade set, an admission contract for a package entering the catalogue, a reachability probe over injected transport, and a supersession detector for a manifest holding both a package published here and a name it replaces. Its states are a discriminated union — `current`, `behind`, `absent-with-reason`, `absent-without-reason`, `unreachable`, `unauthenticated` — so an absence that is a decision cannot be confused with one that is drift, and a credential that can see nothing cannot be read as an empty registry. Ships the mechanism a plane runs against itself; holds no inventory of consumers, and the supersession map is entirely caller-supplied. |
| [`@clossys/influencer`](packages/influencer) | The influencer role — is this governed organization or product presence producing qualified audience responses at the declared rate? It runs bounded channel and cadence experiments through injected action ports, measures independently observed qualified responses per 1,000 eligible exposures, and preserves unreadable or insufficient evidence as indeterminate. V1 cannot represent paid spend or a person as the presence subject, and it never generates or approves content, holds credentials, or impersonates anyone. |
| [`@clossys/observer`](packages/observer) | What actually happened, and whether the gates were worth having: a telemetry contract declaring where the log really lives, retention, and redaction proven by test rather than asserted by comment; and gate efficacy computed purely from caller-supplied run history through an injected port. Reports `observed` / `unobserved` / `could-not-read`, never collapsing an unreadable history into a pass. Its two metrics — unobserved surface, and escape rate — are structurally prevented from combining into one score, and it never imports the gate it measures, because the measurer must not be the measured. |
| [`@clossys/locksmith`](packages/locksmith) | Keys end to end: custody (who owns a key, where it lives), rotation (age against policy, with an explicit `unverifiable` state for a key whose last rotation cannot be observed), revocation records, a distribution manifest saying which principal may resolve which name, and the provider-neutral resolution contracts with injected clients and an isolated Infisical subpath. Handles names, owners, ages and digests only — no code path can read, log, or serialize a secret value, and a test asserts it. |
| [`@clossys/messenger`](packages/messenger) | The messenger role — did each authorized, finished communication reach its transport destination within its declared window, according to independently observed delivery evidence? Provider-neutral dispatch, a Resend provider subpath, and `messenger-check delivery-closure` with satisfied, violated, and indeterminate outcomes. It does not admit inbound person requests or decide semantic obligation discharge. |
| [`@clossys/inspector`](packages/inspector) | The gate that judges a change before it lands: a secret-scan attempt, a change's task record, its review evidence, and drift between a declared standard and the live state enforcing it. Every check is a pure function of caller-collected observations, reports the `satisfied`/`violated`/`indeterminate` ternary rather than a boolean, and folds into a `0`/`1`/`2` exit contract with no flag that can turn a could-not-evaluate into a pass. Its `./secret-scan` subpath is the mechanism the root is the judge of: verified gitleaks download and an injected-executor scan that produces the same observation shape a caller can also hand-build, so the gate can now run the scan rather than only attest that one happened. Also holds itself to a minimum-safe-version floor. Its escape rate is measured by `observer`, never by itself. |
| [`@clossys/designer`](packages/designer) | The designer role — is it well made? Tokens, CSS, icons, accessible primitives, blocks, shell elements and charts, with server-safe entry points for React Server Components, and three gates: `designer-token-check`, `designer-brand-check`, `designer-contrast-check`. Recut from `ui` (decision 10). |
| [`@clossys/strategist`](packages/strategist) | The strategist role — is it true, and is it us? Dependency-free validators for a consumer's own strategy records, a typed reader over a strategy directory, and three gates behind one `strategist-check` bin: facts traceability, brand coverage, and direction currency. Recut from `strategy` (decision 10). |
| [`@clossys/writer`](packages/writer) | The writer role — is it well said? A consumer-authored, versioned copy registry where only approved entries resolve, voice validation, and four gates behind one `writer-check` bin: traceability, addressability, voice-derivation coverage, and locale coverage. Recut from `copy` (decision 10). |
| [`@clossys/publisher`](packages/publisher) | The publisher role — did we put it out to an audience, and can we prove what shipped? Page-level web views, media contracts and channel renderers (web, email, print, image, slides), plus an append-only publication record with fact-citation drift and join-key checking on its `./record` subpath. It contains the historical surface and ledger capabilities described in decision 10; the record does not import the composer. |

Each package's own README has the full API and the reasoning behind it.

### What these packages are not

Two names in the table above mean something narrower here than the word
usually means elsewhere. Both have already cost a consumer real
investigation time before they opened the README and found out:

- **`policy` is not an authorization or access-control engine.** It does
  not decide allow, deny, step-up, or review for anything. It is a
  content-addressed digest-commitment primitive: compute a document's
  digest, commit only the digest, and later verify a materialized copy
  matches it byte-for-byte, without ever committing or transmitting the
  document itself. A codebase can genuinely need both an authorization
  engine and this — they solve unrelated problems, and neither is a
  substitute for the other.
- **`ledger` is not content-distribution or package-export tooling.** It
  is a fact-citation drift checker: an append-only record of what was
  published, citing which strategy facts, and a checker that answers
  whether each cited fact's value still holds against a caller-supplied
  current value. It does not distribute anything and does not export a
  package.

The cross-package ownership and adoption plan is in
[docs/COMMUNICATIONS.md](docs/COMMUNICATIONS.md).

The table is a source-tree inventory, not a promise that every named package
is available in the registry. Dependent packages publish only after their
runtime siblings, and every such release is proved from an isolated install
of its selected tarball. The required order for the core release graph is
documented in [docs/PUBLISHING.md](docs/PUBLISHING.md).

For historical background on the predecessor delivery pipeline, see
[the archived product delivery pipeline](docs/PIPELINE.md). Current package
boundaries are documented by the Strategist, Writer, Designer, and Publisher
package READMEs and their lifecycle records.

## Installing

The current `@clossys` public npm Trio is published and verified through npm
trusted publishing with provenance: Advisor 0.1.5, Starter 0.1.4, and
Controller 0.8.23. Public packument and tarball access, exact served-byte
parity, and the immutable qualification records are retained for each current
release. The original owner-present identities remain historical evidence; they
are not current installation pins.

Consumers may use the exact current versions through ordinary credentialless
public npm resolution. Install only the package or packages a consumer needs,
using exact pins rather than a floating `latest` tag. Publication and
installation remain distinct from consumer adoption, independent grounding, or
closure. Strategist 0.1.1 has owner-present first-publication evidence.
Strategist 0.1.2, Writer, and Designer are reviewed qualification candidates,
not published packages; each later publication needs its own
immutable, package-neutral record joined to the exact qualification, catalogue
entry, candidate tarball, anonymous served bytes, and applicable publisher
provenance when a separately evidenced trusted-publisher release exists.

Do not add a token or a private registry mapping for `@clossys`. The canonical
source tuple is declared once in [`package-scope.json`](package-scope.json).
The original first identities were owner-present publications; the current Trio
versions are the later trusted-publisher releases. Provider state is now
value-free verified for each current Trio member: Publishing access requires
2FA and disallows traditional publish tokens. Publication or installation does
not prove consumer adoption, independent grounding, or closure; those require
separate consumer-owned evidence.

### Historical `@vespeneventures` packages

The predecessor `@vespeneventures/*` versions remain published and
installable from GitHub Packages as immutable historical artifacts. GitHub
Packages requires a classic personal access token with `read:packages`, even
for a public package. A consumer that deliberately retains one of those old
versions owns this historical configuration (never commit a real token):

```ini
@vespeneventures:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
```

That authenticated lane is not current `@clossys` installation guidance and
does not authorize mixed first-party namespaces. The lifecycle and visibility
contracts continue monitoring those still-published old names until W1E
records the new registry truth; they are not rewritten as retired merely
because their source successor has a different name.

## Usage

`controller`'s `./gates` subpath ships a CLI, `foundry-check`, that walks a workspace's
`packages/` directory and reports what it finds:

```bash
npx foundry-check --scope @your-scope
```

Exit code `0` means no error-severity finding, `1` means at least one, and
`2` means the check itself could not run (bad input, an unreadable root).

Programmatic use:

```ts
import { runFoundationCheck } from "@clossys/controller/gates";

const report = runFoundationCheck(process.cwd(), { scope: "@your-scope" });
for (const finding of report.findings) {
  console.error(`[${finding.severity}] ${finding.rule}: ${finding.message}`);
}
if (report.findings.some((f) => f.severity === "error")) process.exitCode = 1;
```

## Developing

```bash
npm install
npm test
npm run build
```

Every package targets Node 20+, ships ESM only, and emits its own type
declarations.

## Contributing and publishing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the day-to-day workflow. Every
package here moves through seven states, each ending on evidence rather than
on someone's say-so; [docs/LIFECYCLE.md](docs/LIFECYCLE.md) states them, and
records where each package actually stands. Adding
and publishing a package is a separate, maintainer-only process, documented
in [docs/PUBLISHING.md](docs/PUBLISHING.md); the safety machinery that
guards it is described in [SECURITY.md](SECURITY.md). Design decisions —
including why packages publish to GitHub Packages and why an earlier
metadata schema was removed — are recorded in
[docs/DECISIONS.md](docs/DECISIONS.md). Security reports go through
[SECURITY.md](SECURITY.md), not the public issue tracker.

## Licence

MIT.
