# Decisions

The identity decisions below are made, not placeholders, so a future reader
doesn't have to reconstruct the reasoning from git history.

## 1. The publishing scope — `@clossys`

**Status:** set in [`package-scope.json`](../package-scope.json).

The transferred `clossys/foundry` producer owns the complete nineteen-package
source catalogue. W1D recuts that catalogue atomically; it does not publish a
package or activate provider trust.

The closed transition is applied only through the history-aware setter:

```bash
node scripts/set-package-identity.mjs --to-candidate
```

It updates every manifest, first-party dependency edge, local workspace lock
identity, repository tuple, release catalogue, and finally the single scope
declaration. `set-scope --check` remains a structural drift check; it is not a
second transition mechanism.

## 2. The registry — public npm Trio published through trusted publishing

**Status:** `https://registry.npmjs.org`, scope `@clossys`, and explicit public
access are declared together in [`package-scope.json`](../package-scope.json).
All package manifests carry the same tuple. W1D left publication and OIDC trust
inert. W1E first published and anonymously verified the owner-present Trio
identities, then verified trusted-publisher forward releases with npm
provenance: Advisor 0.1.5, Starter 0.1.4, and Controller 0.8.23. Publication
and installation are not consumer adoption, independent grounding, or closure.

The old namespace and GitHub Packages releases remain immutable historical
evidence. They are not deleted, rewritten, forwarded, or treated as current
installation guidance.

### Historical GitHub Packages operating decision

The following trade-off records the superseded operating lane and why it was
chosen at the time. It remains evidence, not current installation guidance:

- Installing needs a GitHub **classic** personal access token with
  `read:packages` — a GitHub Packages platform behavior that applies to every registry read
  regardless of visibility, not a permissions choice made here. Package
  visibility is a separate, per-package decision (see
  [docs/PUBLISHING.md](PUBLISHING.md#package-visibility)), not a consequence
  of the registry choice itself.
- Public npmjs would make "anyone can install this, no token required"
  literally true. It was planned, worked on, and then **cancelled** — see
  [issue #213](https://github.com/clossys/foundry/issues/213), which
  supersedes the migration issue (#194) and the credentialless acceptance
  criteria in its umbrella program (#196). Both are closed as not planned.

  GitHub Packages was therefore the canonical adoption lane at that time.
  Consumers authenticated through whichever plane owned their package
  credentials. Decision 18 later replaced that lane only after its bounded
  producer-owned cutover passed the transfer and whole-catalogue gates; it was
  not a package-by-package exception.

  The reasoning, since "we changed our mind" is not a reason: the first
  step of that migration was verifying and, if unclaimed, **claiming
  `@vespeneventures` on npmjs** — a first-come registration on a shared
  public namespace, with no supported way to return a name to unclaimed and
  no recourse for a dispute except npm support. Every later step was
  recoverable; that one was not. What it bought was credential-free install
  for a reader with no relationship to this org, and no such reader was
  waiting: every actual consumer already authenticates through a plane that
  holds package credentials. Paying an irreversible cost for a hypothetical
  adopter is exactly the trade this repository's own conventions tell it not
  to make — see `CONTRIBUTING.md`'s "Supported configurations: the default
  answer is also no."

  This is recorded rather than deleted because the question recurs. A reader
  who notices the token requirement will wonder whether it is an oversight;
  it is not, and the answer should be one link away rather than a
  rediscovery. The bar to revisit is the same one any speculative capability
  faces here: a real consumer that needs it, not one that might.

- Each consuming plane owns its scope mapping, token reference, and local or CI
  injection. Foundry documents the protocol but never stores consumer
  credentials or account-specific installation manifests.
- Publishing remains a separate protected lane. The workflow uses its
  job-scoped `GITHUB_TOKEN` for uploads and a read-only package-index
  credential for the owner-wide collision query; a consumer read credential
  is not a publish credential.
- Existing GitHub Packages names and versions remain published. They are not
  deleted, yanked, copied to a second registry, or reused for a different
  package.

### A standing property of that registry: optional peers install as required

**Status:** documented, not worked around. [Issue #226](https://github.com/clossys/foundry/issues/226)
confirmed, with a control query, that the GitHub Packages packument omits
`peerDependenciesMeta` for every version it serves — `peerDependencies`
comes back complete, `peerDependenciesMeta` comes back empty, from the same
authenticated request. The tarball's own `package.json` is correct; the loss
happens when GitHub Packages assembles the metadata document an installer
actually reads, before any tarball is fetched.

This was always possible the moment #213 (above) made GitHub Packages the
canonical, non-transitional registry: it is a property of *this* registry,
not of publishing from this repository in general, and choosing this
registry means living with what it does and doesn't serve. While the
registry question was still open, a gap like this would have been a reason
to keep looking; settled, it is a consequence to record next to the choice
that produced it, not a reason to revisit #213 itself.

Six packages currently express optionality through `peerDependenciesMeta` —
`ui`, `auth`, `surface`, `consent`, `comms`, and `governance` — and all six
are affected identically: every consumer installing from this registry gets
every declared peer as a hard requirement, regardless of which subpath it
actually imports. The declarations themselves are not changing. They are
correct in the tarball, they are what a reader of the package's own
`package.json` sees, and they become correct for installers too the day
GitHub Packages starts serving the field. What changed instead is the
documentation: each affected package's README now states its own effective
install behaviour on this registry, and [docs/ADOPTION.md](ADOPTION.md)
records it where adoption expectations are set. See issue #226 for the full
evidence, the options considered, and why splitting packages or moving
peers into `dependencies` were not taken.

### Why the name-collision gate runs before every publish, unconditionally

GitHub Packages namespaces npm packages by **owner account**, not by
repository. Publishing a name an account already owns under a *different*
repository does not fail — it silently appends a version to that existing
package and moves its `latest` dist-tag. The failure is silent at publish
time, which is exactly the kind of mistake that's cheap to prevent and
expensive to notice after the fact.

Foundry is the only repository under this owner authorized to publish packages,
but non-publishing account-control-plane repositories may coexist.
`scripts/check-name-collision.mjs` still runs before every publish because a
gate that only runs when someone remembers it is "probably fine" is not a gate.
See `docs/PUBLISHING.md` for what it checks and why it is ordered first.

## 3. The GitHub organization — transferred producer

**Status:** `clossys/foundry` is the public neutral producer. The prior
producer and its issue/package URLs remain only where retained as exact
historical evidence.

Every published package carries `repository`, `bugs`, and `homepage` URLs
pointing at its own repository, so the org name is unavoidably public
metadata — this is the org a reader is meant to see. The denylist for this
repository (see `SECURITY.md`) has no rule that matches this org's own name,
so no neutralize/exception entry is needed for it to describe itself.

## 4. Deleting the `contract` metadata schema

**Status:** removed. `@vespeneventures/contract` and the `contract` block
it defined — previously required in every package's `package.json` — no
longer exist in this repository.

`contract` asked every package to self-report six fields in a block inside
its own `package.json`, and validated that block's shape. An audit found
that all six fields were mechanically derivable from data already present
in the same `package.json`: the real `dependencies` and `peerDependencies`
fields, the package's own directory, its own name. The block was applied to
144 packages by a script that made zero judgment calls — it filled in the
same six fields the same mechanical way everywhere — and across all 144
packages, `contract`'s own validation produced zero findings.

Zero findings from 144 mechanically-generated blocks is not evidence the
packages were sound. It is evidence the check was validating its own
output. A gate that is satisfied by deriving its answers from the exact
thing it is checking is a tautology — it can never fail, and a check that
can never fail is not a check.

The fix was not a stricter schema. It was deleting the schema and computing
every one of its questions from data that was always real: whether a
package's dependency actually resolves is now answered by reading its own
`dependencies`/`peerDependencies`, not a separately-maintained declaration
of the same fact. `@vespeneventures/controller/catalog` answers exactly that question,
from exactly that data — see its README. Every package remaining in this
repository shares the same thesis: a check runs against what is actually on
disk or actually installed, never against what a manifest claims about
itself.

A historical `@vespeneventures/contract@0.1.0` publication no longer appears
in the current registry. Its removed name is nevertheless unavailable for a
new package; see [docs/PUBLISHING.md](PUBLISHING.md) for that historical
identity rule.

## 5. Deleting `web-charts` and `web-storage`

**Status:** removed. Both packages previously published from this
repository have been deleted from the tree.

They are removed for now, not retired as a judgment about their design —
they may be recreated later. Their removal is a scope decision, not a
finding about the mechanism the remaining four packages exist to enforce.

---

## 6. Retiring `domain-model`

**Status:** retired from the registry after the supported consumers migrated
to `@vespeneventures/domain@0.2.0`.

The original package name was retained temporarily only as a compatibility
re-export. It has now been removed from this repository and the registry; it
is not republished. The lifecycle record retains the replacement and migration
evidence so historical package state remains auditable without leaving an
installable compatibility surface.

---

## 7. Consolidating `tokens` and `voice`

**Historical decision — superseded by the current lifecycle and registry
contract.** The package names and consumer instructions in this section record
the earlier consolidation only; they are not current installation or migration
guidance.

**Status:** `@vespeneventures/tokens` and `@vespeneventures/voice` are
deprecated registry artifacts. Their source packages were consolidated into
`@vespeneventures/ui` and `@vespeneventures/copy`, respectively, on
2026-08-11.

The former packages remain published while consumers migrate, because a
registry release cannot be safely erased from the history an installer may
already resolve. New work uses the replacement packages and their focused
subpaths: `@vespeneventures/ui` for tokens and styles, and
`@vespeneventures/copy` or `@vespeneventures/copy/voice` for the voice
contract. The consumer migration checklist in
[docs/PIPELINE.md](PIPELINE.md#consumer-integration-checklist) is the durable
handoff; no compatibility re-export is retained in this workspace.

---

## 8. Consolidating package-process surfaces under `governance`

**Historical decision — superseded by decision 9.** The package names and
compatibility state in this section describe the earlier recut only; the
current lifecycle and registry contract is authoritative.

**Status:** the supported package-process surface is
`@vespeneventures/governance@^0.2.0`. Its `./catalog`, `./gates`,
`./release`, `./repository`, and `./review` subpaths own the corresponding
public contracts and CLIs.

`@vespeneventures/catalog`, `@vespeneventures/gates`,
`@vespeneventures/release`, `@vespeneventures/repository`, and
`@vespeneventures/review` remain as deprecated compatibility packages while
consumers migrate. They preserve their existing root imports, the review
GitHub subpath, and the `foundry-check`, `repository-check`, and
`review-check` command names by delegating to the matching governance
subpath. They are registry migration artifacts, not additional supported
package choices.

This keeps package lifecycle, discovery, gates, release proof, repository
profiles, and review evidence in one package-process ownership boundary while
preserving installed-consumer compatibility. The legacy names must not be
unpublished or reused; their retirement requires the documented consumer
migration and later lifecycle evidence.

---

## 9. Recutting the workspace surface into six job-shaped packages

**Status:** the supported workspace-facing surface is six packages, each named
for the human job it would otherwise be: `controller`, `inspector`, `builder`,
`locksmith`, `integrator`, and `observer`. The product-facing tier — `auth`,
`comms`, `consent`, `copy`, `domain`, `ledger`, `strategy`, `surface`, `ui` —
is unchanged by this decision.

This supersedes decision 8 in one direction only: `governance` remains the
package-process authority, but it is renamed and merged into `controller`, and
the five compatibility packages that decision preserved are retired rather than
carried forward again.

### Why a job, and not a thing

A package named for a thing has no natural metric, so nothing ever says whether
it is working. A package named for a job has one by construction. Each of the
six states its metric in its own README, and each judges in at least three
states so that "could not evaluate" can never be reported as "fine".

### The three failures this cut is derived from

Each is measurable in this repository's own history, not argued from taste.

**One job with no owner.** Secret handling was split across three packages —
resolution contracts, scanning, and environment state — with the reconciling
half belonging to nobody. Nothing in the catalogue rotated a key. `locksmith`
exists because a five-package cut was tested and would have split key custody
back across integration and environment state, reproducing this deliberately.

**One job with several names.** `catalog`, `gates`, `release`, `repository` and
`review` are five published names for one concern, all five deprecated shims
re-exporting subpaths of a sixth, all five with zero consumers, and nothing in
the catalogue ever reported the situation. Decision 8 created them for a real
reason — installed-consumer compatibility during a rename — and that reason
expired without anything noticing.

**A measurer that is also the measured.** `observer` is deliberately separate
from `inspector` and must never import it. Gate efficacy computed by the gate
is the system grading its own homework, which is the failure that produced a
gate printing an incomplete verdict and exiting `0`.

### On retiring the compatibility packages

The five names must not be unpublished or reused. Their published versions stay
resolvable, so a consumer pinned to one keeps working; they are deprecated with
a replacement pointer rather than deleted from the registry.

The same applies to the names this recut renames — `secrets`, `provisioning`,
`deployment`, `verify-standards`, `secret-scan`, `governance`, `conventions`
and `policy`. Each keeps its published versions and gains a lifecycle entry
naming its replacement. A rename that strands an installed consumer with no
recorded path forward is the same defect as a fix that cannot travel.

### What is deliberately recorded as unresolved

`controller` is the largest merge here and the likeliest to need re-splitting:
it unifies two mature packages whose metrics genuinely differ — whether a
verdict is well-formed, versus whether a name conforms — on the claim that both
are rules. The seam is recorded now so that a future split is a decision rather
than a discovery.

`observer` collides with an established pattern name in this ecosystem. The
collision was raised, weighed and accepted, because within this catalogue the
register is human jobs and every sibling name reads that way.

### What resolves where

This is a rename and a merge, not a rewrite — no export, argument shape, or
return type changed. Every subpath previously reachable under the absorbed
names resolves, unchanged in shape, under its new package:

- `governance` becomes the `controller` root plus `./catalog`, `./gates`,
  `./release`, `./repository`, `./review`, `./review/github`, `./artifacts`,
  `./cleanup`, and `./composition`
- `conventions` becomes `./conventions`, `./conventions/documents/*`, and
  `./conventions/adapters/*`
- `policy` becomes `./policy`
- `secrets` becomes the `locksmith` root, alongside the four verbs it lacked
- `provisioning` becomes the `builder` root; `deployment` becomes
  `./deployment`
- `verify-standards` becomes the `inspector` root; `secret-scan` becomes
  `./secret-scan`

### No forwarding stubs

An intermediate version of this recut kept `governance` and `policy` as thin
published stubs forwarding to the matching `controller` subpath, because seven
packages in this workspace still imported them directly. Five of those seven
were the compatibility packages retired above; the remaining two — `ledger` and
the package that became `inspector` — were repointed at `controller` instead.

With no in-workspace consumer left, a stub would be kept only for its own sake,
and that is precisely the debt this decision exists to remove: decision 8
created five such stubs for a real reason, the reason expired, and nothing
noticed for months. The published versions of every absorbed name stay
resolvable on the registry and carry a deprecation record naming their
replacement, which is what actually protects an installed consumer. A source
stub protects nobody who is not already served by that.


---

## 10. Recutting the expression surface into role-shaped packages

Decision 9 recut the workspace's operation surface into six job-shaped
packages. This is the same cut applied to the expression surface, and it rests
on the same rule stated more precisely:

> If the name is a thing rather than a doer, it is an artifact — and an
> artifact belongs inside a role.

The now-retired historical package names `strategy`, `copy`, `ui`, `surface`,
and `ledger` were all things. None named who was accountable for anything, so
none could be asked a question it alone must answer. Their current role
packages are:

| role | from | the question only it answers |
| --- | --- | --- |
| `strategist` | `strategy` | Is it true, and is it us? |
| `writer` | `copy` | Is it well said? |
| `designer` | `ui` | Is it well made? |
| `publisher` | `surface` + `ledger` | Did we put it out to an audience, and can we prove what shipped? |

### Why four and not five

`publisher` is one package, not two. Composition without a record is
unprovable, and every time the publisher runs, the record runs — there is no
publish that legitimately skips it. That argues for one install and one
version, which one package with a `./record` subpath delivers.

The measurement that argued for two is accommodated rather than overturned:
the record shares no code with the composer and does not import it, so the two
import surfaces stay genuinely separate under one version. Fusing the
*packaging* was never the same as fusing the *dependency graph*, and only the
second would have cost anything.

### What is renamed, and what deliberately is not

The package is named for the job. The vocabulary inside it is not touched.
`strategist` keeps `readStrategy`, `StrategyBundle` and a `strategy-dir`
argument, because a role owns artifacts and renaming the role does not rename
what it reasons about. A sweep that renamed the vocabulary too would have made
the diff unreviewable while changing no behaviour.

### No forwarding stubs

Same conclusion as decision 9, for a reason that is decisive rather than
stylistic. Each donor is deprecated-and-retained: still installable for a
consumer already pinned to it, declared in
`docs/contracts/package-retention.json` with a reason and a `reviewBy`, and
carrying `forwardsToReplacement: false`.

A stub would keep the old name importable. A supersession check could then
never reach zero, so the forwarding layer would defeat the very gate built to
prove the swap completed. A gate that cannot reach its own satisfied state is
decorative.

### What this decision does not do

It does not migrate any consumer. Publishing a role-named package and
deprecating its donor changes nothing in a consuming repository until that
repository chooses to move. Adoption is separate, later, and sequenced against
one constraint learned from the operation lane: **publish first, entitle
second.** A consumer that entitles a role name before it is published, and
whose entitled set is mostly renamed packages, gets a confident
`unauthenticated` verdict — a credential diagnosis for what is really "not
published yet".

---

## 11. A gate behind a `bin`, or a declared primitive

> **Partially superseded by [decision 12](#12-promoting-domain-machinery-into-the-architect-role)
> and [decision 13](#13-recutting-finished-message-transport-into-the-messenger-role).**
> The gate rule remains. Decision 12 replaces the `domain` primitive
> conclusion; decision 13 resolves the transport role and expands Program C.

**Historical status:** the gate rule below still governs every package in
`packages/`. When this decision was recorded, the contract declared a
`foundation` programme marked `"tier": "primitive"`, with `domain` as its
first member. Decision 12 removes that membership while retaining the rule.
The rule is graded by
`scripts/check-package-programs.mjs`, which already owned every package's
programme membership and lifecycle state. Program C's four roles are named and
their questions fixed here; all four are now published, and this decision
creates no package.

### Current executable-tooling classification

`docs/contracts/package-evidence.json` now has an explicit
`executable-tooling` category for a public package that supplies deterministic
delivery mechanics but is not a role. Such a package is absent from
`role-loop-archetypes.json`: it does not acquire a job question, metric, mode,
position, adoption, grounding, or closure by carrying a CLI. It must still
ship that executable; `shipsNoGate` is not available to it. The first member,
Foundry Starter (`@vespeneventures/starter`), distributes typed fixed-install, evidence-join, and
direct-installed-CLI mechanics as an npm package plus a consumer-owned thin
workflow, never as a remote composite action. This is a clarification of the
gate rule, not a new role or an exception to it.

Decisions 9 and 10 wrote down half of what every package here is actually held
to: it names a doer rather than a thing, and answers one question only it can
answer. The other half was never written down and is near-universal in the code
anyway — a role package ships a gate behind a `bin`, so a consumer's own CI can
fail on it. The retained donors `auth`, `comms` and `consent` do not; their
Program C replacements own the gates. At the time, `domain` did not because
the contract declared it a primitive. From outside the tree those two
situations were the same thing: an absent `bin`.

> A package either belongs to a program — in which case it names a doer,
> answers one question only it answers, and ships a gate behind a `bin` — or it
> belongs to the primitive tier, in which case it declares that it ships none,
> and why.

This turns "no `bin`" from an absence into a decision, which is the principle
[`docs/contracts/package-retention.json`](contracts/package-retention.json)
already states in the other direction: "a standing exemption with no expiry is
the same failure as an absence with no declared reason, just wearing the other
sign."

### The programs, and who each addresses

A program is identified by its addressee, not by its subject matter. Three are
cut; a fourth is named so its absence is a decision rather than an oversight.

| program | addresses | packages |
| --- | --- | --- |
| operation | a repository | `controller`, `inspector`, `builder`, `locksmith`, `integrator`, `observer` (decision 9) |
| expression | an audience | `strategist`, `writer`, `designer`, `publisher` (decision 10) |
| interaction | one person | `bouncer`, `butler`, `giver`, `keeper` (issue #458) |
| transaction | an organisation under agreement | not cut, and nothing here waits on it |

### The historical primitive conclusion (superseded)

The decision reasoned that a primitive has no addressee. With no addressee
there is no role, with no role there is no question only it answers, and with
no such question there is
nothing for a gate to judge. It declared `domain` the first member because it defines
identifiers, typed fields, closed vocabularies and relations, and ships no
values, storage, authorization, provenance or lifecycle of its own. What a
`domain` gate would check is the consumer's model, and whether that model is
right is the consumer's judgment, not this package's.

Membership is declared, never inferred from a missing `bin`, and the two kinds
of declaration are deliberately not interchangeable. A primitive declares
`shipsNoGate` with `permanent: true`: there is no work to track. At the time,
`auth` and `consent` declared the same field with their retirement issue
because their Program C replacements owned the gates, while `comms` remained a
donor with an unresolved split. These countdowns remain distinct from a
permanent primitive claim, and the gate refuses a permanent claim from a
package that belongs to a programme.

### Program C's historical four roles (expanded by decision 13)

| role | everything about | the question only it answers |
| --- | --- | --- |
| `bouncer` | who you are, what you can do, how that changes | Is this actor who they claim, and is this inside what they were granted? |
| `butler` | what you want — now, and standing | Do we have what this person wants, in their own confirmation, and still current? |
| `giver` | what you get — asked for, and owed | Did they get what they asked for, a reason, or a human — and everything owed, on time? |
| `keeper` | what you gave us, and what we understand from it | Does everything we hold trace to something they did, and can they see and correct it? |

Order is the request path: `bouncer`, then `butler`, then `giver`, with
`keeper` read throughout.

### Program C donor migration

`auth` is deprecated in favour of `@vespeneventures/bouncer` at `^0.1.0`.
Replace its imports deliberately and preserve the provider boundary documented
by `bouncer`; no forwarding package keeps the old name alive.

`consent` is deprecated across two explicit destinations. Move consent records
and current standing instructions to `@vespeneventures/butler` at `^0.1.0`;
move enforcement and proof of owed delivery to `@vespeneventures/giver` at
`^0.1.1`. No forwarding package hides that split. Existing published donor
versions remain resolvable during migration, subject to the time-bounded
retention entries in `docs/contracts/package-retention.json`.

GitHub Packages currently cannot apply npm's registry deprecation notice: the
npm command overwrites a package packument, but this registry serves no
persistent version identity for that write and rejects it. The protected
workflow therefore records an explicit capability blocker before any mutation;
it does not fabricate an identity or send an undocumented replacement PUT. The
safe terminal path is unchanged: document the migration, retain the donor only
through its expiring retention review, measure that every consumer has
un-pinned it, then make the separate reviewed removal decision.

### The failure this rule is derived from

Measurable in this repository, not argued from taste.
`packages/comms/src/dispatcher.ts` reads:

```ts
const policy = (await config.policy?.(message)) ?? { outcome: "allow" as const };
```

`policy` is optional, so a host that never wires one dispatches everything to
everyone and nothing reports a fault. Its sibling donor argues against exactly
this shape in its own README — "silently treats absence of a signal as a
passing one" — and ships a three-state model to refuse it. The two donors
contradict each other in the tree, and no first-party code joins them.

What kept the contradiction invisible is the missing `bin`. Every package with
a gate is one invocation away from having a defect of this class surface in a
consumer's CI; these three are the only non-primitive packages here that no
consumer can check at all. The rule exists so that the next package in that
position has to say so.

### What is deliberately left unresolved

The rule requires a gate, and says nothing about how many, or what each must
judge. Decision 9's standing bar — judge in at least three states, so "could
not evaluate" can never be reported as "fine" — is unchanged and not raised
here. Nor does shipping a `bin` mean the gate works: that is what
[docs/LIFECYCLE.md](LIFECYCLE.md)'s `staged` state asks, and this rule is
deliberately the weaker, earlier question of whether a consumer could run
anything at all.

At the time, the primitive tier had exactly one declared member, which was too
few to know whether it is a tier or a special case wearing a general name. It
was recorded as a tier because the alternative, an exemption field on `domain`
alone, is the
standing exemption with no expiry that the retention contract already refuses.

At the time, where a message-transport and contact-coordinate substrate
belonged was open. Decision 13 resolves finished-message transport into
`messenger`, while inbound admission stays with `butler` and semantic
obligation discharge stays with `giver`.

### Why this rule has no contract file of its own

It nearly got one. This decision was first written with its own
`package-tier.json` and its own checker, in parallel with
`package-programs.json` and `check-package-programs.mjs` — two files and two
gates for one concern, which is precisely the failure decision 9 is derived
from: five published names for one job, and nothing reporting the situation.
The parallel pair was deleted rather than reconciled later, and the rule was
folded into the contract that already knew each package's programme, donors and
lifecycle state. A rule that needs a second copy of that data to be checked is a
rule that belongs next to the first copy.

## 12. Promoting domain machinery into the architect role

### Measurement before the decision

`@vespeneventures/domain` is a published, dependency-free ontology library.
It defines and compares consumer-owned models, but it has no addressee, no
installed command, no authority or system-of-record mapping, no topology
assessment, and no closed-loop metric. This repository has no recorded
dist-path invocation or independent grounding for it. Those facts support a
useful mechanism; they do not support a permanent role or exemption.

The `architect` source package is new and not published. Its lifecycle status
is `incubating`; neither source, tests, nor a fixture run would establish a
registry release, consumer adoption, or independent grounding.

### Decision

`architect` joins Program A as the role that asks:

> Do declared operating boundaries match how material changes actually cross
> systems?

Its mode is **optimize**. Its primary metric is architecture exception rate:

```text
material changes with at least one undeclared boundary crossing
----------------------------------------------------------------
                 all observed material changes
```

No observed material changes produces an indeterminate result, never a zero.
The role senses actual changes and declared architecture, judges their
alignment, proposes an authorized contract change, verifies the resulting
boundary, and learns or escalates. `optimize` is its primary loop mode;
`assure` is secondary and judges candidate topology declarations. These are
the canonical mode names, not a prose label over a separate archetype.

The package owns provider-neutral operating architecture: scopes, systems,
responsibilities, ownership and systems of record, and declared interfaces.
It may assess and propose. It does not self-authorize a topology change and
does not create, transfer, split, or merge provider resources. A consumer
supplies its business metric node, setpoint, authority, evidence, budget,
guardrails, and escalation path; an approved materializer performs any later
mutation.

### Donor and migration position

`domain` moves from the empty foundation classification to Program A as
`architect`'s donor. The ontology API remains installable under its published
name while `architect` is only source. No forwarding release is required when
API parity is proved; consumers can migrate directly after publication.
`domain` is not declared deprecated and `architect` is not declared its
registry replacement until all of these are true:

1. `architect` is published with the donor API available through its declared
   ontology surface;
2. an exact-version migration is documented and proved;
3. consumers can move without losing an API they use; and
4. the lifecycle record is changed from measured registry evidence.

Issue #527 is the countdown for the recut and consumer migration. The existing
gate rule still applies: a role owes a runnable judgment, while a donor with no
gate needs a temporary issue-backed declaration. No provider organization,
repository, package, deprecation, or registry state is changed by this
decision.

## 13. Recutting finished-message transport into the messenger role

### Measurement before the decision

`@vespeneventures/comms` is published and remains installable. It contains a
provider-neutral finished-message contract, dispatch mechanics, delivery
events, a provider adapter, and an inbound surface. It exposes no command and
has never been staged against a real tree by its author. Its inbound surface
overlaps the already-published `butler` role, while provider acceptance and a
later delivery event remain distinct states.

The `messenger` package is new incubating source. A compiled fixture can prove
its gate discriminates synthetic inputs, but cannot prove publication,
consumer adoption, delivery efficacy, or independent grounding.

### Decision and role boundary

`messenger` joins Program C and asks:

> Did each authorized, finished communication reach its transport destination
> within its declared window, according to independently observed evidence?

Its mode is **fulfill**. Its primary metric is **timely verified delivery
rate**:

```text
authorized due intents independently observed delivered within their window
--------------------------------------------------------------------------
      all authorized intents whose declared delivery window has closed
```

The window is inclusive. With no due intents, the result is indeterminate,
never a perfect rate. Provider acceptance is not verified delivery.

`fulfill` is the primary loop mode: messenger accepts an authorized
finished-message intent, validates its preconditions, transports it, and
closes only on observed outcome evidence. `optimize` is secondary because
later independently sourced delivery-status events supply the metric and
inform correction or escalation. `reconcile` is not secondary: messenger does
not own a durable desired-state inventory that converges to zero drift; it owns
discrete message outcomes and learns across them.

The boundary among the three adjacent roles is explicit:

- `butler` admits and confirms an inbound person request;
- `messenger` transports an already authorized finished message and verifies
  delivery-status evidence; and
- `giver` judges whether the resulting answer or delivery discharged the
  semantic obligation owed to the person.

Messenger does not create authorization, choose recipients or content, admit
inbound requests, or declare an obligation discharged. Provider credentials,
routes, storage, policy, identities, and message content remain host-owned.

### Publication-first migration

`comms` becomes messenger's published donor in the Program C contract, but is
not deprecated by source availability. The direct migration sequence is:

1. publish and verify an exact messenger version;
2. document and prove the consumer import and runtime cutover;
3. then record `comms` as deprecated with messenger as its replacement and a
   time-bounded retention decision;
4. migrate consumers without a forwarding package; and
5. measure fleet-wide unpinning, including a positive control proving the
   inventory would detect a retained pin, before any reviewed retirement.

Issue #464 owns that countdown. Until the first two steps have evidence,
`messenger` remains `incubating`, `comms` remains `published`, and no
supersession pair is declared. This decision changes no provider organization,
registry package, visibility, deprecation, or consumer installation.

## 14. Qualifying outbound-presence optimization as the influencer role

### Measurement before the decision

The current expression roles own strategy evidence, approved language, design
conformance, and provable publication. `messenger` owns directed transport;
`observer` owns independent measurement mechanics. None owns the complete job
of choosing bounded channel and cadence experiments, acting through an
authorized presence, and learning from qualified audience response yield.
Those roles are collaborators, not evidence that they already close the same
job and metric loop.

The candidate was assessed with no current role cited as owning the same job,
metric, and loop. Under the schema-version-3 role contract, that produces
`create`, not `compose`. This is a qualification decision; the source package
and author fixture do not prove publication, consumer adoption, independent
grounding, or metric movement in a real installation.

### Decision

`influencer` joins Program B and asks:

> Is this governed outbound presence producing qualified audience responses at
> the declared rate?

Its primary mode is **optimize** and its secondary mode is **fulfill**. It owns
**qualified response yield per thousand**:

```text
1,000 × independently observed qualified audience responses
------------------------------------------------------------
       independently observed eligible exposures
```

The desired direction is increase. A readable response source with no events
is a measured zero. No due window, insufficient exposure, unreadable evidence,
or invalid joins produces an indeterminate result rather than a pass.

The package owns governed organization or product presence, bounded channel
and cadence experiments, authorized publication and reply actions through an
injected actuator, and learning from the resulting metric. It does not define
audience strategy, decide what qualifies as a response, generate or approve
content, render publications, transport directed messages, admit inbound
requests, hold credentials, or authorize itself.

An installed position supplies the business metric node, causal hypothesis,
setpoint, authority, evidence sources, budget, guardrails, and escalation path.
Its worker may combine deterministic validation, model judgment, human
approval, and provider integrations without changing the durable package
charter. V1 permits only organization or product subjects, requires an explicit
anti-impersonation guardrail, and fixes paid spend to zero. Paid media would
change the authority, budget, and likely metric ownership enough to require a
new qualification decision.

Influencer has no donor. Its author fixture establishes only staged
discrimination: one qualified response from 2,000 eligible exposures violates
a setpoint of 2 per thousand, five satisfies it, and an unreadable response
source remains indeterminate.

## 15. Removing delivery cohorts from the operating model

### Measurement before the decision

The A/B/C letters grouped three focused delivery recuts: operation,
expression, and interaction. They helped sequence implementation, but they do
not describe a durable package property. The same role can support different
business metric branches in different consumers, while package lifecycle,
consumer position, and worker assignment change independently. Keeping the
letters in the enforced inventory therefore made a temporary work plan look
like ontology.

The repository already has separate authoritative facts: the role-loop
contract defines durable job charters, the lifecycle contract records registry
and supersession status, and package evidence records measured ladder
positions. Consumer values do not belong in this public repository.

### Decision

A/B/C remain historical names for the recuts recorded in decisions 9 through
14. They are removed from live contracts, generated tables, checker coverage,
workflow names, and staging commands. No replacement department or universal
portfolio grouping is introduced.

`docs/contracts/role-loop-archetypes.json` is the active package-charter
matrix: one job question, one controllable metric, canonical loop mode, and
boundary per role. `docs/contracts/package-evidence.json` contains only
evidence-derived lifecycle positions and gaps. Active portfolio completeness
is derived from the lifecycle contract; retired donors have left it.

Business grouping belongs to a consumer installation. A consumer may bind
several positions to an L2 branch such as Growth, but each binding names its
own L3 metric node and causal hypothesis. The durable package remains unchanged
when one consumer uses Influencer to improve end-customer growth and another
uses it to improve installation growth.

## 16. Completing the role-donor cutover

### Measurement before the decision

Architect, Messenger, and Influencer each passed FULL public-safety preflight,
a protected dry-run, and a protected first publish of `0.1.0`. Each publish job
packed the selected source, installed it into an isolated consumer, uploaded
it, fetched the registry tarball, and repeated the isolated install/import
proof. The GitHub Packages API then reported one public version associated
with this repository for each package.

That evidence closes the producer-side publication dependency that kept
`domain` and `comms` live. Bouncer, Butler, and Giver were already public and
own the role loops that replaced `auth` and `consent`. The four donor packages
had no role charter or controllable metric of their own.

### Decision

Retire `auth`, `consent`, `comms`, and `domain` on 2026-08-24, remove their
source, retention, and visibility declarations, and delete their GitHub
Packages records. No forwarding stub or permanent primitive exemption ships.
The accepted cutover may temporarily break consumers that still pin a donor;
consumer repositories migrate in their own scoped work rather than preserving
the wrong public package boundary here.

The authoritative replacements are:

- `auth` -> `bouncer@^0.1.0`;
- `consent` -> `butler@^0.1.0`, with Giver owning the distinct owed-delivery
  loop rather than being hidden inside the lifecycle replacement field;
- `comms` -> `messenger@^0.1.0`, while Butler owns inbound request admission;
- `domain` -> `architect@^0.1.0`.

The older retired `domain-model` record points directly to Architect so the
lifecycle graph contains no retired-to-retired replacement chain. Historical
decisions and evidence remain measurements of what existed; live source and
catalogue surfaces contain only the qualified role packages.

## 17. Qualifying the Advisor role as the engagement decision gate

### Measurement before the decision

The existing roles can judge rules, topology, changes, package currency, and
individual delivery outcomes, but none owns the complete engagement question:
whether an active engagement has a current, evidence-backed,
authority-bound next decision or action. Sponsor dialogue, offering fit,
readiness, live state, pre-work blockers, and concurrent-initiative collisions
must be reconciled before an operating first wave is allowed to proceed.

### Decision

`advisor` is a provider-neutral role with primary mode **reconcile** and
secondary mode **interact**. It asks:

> Does each active engagement have a current, evidence-backed,
> authority-bound next decision or action?

Its owned metric is **engagement decision currency rate**:

```text
active engagements whose assessment basis is fresh, whose next required action
has an accountable owner and due date, and whose execution authorization if any
matches the exact plan and basis
-------------------------------------------------------------------------------
                          active engagements evaluated
```

The direction is increase. The assessment basis, action ownership, due date,
and authorization-to-plan match are consumer-supplied evidence; Advisor never
turns missing evidence into currency or into a passive `HOLD` state.

Advisor owns normalized engagement state, sponsor dialogue, offering-fit and
readiness reconciliation, blocker and collision reconciliation, bounded
recommendations, and required-next-action issuance. It excludes sponsor or
producer facts, authority and entitlement decisions, repository or provider
mutations, package installation, live-state changes, and self-measurement.

Advisor is the prerequisite assessment position before Controller or any
first-wave operating position is opened. It must establish the baseline and
clear or explicitly escalate each conflict, prerequisite, and other pre-work
blocker with an accountable owner, next action, and follow-up. It does not
authorize execution; the consumer remains the authority for installation,
position binding, approval, mutation, and independent outcome evidence.

This is a durable role qualification, not a delivery cohort or portfolio
grouping. It has no donor package and introduces no provider-specific
integration or account-specific installation state.

The package is the versioned, provider-neutral decision engine, not the
sponsor's launch surface. A Claude-first sponsor experience requires a
separately deployed remote connector that owns product registration, OAuth,
read-only repository observation, durable engagement state, and explicit
mutation approval. It loads an immutable Advisor and catalogue release. The
entry workflow is not installed as a machine-wide skill and public `main`
never substitutes for a trusted package release.

## 18. Producer-owned catalogue distribution cutover

### Measurement before the decision

The source catalogue has nineteen current package directories. Its only
first-party runtime edges are `builder -> controller`, `inspector ->
controller`, and `publisher -> controller`, `designer`, and `writer`.
Controller lists Advisor as a development dependency, not a runtime edge.
Issue [#567](https://github.com/clossys/foundry/issues/567) is the
durable execution record for this producer catalogue, registry, and repository
cutover. Issue #557 remains only the required consumer authority-convergence
dependency.
An apparent package-by-package namespace move would therefore leave Builder
and Inspector able to bring Controller, and Publisher able to bring three
distinct first-party packages. A successful install is not proof that those
copies form one authority; #557 supplies the required convergence declaration
and checker for that risk.

The old GitHub Packages source is public and usable today. Its published
versions are immutable registry history, not a staging area that can be
rewritten in place. Conversely, a destination repository created before the
source transfer would make two producer authorities before the catalogue and
release controls have moved together.

The representative Trio is **Advisor + Starter + Controller**, not an earlier
conceptual Advisor + Builder + Controller grouping. Starter is the narrow
trusted-base adoption/activation coordinator and is deliberately proven beside
the two packages that establish the first runtime-closed publication set.
Advisor before Controller is engagement sequencing — Advisor establishes the
assessment position before Controller's first-wave position — not a manifest
dependency or a claim that Controller imports Advisor at runtime.
Builder remains a separate desired-state/live-state reconciliation package:
the Trio neither renames nor replaces it, and producer proof of the Trio does
not claim Builder adoption, activation, or any consumer outcome.

Starter is explicit executable tooling, not a role package. Its producer proof
qualifies the trusted-base consumer foundation/activation path — including the
consumer-owned `0`/`1`/`2` outcomes and rollback — without claiming adoption,
grounding, or closure for Starter itself; those lifecycle cells are N/A.
Advisor and Controller remain role packages: their later consumer adoption and
independent outcomes are separate role-loop evidence, never an effect of the
Trio's producer qualification.

### Decision

This is a producer-owned, finite cutover to a planned public-npm candidate.
The candidate scope and registry are selected only after transfer, with
ownership and availability evidence, and become active only when declared
through the single authority, `package-scope.json`. This decision does not
reserve or activate a future scope. It is not an authorization to publish,
transfer, create a target repository, change `package-scope.json`, change a
package manifest, or alter a provider in this decision commit. The current
source, scope, GitHub Packages registry, package versions, and publish lane
remain authoritative until the milestone that explicitly changes them.

The source repository transfers directly to the platform destination confirmed
by the transfer authorization; no target platform repository is created
beforehand. The old source stays usable during the proof period. Transfer is
permitted only after the representative Trio proof and the transfer gates below
are recorded for one exact source head.

After transfer, one coherent exact-head change recuts the *whole current
catalogue* from the old source namespace and GitHub Packages to the new public
npm namespace. It includes the single scope/registry declaration, every
manifest and first-party dependency, package-lock, imports, documentation,
and inactive repository-source and workflow preparation for the later publish
lane, plus the registry-specific gates that still apply. It does not activate
any provider-side npm trusted publisher or provenance setting. No package may
be published in the new namespace before that complete recut passes its
checks. This is deliberately a catalogue cut,
not a compatibility period in which a first-party runtime edge crosses
namespaces.

Existing old-namespace versions remain immutable legacy packages. They are
not republished, deleted, yanked, renamed, or made to forward to a new name.
Their lifecycle and retention records continue to describe their registry
disposition; a new-namespace package is a distinct future publication, never
a replacement upload under an old name.

### Milestones and gates

| Milestone | Producer-owned result | Required evidence before advancing |
| --- | --- | --- |
| **1A — decision and inventory** | Record this architecture, exact catalogue inventory, dependency edges, legacy dispositions, and the fixed first-publication order. No operational mutation. | This decision passes the normal repository gates in FULL safety mode. |
| **1B — representative Trio proof** | Qualify the runtime-closed Advisor + Starter + Controller set from one exact current-source head, while the old public source remains usable. The proof is producer qualification, never consumer adoption. For Starter, it qualifies the consumer-owned trusted-base foundation/activation, `0`/`1`/`2`, and rollback path; it does not turn executable tooling into a role. | FULL preflight and isolated tarball installation/import proof for each exact candidate. Starter's **exact installed CLI** must record a satisfied (`0`), violated (`1`), and indeterminate (`2`) result from consumer-owned evidence, plus a verified rollback; raw command, inputs, exit code, and output are retained. Advisor-before-Controller is recorded as engagement sequencing, not dependency order. A workspace link does not count. |
| **1C — transfer** | Transfer this exact source repository directly to the authorized platform destination; do not create a separate target platform repository. | 1B's exact-head evidence; a clean FULL source-tree safety result; confirmed destination ownership and transfer authority; an explicit transfer record; and #557 implemented as a machine-readable singular-authority declaration and checker with positive and negative controls. The recorded checker result must cover current and planned candidate scopes. Absence of a finding is not evidence. |
| **1D — whole-catalogue recut** | After transfer only, change every current source package and every first-party edge to the selected public-npm scope and registry in one coherent source change. Prepare and validate only inactive repository-source and workflow configuration for the later publish lane; do not activate provider-side npm trusted-publisher or provenance settings, and do not publish. | **Before any setter runs**, scope/registry machinery is history-aware: it preserves legacy lifecycle, retention, and decision identities; regression gates prove that preservation; and the selected candidate's ownership/availability evidence is recorded. Then `set-scope --check`, structural registry-drift and manifest-graph checks, workspace-link integrity, FULL safety, build, typecheck, tests, and review all pass on the recut head. Live registry parity is impossible before a candidate package exists and is deferred to 1E. No candidate-namespace package, provider-side npm trusted-publisher activation, provenance emission, or provider trust exists yet. |
| **1E — first public-npm publications** | Treat Advisor, Starter, and Controller as one exact Trio release cohort. Before the first irreversible publication, every candidate passes FULL preflight, selected-tarball scan, and isolated installed canary; Starter's canary includes its required exact CLI evidence. Publish and verify Advisor, then Starter, then Controller, with the owner present for each first identity publication. Only after all three identities have registry-served digest and public visibility/access proof, activate the npm trusted publisher for each package. Then publish one or more later, bounded patch releases through that trusted publisher and verify the registry provenance attached to each of those releases. | One exact-head record names all three candidates and their successful pre-publication evidence; every first identity publication has owner-present, registry-served digest, and public visibility/access evidence. After every Trio or later candidate publication, run and record live registry-parity verification for that published identity (manifest name/version, public visibility/access, and served digest); it is the required 1E post-publication proof, not a 1D pre-publication gate. Each later provenance proof records its patch release, trusted-publisher execution, registry-served digest, and registry provenance verification. If a later candidate, publication, or verification fails after Advisor or Starter has published, fail closed: stop the release and quarantine the incomplete Trio; inventory every already-published immutable member (name, version, digest, visibility, and disposition); invalidate the unpublished candidate artifacts; and never delete or reuse any published version. Deprecate a published member if the registry supports that mutation, otherwise record the unsupported result and its immutable disposition. A defective published member needs a corrected forward version; requalify it and every dependent or remaining candidate from an exact head. Resume only when the whole-tree authority declaration and all current cohort gates pass again. Builder and Inspector wait for Controller; Publisher waits for Controller, Designer, and Writer. |

The 1E handoff is intentionally two-phase: the owner first publishes each
initial identity interactively with npm 2FA and verifies it anonymously before
the next package. Only after the complete Trio is public and verified may the
owner configure npm trusted publishing. Its later activation requires Node
`>=22.14`, npm `>=11.5.1`, upload-job-only `id-token: write`, the protected
`npm-publish` environment with a required reviewer, and no token environment.
The first owner-present publication and subsequent OIDC publication are
separate evidence events.

### Current execution status and remaining sequence (2026-08-30)

W1A through W1D are complete: the decision and representative evidence are
retained, singular authority is mechanically checked, this source is now the
transferred `clossys/foundry` repository, and all 19 source identities plus
their first-party edges have moved together to `@clossys`. Exact predecessor
lines remain only through the content-addressed history inventory. The
producer programme remains tracked by
[#567](https://github.com/clossys/foundry/issues/567), with W1D's reviewed
source result retained in
[#593](https://github.com/clossys/foundry/issues/593).

W1D proved reversible source readiness only. W1E has completed the first
irreversible Trio publications, anonymous registry verification, and the
trusted-publisher provenance-bearing forward releases. These producer facts
create no consumer adoption, independent grounding, closure, or
consumer-outcome evidence.

The completed W1E evidence is deliberately narrow:

1. Retain the completed W1E [#594](https://github.com/clossys/foundry/issues/594)
   evidence for the owner-present first identities and minimal credentialless
   Trio smoke. Retain [#626](https://github.com/clossys/foundry/issues/626)
   for the current provenance-bearing Advisor 0.1.5, Starter 0.1.4, and
   Controller 0.8.23 releases, including anonymous public access,
   served-digest parity, and provider trust settings.
2. Provider state was verified without recording a credential or token value:
   every current Trio package's Publishing access requires 2FA and disallows
   traditional publish tokens.
3. Treat the completed minimal credentialless Trio smoke as producer evidence
   only. Consumer adoption continues in consumer-owned changes with exact
   pins, lockfile evidence, and local checks.

Publishing the other sixteen packages, migrating the wider consumer fleet,
and building `apps:site`, `apps:app`, or `apps:admin` dogfood applications are
post-cutover expansion. They scale from the Trio evidence in declared
dependency order and do not enlarge or delay W1E. This sequence keeps source
preparation, first publication, provider trust, consumer proof, and later
adoption as separate facts.

### W1D packed-artifact lifecycle boundary

W1D is an exhaustive lifecycle gate across the npm-packed contents of all 19
current packages, not a two-file exception. The producer cutover owner records
the generated inventory in #567 from each package's actual
`npm pack --dry-run --json` file list and packed-content scan. It lists every
active retired fully-qualified package identity, import, install instruction,
or use instruction with the package owner, source and packed paths, exact
line/evidence, current version, and tarball digest. The current Controller
runner-conventions reference to `@vespeneventures/conventions/runner` and
Designer `TOKENS.md` current-tense Copy, Strategy, and Surface API references
are known examples, not the boundary of the inventory. Explicitly historical
references remain only when unambiguously labeled historical and
non-instructional; no active retired identity/import/install guidance may
remain in any packed content.

For every affected package, that inventory records one executable disposition:
the named owner, corrected source, semver bump, owner-present public forward
release and clean-pack proof for a legacy correction, or the planned
new-namespace release carried by the complete 1D recut where that is the
appropriate disposition. It also records the exact scan, preflight, canary,
registry, and digest evidence; requalification of every dependent and
remaining candidate; and the command/output/digest binding for each result.
No candidate-namespace package may publish until the inventory is complete,
every disposition is current, and a zero-residual packed-content scan proves
the absence of active retired identity/import/install guidance.

The evidence that made this a blocker is `npm run check:release-readiness`
exiting `1` on the 1A decision diff: a same-version correction changes packed
content and requires a release. It does not authorize a legacy version bump,
republish, or mixed-namespace repair in 1A. The exit condition belongs to 1D:
after transfer, the designated producer recuts the complete catalogue as one
history-aware new-namespace source change, carries every required correction
into the recut artifacts, and records the required FULL, clean-pack,
preflight, canary, registry, and review evidence before 1E. Until then, the
immutable legacy bytes and their current lifecycle/retention records stay
unchanged.

The first publication of **each** Trio identity is intentionally owner-present,
not delegated to an ambient credential or assumed from repository transfer.
Those three verifications establish the initial public package identities.
Only after the complete Trio has that evidence may each package's npm trusted
publisher be activated. Activation establishes trust only: a later eligible,
bounded patch release must publish through that trusted publisher before the
registry can emit provenance for that release. Record and verify the registry
provenance for every such patch release. Neither path changes the requirement
for a human to review every packed artifact before an immutable publication.

An incomplete Trio is never silently treated as a successful first release.
If Advisor alone, or Advisor and Starter, are already published when the next
member fails, the release record inventories the published immutable member or
members and their disposition, quarantines the entire incomplete cohort, and
invalidates the unpublished artifacts. A published defective member is
corrected only by a forward version; its dependents and every remaining Trio
candidate are requalified from the new exact head. The process never deletes,
overwrites, or reuses an immutable package version to make the cohort appear
atomic after the fact, and it resumes only with current whole-tree authority
and gate evidence.

### Current-source catalogue inventory and disposition

Every row below is a source package that exists at this decision's head. The
dependency column is the complete first-party runtime graph read from the
manifests; `none` means no first-party runtime dependency. Each row becomes a
same-name package in the new public-npm namespace only after 1D. The old
namespace version remains immutable legacy history in every case.

| Current package | First-party runtime dependencies | New-namespace disposition |
| --- | --- | --- |
| `starter` | none | Trio first; publish independently after Advisor. |
| `advisor` | none | Trio first; publish first for engagement sequencing. |
| `architect` | none | Publish only after the coherent 1D recut. |
| `bouncer` | none | Publish only after the coherent 1D recut. |
| `builder` | `controller` | Separate desired-state/live-state reconciliation package; wait for new Controller. It is not renamed, replaced, or claimed adopted by the Trio. |
| `butler` | none | Publish only after the coherent 1D recut. |
| `controller` | none (`advisor` is development-only) | Trio first; publish after Advisor for engagement sequencing, not runtime closure. |
| `designer` | none | Publish only after the coherent 1D recut. |
| `giver` | none | Publish only after the coherent 1D recut. |
| `influencer` | none | Publish only after the coherent 1D recut. |
| `inspector` | `controller` | Wait for new Controller. |
| `integrator` | none | Publish only after the coherent 1D recut. |
| `keeper` | none | Publish only after the coherent 1D recut. |
| `locksmith` | none | Publish only after the coherent 1D recut. |
| `messenger` | none | Publish only after the coherent 1D recut. |
| `observer` | none | Publish only after the coherent 1D recut. |
| `publisher` | `controller`, `designer`, `writer` | Wait for all three new dependencies. |
| `strategist` | none | Publish only after the coherent 1D recut. |
| `writer` | none | Publish only after the coherent 1D recut. |

The registry inventory also contains historical package names that no longer
have current source directories: `auth`, `catalog`, `comms`, `consent`,
`conventions`, `copy`, `deployment`, `domain`, `domain-model`, `gates`,
`governance`, `ledger`, `policy`, `provisioning`, `release`, `repository`,
`review`, `secret-scan`, `secrets`, `strategy`, `surface`, `tokens`, `ui`,
`verify-standards`, `voice`, `web-charts`, and `web-storage`; the earlier
removed `contract` name is also legacy history. They receive no
candidate-namespace counterpart.

The executable legacy disposition for `copy`, `ledger`, `strategy`, `surface`,
and `ui` is **retired**: `package-lifecycle.json` says so and the visibility
gate's declarations-only mode skips their retention records because retention
only justifies a lifecycle status of `deprecated`. The old retention entries
were therefore stale, non-operative metadata rather than evidence that those
names remain live. This decision removes that ambiguity by leaving the five
names retired with no retention declaration. No retired or removed artifact is
revived by this cutover.

### Boundary conditions

- A package install, an isolated producer qualification, a consumer adoption,
  and independent outcome evidence remain distinct lifecycle facts.
- A consumer migration must not combine old- and new-namespace packages as
  though installation success proved one authority. Issue #557 is the durable
  convergence control for that risk; this decision neither duplicates nor
  closes it.
- No old-namespace version bump is a cutover mechanism. The legacy catalogue
  remains a readable immutable record while new consumers are directed only to
  a completed new-namespace release.
- A failed 1B, 1C, 1D, or 1E gate leaves the then-current source and registry
  authoritative. It does not authorize a partial retry on a second source
  repository or a mixed-namespace publish.

## 19. The consumer-adoption hold, and what actually clears it

**Status:** declared once, in
[issue #567](https://github.com/clossys/foundry/issues/567) on 2026-08-31.
Never lifted, never restated, and recorded in no durable file here until this
entry. The live status of its clearing condition is deliberately **not** in
this entry; it is measured in
[issue #806](https://github.com/clossys/foundry/issues/806), so that a record
meant to outlive a measurement cannot age into a false claim about one.

### What was actually declared

One producer checkpoint comment on #567, dated 2026-08-31T04:36:02Z, is the
only place this repository has ever declared a hold on consumer adoption. Two
sentences carry it. The first states the stop and its target, with the four
named consumer repositories elided here:

> The programme now has a hard producer-side stop before any [four named
> consumer repositories] adoption. The target is all 19 current `@clossys`
> packages safely public, provenance-bearing, anonymously installable,
> package-authentically exercised, rollback-proven, and retained by immutable
> release evidence.

The second states its scope and what it does not stop:

> The all-four-repository rollout remains held until the full catalogue
> checkpoint, while requirements/routes/brand/content preparation may proceed
> without package installation.

That is the whole of it. It is a producer sequencing hold on one coordinated
four-repository rollout, written in the programme record. It is not a rule in
a contract, a lifecycle status, or a gate, and it was never given effect by
any of those.

### It did name a clearing condition, and it did name who decides

Both are recoverable from that same comment. Recording this matters because
the only surviving downstream account of this hold states that it names
neither, and a consumer reading that account has no way to discover otherwise.

The clearing condition is the "full catalogue checkpoint" quoted above: all 19
current `@clossys` packages safely public, provenance-bearing, anonymously
installable, package-authentically exercised, rollback-proven, and retained by
immutable release evidence. The same comment then sequences the work that
condition was waiting on as an ordered list of tracked issues. The condition is
therefore measurable against published artifacts and closed issues rather than
being a matter of standing opinion, which is what makes #806 able to carry its
status instead of this file.

The decider is the producer cutover programme, whose durable execution record
is #567. A hold declared in that record is cleared in that record, by the
producer cutover owner, and by nobody else. A consumer cannot clear it and
neither can this document.

### What was never declared

No record in this repository forbids a consuming repository from adding an
`@clossys` dependency, from committing an `@clossys` lockfile resolution, or
from removing a dependency on the retired scope. Those three prohibitions are
recorded downstream, in a consumer's own entitlements file, citing this hold.
They are not in the hold's text, in any contract here, or in any gate here.

The producer's durable consumer-facing instruction runs the other way.
[`docs/contracts/scope-migration.md`](contracts/scope-migration.md), added the
same day the hold was declared, exists to tell a consuming repository how to
move off the retired scope: which names map, which version to floor at, and
that the retired scope's registry routing line should be removed rather than
repointed. The machine-readable authority agrees with it. Every retired-scope
entry in [`package-lifecycle.json`](contracts/package-lifecycle.json) carries
an explicit `replacement` under `@clossys`, and every current `@clossys` entry
reads `active`.

Nothing here executes the hold either. The one shipped mechanism a reader
might mistake for one, the singular-authority convergence checker in
`@clossys/controller`, is read-only, is handed its authority declarations by
the consumer, and never infers authority from a package name. It reports
whether a migration has converged, which presupposes that the migration is
permitted. Decision 18's boundary condition against a consumer combining old
and new namespaces is a constraint on how a migration is carried out and
proven, never on whether one may begin.

### The failure this entry closes

A hold that lives in a single comment on a single issue, and whose only
written trace is in a consumer repository, is indistinguishable from no hold
at all to every reader who was not present when it was declared. The consumer
holding on it recorded that it named no clearing condition and no owner. Both
were in fact stated, in a place that reader had no reason to look, while this
repository's own consumer-facing contract was simultaneously telling consumers
how to migrate. Two producer positions, one of them invisible, is worse than
either alone.

The correction is not to lift, re-declare, or reinterpret anything. It is that
a producer position which binds a consumer belongs in this file, where a
consumer is directed to look, and its live status belongs in an open issue,
where it is measured rather than remembered.

## 20. Pre-migration commit messages name the predecessor identity, and that is the recorded position

**Status:** measured on
[issue #813](https://github.com/clossys/foundry/issues/813) on 2026-09-13,
re-measured 2026-09-14, and decided here. This entry records a standing
property of this repository's history. It is not a defect awaiting repair,
and nothing is sequenced behind it.

### What was measured

`scripts/check-commit-messages.mjs` in FULL mode, over every commit reachable
from `main`, against a denylist whose only term is the retired producer
identity:

```
matching commits                                                102
  ancestors of the catalogue recut c1e568f5 (2026-08-29)         98
  authored after it                                               4
  merge commits among them                                        4
inside the seal of governance/commit-message-history-exceptions.json
                                                                102
overlap with the eight commits that file already admits           0
oldest match  cd6f0d6a  2026-08-06  (~3h after the repository was created)
newest match  349942eb  2026-09-10
```

First measured over 631 reachable commits, re-measured over 643 on
2026-09-14: still 102. None of the twelve commits merged on 2026-09-13 added
one.

The full SHA list lives on #813 and is deliberately not copied here. A commit
SHA is stable, so the issue remains the addressable record, and this file
stays a decision rather than an inventory.

### The position, in two halves

Both halves matter. Recording only the first would be incomplete in a way
that misleads the next reader.

**Pre-recut history names the predecessor identity as a matter of course.**
This repository was published under that identity. 98 of the 102 matches
precede the recut, beginning roughly three hours after the repository existed
at all. A reader who finds them has found the migration, not a leak. What is
exposed is a retired organisation name that is already public — not a
credential — and the remedy must stay proportionate to that.

**The set is not closed, and has no terminal state.** Four matches postdate
the recut. Every one is a commit whose message legitimately *describes* the
migration — the same justification the documentation and contract neutralize
entries already rest on. So 102 is a floor, not a total: any future commit
that correctly names what was migrated away from adds to it. It grows slowly,
and it does not stop growing.

### Why neither alternative was taken

**Not a history rewrite.** It would invalidate every existing clone, every
merged pull request's recorded SHAs, and every `reviewedCommit` binding under
`governance/release-qualifications/`, which are sealed and immutable by
design. Touching 16% of history to remove an already-public organisation name
is not proportionate, and the sealed bindings make it destructive rather than
merely expensive.

**Not an extension of the exception mechanism.** Decision-relevant, because it
would have worked: all 102 are inside the existing seal, so admitting them
needs no move of `sealedAtCommit` — the one change that file's own header asks
reviewers to treat as suspicious on its face. It was rejected on cost and on
shape. Cost: one entry per commit, each carrying a 40-hex SHA, a sha256 of
that commit's exact message, a findings array and a ref — roughly a 700-line
governance file. Shape: the mechanism was built for *eight* commits carrying a
**personal address** that GitHub itself injected. Reusing it for 102 commits
carrying a public organisation name would dilute what an entry in that file
means, and because the set is not closed it would need appending every time
someone writes a correct commit message about the migration. An exception list
that grows on ordinary, correct work teaches people to route around it.

The two sets are disjoint, so nothing here disturbs the eight already admitted
under #809, or the seal that bounds them.

### What this means for anyone widening the gate's scan range

`check-commit-messages.mjs` scans a narrow per-push or per-PR diff range, not
whole history. Widening it is a reasonable hardening and this entry is not an
argument against it. But whoever does it should expect **a three-figure
finding count on the first run, and a slowly rising one thereafter**, and
should read that as this recorded position rather than as a regression to fix
or a rule to weaken.

Concretely: a widened range needs a history cutoff, not an exception list. The
recut commit `c1e568f5` is the natural boundary — it accounts for 98 of the
102 — and the four that postdate it are legitimate migration description that
any cutoff must still permit.

### The failure this entry closes

The count in #813 was originally "dozens", reported incidentally rather than
scanned for. A backlog no gate rescans, whose size nobody has established, is
one that gets discovered by whoever next hardens the gate — at the moment they
are least able to judge it, and most tempted to weaken the rule to get moving.
Measuring it and writing the number down converts that ambush into a decision
someone already made on the evidence.

## 21. Commit AUTHOR headers carrying a non-noreply address are accepted and recorded, not gated

**Status:** measured on [issue #826](https://github.com/clossys/foundry/issues/826)
on 2026-09-14 and decided here. Like Decision 20, this records a standing
property of this repository's history and of one of its two permitted merge
methods. It is not a defect awaiting repair, and nothing is sequenced behind
it.

### The predicate, stated exactly, and why it is the one used below

"Non-noreply" needs a precise definition before a count means anything, and an
earlier working draft of this entry got it wrong in a way worth recording
rather than silently correcting: it anchored only on GitHub's own per-account
alias, `@users\.noreply\.github\.com$`, which counts every other address —
including this project's own AGENTS.md/CONTRIBUTING.md-documented agent
commit address, `noreply@anthropic.com` — as if it exposed personal identity.
It does not. `noreply@anthropic.com` is a generic, shared, non-personal
address with no individual behind it, structurally the same kind of thing as
GitHub's own `users.noreply.github.com` domain — see the "forge's own no-reply
mail domain" admission already in `scripts/check-foreign-references.mjs`'s
`NON_ACCOUNT_AT_TOKENS`, which this entry's own reproduction commands below
now also rely on. Anchoring on one noreply convention while missing the other
answers a narrower question than the one #826 actually asks (which commits
carry an address that exposes a person, not which commits carry an address
other than one specific forge's alias format).

The predicate used throughout this entry is therefore: an author address is
already privacy-preserving — and so excluded from "non-noreply" — when it
matches GitHub's per-account alias **or** is exactly this project's own agent
no-reply address:

```
$ SAFE='@users\.noreply\.github\.com$|^noreply@anthropic\.com$'
$ git log origin/main --format='%ae' | grep -vcE "$SAFE"
465
```

This was cross-checked against the simpler "does the address contain the
substring `noreply` at all" predicate a second, independent measurement used,
and the two agree exactly (465), because no third noreply-shaped domain exists
in this history to make the looser substring test overcount:

```
$ git log origin/main --format='%ae' | grep -civ 'noreply'
465
$ git log origin/main --format='%ae' | grep -i 'noreply' | sed -E 's/^[^@]+@//' | sort -u
anthropic.com
users.noreply.github.com
```

An earlier narrower run — anchoring on the GitHub form alone, the mistake
described above — read 491, 26 higher, and every one of those 26 was a
`noreply@anthropic.com` commit miscounted as non-noreply. That number is not
carried forward: it answered the wrong question, and this entry's whole point
is that the next reader gets the same figure this one does, not a different
one from a different, unstated predicate.

### What was measured

Independently re-derived rather than carried forward from the issue, which
itself said its own 447/630 figure was incidental to a different
investigation, using the predicate above throughout:

```
$ git rev-list --count origin/main
667

$ SAFE='@users\.noreply\.github\.com$|^noreply@anthropic\.com$'

$ git log origin/main --format='%ae' | grep -vcE "$SAFE"
465

$ git log origin/main --format='%ae' | grep -cE "$SAFE"
202

$ git log origin/main --no-merges --format='%ae' | grep -vcE "$SAFE"
335
$ git log origin/main --no-merges --format='%H' | wc -l
511

$ git log origin/main --merges --format='%ae' | grep -vcE "$SAFE"
130
$ git log origin/main --merges --format='%H' | wc -l
156

$ git log origin/main --merges --format='%an' | sort -u | wc -l
3
```

465 of 667 reachable commits (70%) carry a non-noreply author address today,
against 447 of 630 (71%) when the issue was filed a few hours earlier the same
day — still **+18 non-noreply commits in under a day**, not the "stops
growing" the issue's own body originally claimed (the issue's own 447 was not
reproduced against a stated predicate, so this comparison is directional, not
exact to the commit). The issue's first comment had already found one live
counterexample (the #811 revert, a directly-authored, non-squash commit);
this measurement confirms the pattern is not a single outlier: 335 of 511
non-merge commits (66%) and 130 of 156 merge commits (83%) both carry it, and
squash being disabled changed neither figure, because squash was never the
only generating mechanism for either.

### A gap this measurement adds to the issue's own finding

`governance/merge-policy.json`'s `why.merge` records that a merge commit
"preserves every original commit and its original author rather than folding
them into that new commit — so there is no per-contributor Co-authored-by
trailer for it to synthesise from profile data." That is true of the commits a
merge commit brings in, and is why `merge` is permitted. It says nothing about
the merge commit's **own** author header — a distinct piece of metadata from
any trailer in message text. All 156 merge commits on `main` were authored
under only 3 distinct identities (checked directly, not printed), which is
consistent with GitHub's own web "Merge pull request" action setting the merge
commit's author to the account that clicked merge — the same account-profile
composition `why.squash` documents for the trailer, on a different field, and
on the one method this policy currently treats as clean. `permittedMergeMethods`
is not wrong to include `merge` (its own message text stays clean, matching
`why.merge`'s claim), but the file's stated reasoning does not cover the
header surface this issue is about.

### Options assessed, same three the issue named

**1. Accept and record.** The historical commits are immutable without a
rewrite (see Decision 20's reasoning — it transfers here unchanged: every
clone, every recorded PR SHA, and every sealed `reviewedCommit` binding under
`governance/release-qualifications/` would be invalidated). The exposed
address is already public on the account's own GitHub profile page, not a
credential.

**2. A gate reading author headers.** Assessed concretely, not dismissed on
principle: `check-commit-messages.mjs`'s own model (scan a narrow per-push
diff range, no history rescan) would apply cleanly here with no historical-
exception mechanism needed at all, unlike #809/#813 — an AUTHOR header is
metadata on commits not yet made, not immutable text already merged, so a
forward-only range scan naturally excludes the 465 already on `main` without
needing to admit any of them.

It was rejected anyway, on what it could actually catch. Of the 465,
335 (72%) are non-merge commits a contributor could avoid by configuring
`user.email` to their forge noreply alias locally — genuinely actionable, but
this repository has no existing convention asking contributors to do that, so
a hard-fail gate here would fail ordinary, correctly-configured commits from
any contributor who has not opted into the forge's privacy setting, which is
a new contribution requirement this task was not asked to institute. The
other 130 (28%) — the merge commits themselves — are composed by GitHub
exactly the way `why.squash` describes for the trailer: server-side, at merge
time, from account profile data, after every check has already run. No gate
in this repository can observe or act on that account setting without naming
the account, which the identity denylist itself refuses (this is the same
`notAssertableFromThisRepository` boundary `governance/merge-policy.json`
already states for the squash case, and it applies unchanged to `merge`'s own
author header). A gate that only catches the 72% it can reach while the 28%
that keeps growing every merge sails through untouched would read as coverage
this surface does not actually have.

**3. Rewrite history.** Not recommended, for the reasons Decision 20 already
gives at greater length, unchanged here: 70% of `main`'s history, not 16%,
which makes the disproportion sharper, not the same.

### The one thing that actually closes this

Unlike Decision 20's backlog, this one has a real single point of leverage,
named in `governance/merge-policy.json` line 12 already: the account-level
"Keep my email addresses private" setting. Flipping it once closes **both**
mechanisms — the squash trailer `why.squash` documents and the merge-commit
author header this entry adds — for every future commit, the same way
disabling squash closed the trailer-synthesis half. That is a one-time action
available to the account, not a repository change, and it is why this entry
recommends it explicitly rather than proposing a gate that could only ever
cover part of the surface a single setting closes completely.

### The failure this entry closes

The issue's own "stops growing going forward" claim was falsified by its own
first comment within about an hour of being filed, and by this measurement a
few hours after that. Recording the corrected shape — not closed by squash
alone, not evenly split between actionable and unactionable, and resolvable
by one account setting rather than by any code this repository could add —
keeps the next reader from re-deriving the same conclusion from scratch, or
worse, building a gate that looks like it closes the surface while only ever
reaching three quarters of it.

## 22. State 4 (`published`) is keyed by `name@version`, not by name

**Status:** decided in [issue #875](https://github.com/clossys/foundry/issues/875),
following a self-correction recorded in that issue's own comment thread —
the issue's opening claim (that sixteen packages could never reach
`published` because the grader only read the sealed Trio record) was false
and was replaced there by the measurement this entry acts on.

### The question and why a name cannot answer it

`docs/LIFECYCLE.md` states state 4's question as "Can someone else install
exactly this?" That is a question about one version. A package name resolves
to whatever `latest` currently is; it does not resolve to whichever version a
publication record happens to describe. A set keyed by name can therefore
only ever answer "exactly something, once" — the first version that ever
validated — never "exactly this one".

### What was actually measured

`validateRetainedLaterPublications` in `scripts/lib/release-later-publication.mjs`
collected `record.candidate.name` into a `Set`, discarding the version each
record already carried on its way in (`identities.add(`${record.candidate.name}@${record.candidate.version}`)`
existed already, purely for duplicate detection, and its output was thrown
away). `scripts/check-package-evidence.mjs` then asked `publishedPackages.has(name)`
— a question with no version in it at all.

Run against this repository's own tree at the time of filing: all 38 retained
records under `governance/release-publications/later/` (19 packages, two
records apiece) sat at superseded versions. Zero of them named their
package's current manifest version. Every one of the 19 packages nonetheless
satisfied `published` under the name-keyed grader — including the sixteen
still declared `staged` in the contract, which the grader permits (declaring
below your evidence is allowed; only declaring ahead is the defect it
exists to catch), and including `@clossys/advisor`, `@clossys/controller`,
and `@clossys/starter`, which were declared `published` on the strength of
records for `0.1.5`/`0.1.3`, `0.8.23`/`0.8.21`, and `0.1.4`/`0.1.2` while
those packages' actual current versions were `0.2.1`, `0.9.6`, and `0.1.6`.

### The decision

State 4 is version-keyed. The published set the grader consults is a set of
`name@version` identities, never bare names, and `evidence.set("published", …)`
joins a package's identity against its CURRENT manifest version — the same
shape the qualification gate already uses to refuse a version bump without a
record for that exact candidate. A record proves the one identity it names
and nothing else; it does not carry forward to a later version of the same
package, no matter how small the gap.

This is deliberately a narrowing, not a new evidence class. Every check the
grader already performed on a retained record — immutability, the
qualification join, trusted provenance — is unchanged; the only new
requirement is that the record's own version also match the package's
current one.

### The immediate consequence, taken

Under version-keying, none of the 19 packages' retained records cover their
package's current version, so none currently satisfies `published`. The
correct reading of the evidence for all 19 is `staged`. `docs/contracts/package-evidence.json`
is updated in the same change: `@clossys/advisor`, `@clossys/controller`, and
`@clossys/starter` move from `published` to `staged`, matching what their
evidence actually shows rather than what it showed for a version they no
longer ship. No `gaps` entry is added for this — a `gaps` entry acknowledges
a shortfall against evidence that does not yet exist; this is not that. The
evidence used to exist for an earlier version and stopped applying the moment
the version moved, which is exactly the reading this decision makes correct
rather than an anomaly to excuse.

The sixteen packages already declared `staged` are unaffected by this
decision on their own — they were already at the state their evidence now
supports, and the separate question of whether they could be raised to
`published` under the OLD name-keyed rule (`#875`'s "what survives" comment)
is now moot, since the rule that would have permitted it no longer exists.

### What this does not do

It does not regenerate any qualification or publication record, and it does
not bump any package version. Qualification records are immutable — one
introduction commit per path, hash-pinned — and manufacturing a fresh record
or a version bump solely to restore `published` status would be producing
evidence to match a desired conclusion rather than reading the evidence that
exists. Packages will earn `published` at their current version as they
naturally ship again, the same way they earned it the first time.

It does not touch `readValidatedPublishedPackageNames`, the narrower,
name-only view `scripts/check-package-identity-transition.mjs` uses to ask
whether the sealed Trio has ever cleared trusted-publisher provenance at all
— a question that gates whether the publish workflow may carry real OIDC
trust, and one that genuinely does not care which version cleared it. Not
every consumer of "has this package published" is asking state 4's question;
this decision applies the join only where the question is version-exact.

## 23. Indeterminate-over-violated precedence in the interaction gates — settled as already-correct, gate-by-gate, not as one repository-wide rule

**Status:** measured against [issue #508](https://github.com/clossys/foundry/issues/508)
on 2026-09-15 and decided here. This is not a defect awaiting repair. Every
gate #508 named already behaves the way this entry settles on, and the gap
was that nothing had said so in one place.

### What #508 asked

Four packages — `bouncer`, `butler`, `giver`, `keeper` — each ship interaction
gates whose per-item classification can mix a confirmed violation with an
item that could not be verified at all in the same run. #508 measured one
such run in `keeper`'s attribution gate (a confirmed
`belief-constrains-without-confirmation` finding alongside a
`source-unverifiable` item) and asked which should win the exit code: `1`
(a real, actionable violation is present) or `2` (the finding list is known
to be incomplete, so calling it "here are the findings" undersells how much
was never checked). It asked this be settled once, recorded, and applied
uniformly with a test per package pinning the mixed case.

### The precedence was already settled, per gate, and already tested

Reading `bouncer/src/contract.ts`'s `checkAuthorityReconciliation`, its own
doc comment states the answer and the reasoning it rests on:

```
 * INDETERMINATE WINS OVER VIOLATED, deliberately. A run in which SOME grants
 * were found unreconciled and SOME providers were unreachable reports the
 * unreachability: the set of violations is known to be incomplete, and a
 * caller who is handed "1 — here are the findings" reasonably reads it as
 * "and there are no others". There are.
```

`keeper/src/contract.ts`'s `checkAttribution` (and `checkVisibility`,
`checkDisposal`) and `giver/src/contract.ts`'s `checkObligationDischarge`
implement the identical precedence — an indeterminate-classified finding kind
present anywhere in the set wins over a plain violation — without repeating
that comment:

```ts
// packages/keeper/src/contract.ts:606-608
const indeterminate = findings.some((finding) => INDETERMINATE_ATTRIBUTION_FINDING_KINDS.includes(finding.kind));
if (indeterminate) return { ok: false, reason: "attribution-unverifiable", ...base, attributed, beliefsChecked, findings };
if (findings.length > 0) return { ok: false, reason: "holdings-unattributed", ...base, attributed, beliefsChecked, findings };
```

And none of the four packages discard the findings that were found. Every
gate's own CLI prints them unconditionally, before branching on the verdict —
`keeper/src/cli.ts`'s `printAttributionReport` calls `printFindings(result.findings)`
ahead of the `result.ok`/`result.reason` branch, on every run, regardless of
exit code. #508's own framing — "reports a real finding as could-not-run" —
describes the exit code and the verdict label, never the findings themselves;
nothing in this measurement found a run that hid a finding it had.

The mixed case is already pinned by an existing test at the pure-function
layer in every gate where it is reachable, and at the CLI-exit-code layer in
every package where it is:

- `keeper/src/contract.test.ts` — "reports the indeterminate reason on a mixed
  set — and still lists the violation it did find", for all three of
  `checkAttribution`, `checkVisibility` and `checkDisposal`. `cli.test.ts`
  carries the matching exit-code test — "exits 2 — not 1 — on a mixed set, and
  still prints the violation/drift it did find" — for `checkAttribution` and
  `checkDisposal`, not for all three: the visibility block's only exit-`2`
  test is the indeterminate-only case (a single disclosure route at
  `reach: "unknown"`), so `checkVisibility`'s mixed set is pinned at the
  contract layer alone.
- `bouncer/src/contract.test.ts` / `cli.test.ts` — "reports indeterminate over
  violated when both are present, because the finding list is known to be
  incomplete" (plus an order-independence test) for
  `checkAuthorityReconciliation`, and "reports indeterminate over drift when
  both are present, and still returns the drift it did find" for
  `checkProviderContract`.
- `giver/src/contract.test.ts` / `cli.test.ts` — "reports the indeterminate
  reason on a mixed run, and still carries the breach it did find" for
  `checkObligationDischarge`.

This measurement mutation-tested one of those (`keeper`'s attribution CLI
test): with `checkAttribution`'s mixed-set branch forced to return
`{ ok: true, ... }` regardless of findings, both the contract-level and the
CLI-level "mixed set" tests failed — `main(["attribution", …])` returned `0`
instead of `2`, and `result.reason` came back `undefined` instead of
`"attribution-unverifiable"`. Restoring the original code returned both
tests to green. The control that was reverted and re-passed is the same
discipline `docs/LIFECYCLE.md`'s `staged` evidence already requires of a
gate's own violation record.

### #508's third option, measured: half of it already ships, and the other half is declined

#508 does not only ask "`1` or `2`". Near the end it proposes a way out of the
choice altogether, and this is the strongest form of the argument against what
ships:

> A third option exists and may be the real answer: `1` when any confirmed
> violation is present, and report the unverifiable count as a distinct,
> always-printed line, so the two facts are never in competition for one exit
> code.

That is two proposals, not one — an exit-code change and a reporting change —
and they get different answers.

**The reporting half already ships.** Measured on 2026-09-15 by running each
package's compiled `dist/cli.js` against constructed inputs holding a confirmed
violation and an unverifiable item at the same time, not by reading the code.
`bouncer` prints the count the third option asks for, literally, on its own
line, on every path — including a clean run, where it prints `0`:

```
2 live grant(s) checked against 2 provider observation(s).
Unreconciled grant surface: 1. Grants nothing could be learned about: 1.
  [revoked-upstream] grant-1 (actor actor-1, subject subject-1, provider provider-a) — the provider of record reports this authority revoked, and it is still live here
Authority reconciliation: indeterminate (provider-unreachable).
exit=2
```

`keeper` and `giver` report the same fact per item rather than as a count: each
unverifiable item gets its own finding line, and the reason gets the verdict
line.

```
  [held-without-source-event] item_bad (subject sub_1) — held since 2026-08-01T00:00:00.000Z and names no source event (imported)
  [source-unverifiable] item_unknown (subject sub_1) — the store could not say where this came from (ledger timeout)
Attribution: indeterminate (attribution-unverifiable).
exit=2
```

```
  [delivery-failed] obl-1 (1 attempt(s)) — 1 send(s) recorded against this obligation and every one of them failed: an attempt is not a delivery
  [delivery-unprovable] obl-2 (1 attempt(s)) — 1 send(s) recorded, none observed to have arrived, and the window closed at 2026-08-22T11:00:00.000Z
Obligation discharge: indeterminate (discharge-unprovable).
exit=2
```

`butler` has no mixed case to print at all (see the next section). It prints
the verdict distinctly on each single-state path it does have —
`Confirmation completeness: violated.` at exit `1`,
`Confirmation completeness: indeterminate (no-intents-provided).` at exit `2`.

So "the two facts are never in competition" is already true of the text output
in all four. What is NOT true is that a machine consumer can read them: none of
the four ships a `--format json` mode, so a caller keying on the exit code
alone — the only part of a gate's output CI branches on — still loses the
findings. That is a real gap. It is [#753](https://github.com/clossys/foundry/issues/753)
point 2, fixed in `writer` and unfixed here, and it is filed as
[#899](https://github.com/clossys/foundry/issues/899) rather than settled by
this entry, because closing it means editing four published packages' shipped
`src/`.

**The exit-code half is declined, because `1` claims more than the run
established.** Exit `1` is a completeness claim — "this gate checked, and here
is what it found." When part of the input could not be compared at all, the
violations found are a lower bound, not a set: there may be more inside the
portion nobody could read. Exit `2` claims less. A mixed run is genuinely a
fourth state, and three values cannot express it exactly; the only question is
which of the three absorbs it, and the answer is the one that does not overstate
what the run established. `bouncer`'s doc comment, quoted above, makes this
argument in its own words — a caller handed "1 — here are the findings"
reasonably reads it as "and there are no others."

**This repository has already split this exact proposal once, and answered it
the same way.** [#753](https://github.com/clossys/foundry/issues/753) is
`writer-check` producing 292 real findings alongside one unclassifiable JSX
construct and exiting `2`, reported by a consumer running it against a real
application tree. It separates the two halves itself:

> **2. The indeterminate fold is correct, and it still deserves a better
> report.** Exit 2 over findings is the right contract: one unreadable input
> must not let a scan report itself complete... No change requested to the exit
> code. But the 292 findings that WERE produced are currently only discoverable
> in the human-readable output.

`writer` kept the exit code and added the structured report —
`packages/writer/src/cli.ts`'s `CopyTraceabilityReport`, whose own doc comment
records that "a per-item verdict ... is a DIFFERENT question from the run's one
overall verdict." The interaction gates sit at the same settlement, minus the
structured half, which is what #899 is for.

**On #450 and #491, which #508 cites against what ships.** Both were read in
full, and neither says what #508 uses it for. #450 relabelled a benign
`not-published` result from `FIND ` to `SKIP ` — it moved a non-finding OUT of
the findings bucket, which is the opposite direction from routing a
partly-blind run INTO it. #491 resolved a `404` from a registry that had
answered to `{ kind: "unreachable" }` — a definite claim about a cause ("a
transport failure, a server error, a malformed body") that had not been
established — and its fix added an explicit `indeterminate` arm and routed the
case there. Its own diagnosis, that the vocabulary "had no word for
undecidable, so the nearest neighbour was borrowed," is an argument for naming
an undecidable case honestly, and its remedy moved a case TOWARD indeterminate,
not away from it.

The shared principle #508 quotes is real and is accepted here: a verdict that
borrows its nearest neighbour's name misroutes the reader. It simply does not
decide this question. In #450 and #491 exactly one thing was true and was
mislabelled; a mixed run has two things true at once and three exit codes to
say them in. Where the principle does reach is the honest limit of this
argument: #491's remedy for a case with no word of its own was to ADD one, and
the exit-code vocabulary cannot be extended that way. `CONTRIBUTING.md`'s "Gate
CLIs exit `0` clean / `1` findings / `2` could not run" is fixed at three, and
a fourth code would break every caller's branch on it. Some borrowing is
therefore unavoidable, and given that, `2` is the borrow that overstates least.

### Not every gate has the mixed case, and that is a fact, not a gap

`butler`'s three gates (`checkConfirmationCompleteness`, `checkCurrency`,
`checkWithdrawalParity`) and two of `giver`'s three (`checkHandoffPlacement`,
`checkGrounding`) and one of `bouncer`'s three (`checkDelegationCeiling`) have
no per-item indeterminate finding kind at all. What makes the mixed case
unreachable in all six is the **return shape**: every indeterminate return in
these gates literally constructs `findings: []`, so an indeterminate reason
and a finding cannot be carried out of the same call. Most of those returns
are early "nothing was provided" guards that run before any finding could
exist; the one that is not — `giver/src/contract.ts:489`'s `no-handoffs-due`,
which sits after both loops rather than ahead of them, and is gated on
`placed === 0` rather than on an empty input array — is reachable only past
the `if (findings.length > 0)` return immediately above it, so it too can be
taken only with an empty findings list.

It is specifically NOT the case that every finding in these gates derives from
walking the array its indeterminate return is gated on. Three of the six
derive at least one finding from the other input array:
`checkConfirmationCompleteness`'s second loop walks `confirmations`, not
`intents`, to produce `confirmation-without-intent`
(`packages/butler/src/contract.ts:331-338`); `checkCurrency`'s
`no-instructions-provided` route is gated on `instructions` while every one of
its findings is derived from walking `usages`; and `checkHandoffPlacement`'s
second loop walks `placements`, not `handoffs`, to produce
`placement-without-handoff` (`packages/giver/src/contract.ts:475-482`). In
each, the early return short-circuits before that finding is ever computed
rather than making it impossible — which is precisely why the guarantee has to
rest on the return shape and not on which array is walked.

Measured on 2026-09-16 against `butler`'s compiled `dist/cli.js`: the same
dangling confirmation is silent under the guard and a real, exit-`1` finding
without it. (The two echoed input-path lines each run prints first are elided.)

```
$ node dist/cli.js confirmation-completeness intents-empty.json confirmations-ghost.json --floor 0.7
0 intent(s) checked against 1 confirmation(s), floor 0.7.
Confirmation completeness: indeterminate (no-intents-provided).
exit=2

$ node dist/cli.js confirmation-completeness intents-one.json confirmations-ghost.json --floor 0.7
1 intent(s) checked against 1 confirmation(s), floor 0.7.
  [confirmation-without-intent] int_ghost — a read-back answers an intent that is not in the set being checked
Confirmation completeness: violated.
exit=1
```

`confirmations-ghost.json` is the same one-element file in both runs;
`intents-one.json` holds a single `handed-off` intent, which produces no
finding of its own, so the only finding printed is the one derived from
`confirmations`. The mixed case #508 describes is still structurally
unreachable in all six, not merely untested — on the return shape.

Per `docs/LIFECYCLE.md`'s eighth value — "not-applicable, with a
reason... distinct from 'not yet' and from 'unknown'" — this measurement
records that fact rather than silently omitting these gates or forcing a
mixed-case test that could never fail. `bouncer`'s `checkDelegationCeiling`
already carried this exact pin ("has no mixed indeterminate-and-violated
state to resolve, and this pins why"); this measurement adds the matching pin
to `butler`'s three gates, which had none (`packages/butler/src/contract.test.ts`).

### Why this is not one repository-wide rule

`@clossys/writer`'s `addressability.ts` (`checkAddressability`) answers the
identical-shaped question — a real violation and an unclassified position in
the same scan — the OPPOSITE way, and says so in its own doc comment ("THE
TERNARY"), citing issue #407: on that gate, an unclassified position is not a
rare edge case but the common result of every real scan it has ever been run
against, so letting indeterminate win would make the `"violated"` branch
permanently unreachable in production. `copy-gate.ts`'s own traceability
check, in the same package, keeps indeterminate-wins for the identical
reason `bouncer` states — for it, an unchecked construct is genuinely rare.

**The general rule, stated so a fifth gate does not have to rediscover it:
dominance belongs to whichever verdict is EXCEPTIONAL in that gate's own input
distribution.** A verdict that is the norm carries no information — #407
measured `addressability` at 5 violations against 768 unclassified positions on
one real tree, so letting indeterminate dominate there makes the `"violated"`
branch unreachable outside a fixture and leaves the gate one usable state. A
verdict that is exceptional carries a great deal, and must dominate: a provider
that could not be reached, or a store that could not say where an item came
from, is rare in `bouncer` and `keeper`, so on the run where it happens it is
the most important thing about the run. That is why two packages answer the
identically-shaped question opposite ways and both are right. Note what the
rule is NOT about: it is a claim about how often each verdict occurs in that
gate's real input, not about which of the two facts is more severe — severity
would pick the same answer everywhere and is exactly the reasoning that would
have broken `addressability`. `copy-gate.ts`, cited above, is the control on
this reading — same package, opposite distribution, opposite precedence, and
the precedence is a single line: `packages/writer/src/cli.ts:966`,
`result.unchecked.length > 0 ? 2 : result.findings.length > 0 ? 1 : 0`. A gate
adopting either precedence should record which of the two distributions it is
in.

Both are correct for their own gate. A blanket "indeterminate always wins" or
"violated always wins" rule would have been wrong for at least one of the two
gates already shipping in this repository. What #508 asked to settle "once,"
this measurement settles as: **the precedence is a deliberate, gate-local
choice, made once per gate and never silently defaulted — indeterminate wins
in every interaction gate measured here, because none of them has
`addressability`'s structural reason to choose otherwise — and it must be
stated somewhere a reader can find it**, which this entry is.

### What this measurement did not do, and why

`bouncer` states its reasoning in a doc comment beside the code; `keeper` and
`giver` implement the identical precedence without one. Closing that
asymmetry means editing `packages/keeper/src/contract.ts` and
`packages/giver/src/contract.ts` — files `files` ships in both packages'
published tarballs. Any edit to either, including a comment-only one,
requires a version bump under `check-release-readiness` and, once bumped, a
release qualification record before either package can publish again.
Neither is warranted to land a comment. This entry is the recorded reasoning
in the meantime; carrying it into the source comments themselves is left for
a session that is already bumping one of these two packages for an unrelated
reason.

A mechanical, CI-checked version of "every gate states its precedence"
was considered — the strongest form would need a new exported declaration
next to each `INDETERMINATE_*_FINDING_KINDS` constant, which is the same
shipped-file, same version-bump problem one level up, spread across three
packages instead of two. A weaker form, a script asserting each package's
test suite contains a test titled like the ones listed above, was rejected
as decorative: it would verify a string appears in a test file, not that the
precedence the test names is the one the code actually implements — exactly
the kind of check `CONTRIBUTING.md`'s own "Gate CLIs exit `0`/`1`/`2`" entry
warns a written-but-unchecked convention decays into. Filed as follow-up work
for whichever session next has version-bump budget in `keeper` or `giver`.

## 24. #421's ten optional-peer rows measure to fourteen, and only three import sites are genuinely unguarded

This entry measures issue #421's ten unconditional-optional-peer-import rows
against current `main` rather than against the issue's own table, and replaces
a recovered draft of this same entry that reached a materially different, less
complete conclusion (see below).

#421 listed ten rows across six packages named `auth`, `comms`, `consent`,
`controller`, `surface`, `ui`. Three of those six — `auth`, `comms`,
`consent` — are the pre-#536 donor package names;
`governance/foundry-supersession-map.json` records their exact successors as
`@clossys/bouncer`, `@clossys/messenger`, and `@clossys/butler`. `surface` and
`ui` are decision 10's pre-recut names for `publisher` and `designer`. The
issue's table therefore describes a repository state that predates both the
#536 retirement and the `#182` `assertPeerVersion` adapter convention
`scripts/check-peer-version-assert.mjs` now verifies across six
`peer-version.ts` copies (`bouncer`, `butler`, `controller`, `designer`,
`keeper`, `publisher`).

A fresh measurement walked every package's `peerDependenciesMeta` optional
entries against real `src/` import sites (excluding `*.test.*`/`*.check.*`)
using the TypeScript compiler's own AST — not a text grep — specifically to
exclude `import type` clauses and type-only named specifiers, neither of
which survives compilation into a runtime `import` that Node's resolver ever
sees. That distinction matters enough to change the headline numbers: a naive
grep counts `designer` importing `react` in dozens of files (73 by one count
already circulating for this issue) because almost every atom writes `import
type { ... } from "react"` for prop types; the AST walk finds only 20 files
with a real, runtime react import (a `useState`, a `createElement`, a bare
`import "react"` value binding — something that actually touches Node's
module resolver) and 27 for `react-aria-components`. The lower number is the
one this issue's actual concern — an opaque resolution failure — can ever be
about; a type-only import is erased before any resolver runs and can never
throw `ERR_MODULE_NOT_FOUND`. The walk also matched subpath specifiers
(`next/server` against a declared `next` peer, `react-aria-components/package.json`
against `react-aria-components`), which the first pass at this measurement
missed entirely — see below for what that found.

Reachability against each package's own `exports` map was checked by hand for
every row: which subpath(s) resolve to a file that reaches the import, and
whether every one of those subpaths' module graphs also reaches a matching
`assertPeerVersion({ peer: "<name>", ... })` call.

| package | peer | static import sites (non-test) | already guarded? | verdict |
| --- | --- | --- | --- | --- |
| `bouncer` | `@clerk/nextjs` | `providers/clerk/web/client.tsx` (base import); `providers/clerk/web/server-routes.tsx` (`/server` import); `providers/clerk/web/proxy.ts` (`/server` import) | `server-routes.tsx` guards itself. `client.tsx` guards `react` in the same file but never calls `assertPeerVersion` for `@clerk/nextjs`, and `./providers/clerk/web`/`./providers/clerk/web/client` never load `server-routes.tsx`. `proxy.ts` imports `clerkMiddleware`/`createRouteMatcher` as values at line 1 and guards nothing: neither it nor `proxy-entry.ts` — the whole `./providers/clerk/web/proxy` module graph — calls `assertPeerVersion` for either peer it imports. Both confirmed by empty grep | **(b) unguarded** at two sites, `client.tsx` and `proxy.ts` — filed as #889 |
| `bouncer` | `next` | `providers/clerk/web/server-routes.tsx` (guarded); `providers/clerk/web/proxy.ts` (unguarded) | `server-routes.tsx` guards itself; `proxy.ts`/`proxy-entry.ts` (the whole `./providers/clerk/web/proxy` module graph) call `assertPeerVersion` nowhere — confirmed empty grep | **(b) unguarded** for the `proxy.ts` site — filed as #889 |
| `bouncer` | `react` | `providers/clerk/web/client.tsx` | `assertPeerVersion` in the same file | (c) correctly guarded |
| `bouncer` | `svix` | `providers/clerk/verify.ts` | `assertPeerVersion` in the same file | (c) correctly guarded |
| `butler` | `react` | `web/{index.ts,useStandingWants.ts}` | `assertPeerVersion` in `web/index.ts`; `useStandingWants.ts` is reachable only through that barrel (`./web` is its own `exports` subpath — root and `./inbound` never touch `react`) | (c) correctly guarded, confined to `./web` |
| `controller` | `typescript` | `gates/secret-gates.ts` | `assertPeerVersion` in the same file, behind the isolated `./gates/secrets` subpath since #411/#419 | (c) already fixed |
| `designer` | `react` | 20 files (all under `atoms/`, `blocks/`, `charts/`, `shell/`, or `theme/`) | `assertPeerVersion` in each of the five barrels (`{atoms,blocks,charts,shell,theme}/index.ts`), which every file in its own subtree loads first | (c) correctly guarded, confirmed by `internal/peer-guard-coverage.test.ts` — a component library cannot degrade without its render peer, and the version-mismatch case IS caught; true absence still resolves as Node's own named `ERR_MODULE_NOT_FOUND`, accepted deliberately (see `internal/peer-version.ts`'s own header) |
| `designer` | `react-aria-components` | 27 files (all under `atoms/`, `blocks/Toolbar.tsx`, or `shell/`) | `assertPeerVersion` in `atoms/index.ts`, `blocks/index.ts`, `shell/index.ts` | (c) correctly guarded, same confirmation and reasoning as `react` above |
| `designer` | `tailwind-merge` | `atoms/internal/cx.ts` (dynamic `import()`) | try/catch around the dynamic import, degrade-and-warn-once | (c) fixed by PR #882 (issue #749) — the template this audit follows |
| `designer` | `tailwindcss` | `compiled-css/generate.ts` (dynamic `import()`) | `assertPeerVersion`; Node-only build tool, never reachable by an external consumer | (c) correctly guarded |
| `designer`, `publisher` | `react-dom`, `@internationalized/date` | none | n/a — no adapter import site exists anywhere in either package's own source | (c) trivially honest — nothing to guard |
| `keeper` | `react` | `web/{index.ts,useHeldRecord.ts}` | `assertPeerVersion` in `web/index.ts`; same confined-subpath shape as `butler` | (c) correctly guarded |
| `messenger` | `resend` | `providers/resend/index.ts` | none — no `internal/peer-version.ts` exists in this package at all | (b) unguarded, not degradable (there is no meaningful "send mail without a mail client" fallback), confined to the honestly-optional `./providers/resend` subpath — filed as #886 |
| `publisher` | `react` | `document/render.ts`, `web/renderWebDocument.ts` (both guard themselves); `web/internal/webTemplates.ts` (does not guard itself) | `render.ts`/`renderWebDocument.ts` guard directly. `webTemplates.ts` does not call `assertPeerVersion`, and exactly one subpath reaches it: `./web`, under both of its conditions. `./document` does NOT — `document/render.ts` imports `react`, `@clossys/writer`, `../internal/errors.js`, `../internal/peer-version.js`, `./validate.js` and `./types.js`, and never `webTemplates.js`. (`core/resolve-surface.ts` and `print/renderPrintDocument.ts` only name the file in doc comments, which is what a text search misreads as a reach.) `./web`'s `import` condition resolves to `web/index.ts` and its `react-server` condition to `web/server.ts`, and each of those two files re-exports statically from `renderWebDocument.js` — which guards itself — as well as from `webTemplates.js`, so the guard runs before control returns to the consumer, whichever binding was imported | (c) correctly guarded in effect — confirmed by reading the actual `import`/`export … from` statements in `web/index.ts`, `web/server.ts` and `document/render.ts`, not assumed and not grepped |

Fourteen rows against a naive per-package count of the ten original ones,
because `bouncer` alone resolves to four — one row each for `@clerk/nextjs`,
`next`, `react` and `svix` — once subpath specifiers (`next/server` and
`@clerk/nextjs/server` against the declared `next` and `@clerk/nextjs` peers)
and per-`exports`-entry-point reachability are checked individually rather
than per package. Eleven of the fourteen are already correct on `main` or
fixed on a named branch (`tailwind-merge`, PR #882). The remaining three are
genuine, currently unguarded gaps.

Those three are three ROWS, and a row here is one peer, not one file. Counted
as files there are three unguarded import sites; counted as the peer×site
pairs a fix actually has to add a guard for there are four, because
`proxy.ts`'s two unguarded import statements are two pairs, not one:

| unguarded site | peer(s) left unguarded | pairs |
| --- | --- | --- |
| `messenger` `providers/resend/index.ts` | `resend` | 1 |
| `bouncer` `providers/clerk/web/client.tsx` | `@clerk/nextjs` | 1 |
| `bouncer` `providers/clerk/web/proxy.ts` | `next`, `@clerk/nextjs` | 2 |

Three files, four pairs — quote whichever number the question asks for, and
say which one it is. All four pairs are the same non-degradable shape
`controller`'s `typescript` already handles correctly (a named range error,
not a lazy-import/degrade rewrite, because there is no sensible fallback for
"send mail without a mail client" or "run Clerk middleware without Clerk or
Next.js"):

- `messenger`/`resend` in `providers/resend/index.ts` — already filed as #886
  before this entry was written (the dead agent that started this audit
  managed to file the issue before losing its session; only this file's own
  git history was lost).
- `bouncer`/`@clerk/nextjs` in `client.tsx`, and `bouncer`/`next` +
  `@clerk/nextjs` in `proxy.ts` — newly found by this measurement (the
  recovered draft this entry replaces did not catch either; both require
  checking per-`exports`-subpath reachability rather than trusting that a
  sibling file in the same directory shares a module graph). Both are sharper
  than the typical case: `packages/bouncer/README.md` already claims *"Each
  of those entry points guards its own optional peer with
  `assertPeerVersion`, evaluated once at import time"* — which holds for
  exactly one of the four Clerk web entry points. `./providers/clerk/web/server`
  guards both of its peers. `./providers/clerk/web` and
  `./providers/clerk/web/client` both resolve to `client.tsx`, which guards
  `react` but not `@clerk/nextjs`. `./providers/clerk/web/proxy` guards
  neither of its two. Filed as #889.

None of the three fixes were made in the pull request that added this entry.
Each touches packed `src/` content, which `check-release-readiness.mjs` would
then require a version bump for, which `check-qualification-record-required.mjs`
would in turn require a retained qualification record for — and `scripts/
run-candidate-qualification.mjs` is owner/developer-machine work per #833, not
something a cloud or analysis session should produce unreviewed. Tracked as
#886 and #889 instead, for a local session to pick up alongside the code
fixes.

## 25. Lifecycle state 7 is consumer-owned by design, and the supplier-side gap is thirteen READMEs, not the shared close condition

#906 recorded that `docs/LIFECYCLE.md` state 7 (`closed`) is unreachable
catalogue-wide, for two reasons it treated as comparable. Re-measured against
current `main`, they are not comparable: the first is the contract working as
designed, and only the second is a defect this repository can fix.

### The shared close condition is bound by consumers, and that is the design

Measured by walking the role key set with `JSON.parse`, not by substring
search — the distinction matters, because the condition string *mentions*
"setpoint" and "cadence", so a `grep -c` makes it look as though all eighteen
roles declare them:

```
roles: 18
role keys: boundary, closeCondition, jobQuestion, metric, primaryMode, secondaryModes
distinct closeCondition values: 1
setpoint is a role key: False
cadence is a role key: False
```

All eighteen roles share one string: *"Independent consumer evidence shows the
position's owned metric meets its setpoint over the declared review cadence."*

An earlier draft of this measurement — repeated to nine agents and written into
#906 — concluded that `setpoint` and `cadence` "are not keys anywhere", and
that a condition whose terms have no referent is indistinguishable from an
unfinished one. **That conclusion was wrong, and correcting it inverts it.**
Both terms are entries in the contract's top-level `consumerBindings`
vocabulary:

```
consumerBindings: businessMetricPath, causalHypothesis, baseline, setpoint,
  operatingScope, authority, evidenceSource, cadence, budget, guardrails,
  escalationPath, workerComponents, stageBindings, firstDayAssessment
```

`consumerBindings` is a declared list of what a *consumer* binds. So the
contract does record which of the two possibilities this is. The close
condition's terms are not missing; they are deliberately not the supplier's to
set, and the mechanism for binding them is declared here.

Whether any consumer has actually bound them is **not observable from this
repository**, and this entry does not claim it. The only `setpoint` bindings
present here are in `docs/contracts/installed-position-ledger.fixture.json`.
Seventeen of its eighteen rows read *"Synthetic schema fixture; no consumer
decision."* The eighteenth is the only row in this repository that populates a
`setpoint` at all, and it reads *"Synthetic schema fixture; exercises a
complete open position"* — a schema exercise, which is if anything a plainer
statement that no consumer decided anything.

(An earlier draft also cited `docs/contracts/package-evidence.json`, which
contains zero structural `setpoint` keys — a substring match dressed as a
measurement, and the very thing this entry warns against two paragraphs above.)

An
earlier draft of this entry asserted the mechanism "is exercised in consumer
planes"; that was an unevidenced claim about things outside this repository
and is withdrawn.

Its absence is not a counter-argument. A supplier repository that could
observe its consumers' bindings would be a supplier able to grade itself, and
that is what the decision below rejects. Unobservability here is the expected
consequence of consumer ownership, not a gap in it — but it does mean this
entry records a design position, not a measurement of adoption.

That also makes the condition correct rather than merely unmet. A supplier that
declared its own setpoint and its own review cadence, and then graded itself
against them, would be producing exactly the self-certification `LIFECYCLE.md`'s
standing rule exists to forbid. State 7 being out of this repository's reach is
the rule holding, not failing.

**Decided:** state 7 is consumer-owned. The eighteen identical close-condition
strings stay identical and stay unbound here. No role gains a supplier-set
`setpoint` or `cadence`, and #906's warning against editing eighteen identical
strings into eighteen different-looking ones without binding their terms stands
as recorded policy: that would hide the property rather than change it.

Nothing in this repository can therefore report a package as `closed`, and no
gate should be written that tries. A catalogue-wide `closed` count of zero is
the expected steady state, not a backlog.

### Thirteen READMEs stating no close condition is a real gap

State 7 is defined as read "as written in the package's own README". Measured
across all nineteen:

```
states a close condition (6):
  builder  controller  inspector  integrator  locksmith  observer
states none (13):
  advisor  architect  bouncer  butler  designer  giver  influencer
  keeper  messenger  publisher  starter  strategist  writer
```

For those thirteen, state 7 is unreachable by the state's own definition — not
because a consumer has not bound anything, but because there is no supplier
text for a consumer to bind *to*. That half is squarely this repository's, and
unlike the close condition it is fixable without deciding anything about
consumer authority.

**Decided:** every package README states its close condition. This is supplier
work, tracked in #906, and it is a documentation change: it states what
evidence would close the position, without claiming the position is closed.

### A stated condition can still reference machinery that does not exist

Stating one is necessary and not sufficient. `locksmith`'s README states a
close condition requiring `unverifiable` to appear "only under an explicit,
recorded opt-out", and no opt-out field, type, or function ships. A condition
that can be neither satisfied nor refuted is not a close condition; it is a
sentence shaped like one. The same shape appears in two owned-metric
declarations: `observer`'s README stakes closure on `escapeRate` while its
contract entry declares `unobserved outcome rate`, and `publisher`'s contract
declares `verified publication rate`, which occurs repository-wide only in the
declaration itself. `locksmith` is a fourth instance of the same kind: its
contract declares `controlled key rate`, which appears repository-wide only at
`docs/contracts/role-loop-archetypes.json`, its `packages/controller/contracts`
copy, and a row in `docs/contracts/scope-migration.md` — three declarations and
no computation. #906 already recorded it; an earlier draft of this entry listed
three instances and omitted it.

**Decided:** a close condition must name only fields, states, or metrics that
ship. The four instances above are defects against this entry and are fixed
with their packages, not by softening the condition into something unfalsifiable.

### What this entry does not settle

#302 asks a different question — a distribution shape for a consumer whose CI
forbids network access and therefore cannot install `controller`'s
`./conventions` export. That is an implementation choice with real artifacts
behind it, not a position to record, and it stays open in #302 rather than
being resolved by assertion here.

Refs: #906, #897, #444, #484, #326, #502

## Settled

**Author attribution — the project name holds the copyright.** Every package's
`LICENSE` copyright holder names the project, identically, across the whole
catalogue, as does the repository-root `LICENSE`. The MIT licence requires a
named copyright holder for the grant to be valid; the project name supplies
one without publishing an individual's name in twenty public artifacts.

The `package.json` `"author"` field is deliberately NOT changed in the same
commit, and this is a constraint rather than an oversight. Each package's
pre-publication qualification record seals `candidate.packageManifestSha256`,
a sha256 over the manifest's exact bytes (`scripts/record-later-publication.mjs`
`validateCandidateAndProof`). Editing any byte of a manifest — `"author"`
included — breaks that binding, and re-sealing it requires genuine registry
evidence rather than a source edit. `LICENSE` carries no such seal, which is
why the legally load-bearing half lands first. The `"author"` field is
normalized in whichever change next re-qualifies each package, and until then
the catalogue is deliberately half-normalized with the difference recorded
here rather than left to be rediscovered.

This supersedes an earlier settled decision to keep an individual's real name
in the `"author"` field. That decision was reasonable — a real author name is
conventional in open source — but it had two costs this one does not. It put
an individual's name on every published artifact, and it depended on the
denylist's `neutralize` list being path-scoped to `package.json` to stay
publishable at all. Naming the project removes the individual's name from the
published surface entirely, so no neutralize carve-out is load-bearing for it.

The catalogue had drifted before this change: three packages named a retired
entity in `LICENSE`, two named one in `"author"`, and one contradicted itself
between the two files. A reader performing licence review could get different
answers from packages built in the same repository, which is the failure this
decision closes.

Consistency here is now asserted, not assumed: `preflight-package.mjs` should
fail a publish whose `LICENSE` holder and `"author"` disagree, or which
disagrees with the rest of the catalogue. Until that assertion exists, this
record is the only thing holding the invariant.

## 26. A new export subpath on an optional-peer package is a mutable-policy edit, never a frozen-plan one

Measured on 2026-09-17 while implementing #533: adding
`"./anything": { "types": "./dist/.../index.d.ts", "import": "./dist/.../index.js" }`
to `packages/controller/package.json` and running
`npm run check:public-npm-aggregate-canary` produced two `optional-peer-manifest`
findings that no edit could clear, because the only place the gate offered to
record the new specifier — `governance/public-npm-aggregate-canary.json`'s
`optionalPeerMatrix` — is exactly the field
`validateAggregateCanaryAppendOnly` freezes on introduction (commit `edc1f07`).
PR #949 met this first and routed the new capability onto Controller's root
entry point instead, which is honest but is package design bending to satisfy
an evidence record rather than a design decision. Nothing had hit this before
#949 because no package had gained an export subpath since the freeze.

**The root cause was a join by name alone, not the freeze itself.**
`validateAggregateCanary`'s `optional-peer-manifest` rule read each of the 38
frozen matrix rows and re-validated it against
`packages/<packageKey>/package.json` in the *current* working tree, matched
only on package **name**. Every row is a closed measurement of one specific
published version — `@clossys/controller` alone appears twice, once for
`0.8.23` (baseline) and once for `0.8.24` (oidc-successor), and the source
tree has since moved to `0.9.7`. So the rule was comparing a frozen
measurement of a byte-identical historical tarball against a manifest that
was never the artifact it measured, for any commit after the freeze. Every
finding that comparison could raise was therefore structurally unclearable:
a new export produces "misses `<specifier>`", a removed one produces "has
stale export `<specifier>`", and the one file that could record either is
the one field the append-only rule forbids touching.

**The fix scopes the join to the version the row actually measured.** The
source manifest now closes a frozen row only while `packages/<packageKey>/
package.json` still declares that row's exact `name` **and** `version`; once
the tree moves past it, the row is evidence about a shipped artifact the
working tree no longer is, and validation of it moves to where the shipped
bytes actually live — the frozen closure's installed, hash-pinned packed
manifest, joined at aggregate-canary *execution* time in
`runAggregatePublicNpmCanary`, not at plan-validation time against this tree.
The freeze itself is untouched: `validateAggregateCanaryAppendOnly` still
rejects any edit to `optionalPeerMatrix`, `sets`, or `peerResolution` — the
join was loosened, not the immutability.

**A new export subpath is answered by a different, deliberately mutable
record: `OPTIONAL_PEER_POLICY` in `scripts/lib/packed-consumer-readiness.mjs`.**
It describes the *current* source tree, is enforced on every `npm run check`
through `check:packed-consumer` and its own gate-regression test
(`packed-consumer-readiness.test.mjs`, wired into `check:gates`), and is
exactly where a new subpath's `"omission row <peer> misses <specifier>"`
finding is meant to be cleared — by adding a measured row, the same way
issue #878 corrected a stale one. Both files now carry a header comment
pointing a contributor at each other, so whichever one a failure surfaces
first, the fix lands in the one that is actually editable.

**Options considered and not taken:**

- **A successor plan version.** `public-npm-aggregate-canary-v2.json` and
  `create-public-npm-aggregate-canary-v2-closures.mjs` already exist, but for
  an unrelated reason (direct current-release verification, #832-class work)
  — `validateAggregateV2Plan` never reads a source manifest at all, so v2 was
  never going to hit this defect and is not a template for fixing it. Cutting
  a v3 solely to record one new export specifier would re-freeze measurements
  of all nineteen packages to capture one row — spending the freeze rather
  than honoring it, and for every subsequent subpath addition, forever.
- **A bounded amendment mechanism for the matrix alone.** Rejected: it would
  mean a "frozen" record that is not actually frozen, undermining exactly the
  property `validateAggregateCanaryAppendOnly` exists to guarantee — that a
  measurement of already-published bytes cannot be edited to match whatever
  the source tree currently says.
- **A documented rule that Controller/Bouncer/Designer/Publisher may not gain
  export subpaths.** Rejected as a permanent constraint on package design
  driven by an evidence-record's shape, which is the complaint #533 raised in
  the first place, not an answer to it.

Regression coverage: `packed-consumer-readiness.test.mjs` gained a case
mutation-proving the collapsed `policyOutcomeShapeFindings` react-server
branch and a case proving a new export subpath is clearable purely by editing
`OPTIONAL_PEER_POLICY`; `public-npm-aggregate-canary.test.mjs` gained a case
proving the frozen matrix now joins a source manifest only at the exact
version it measured, in both directions, and remains closed while the tree
sits on that version. Both were confirmed to fail against the pre-fix source
before the fix restored them to green.

## 27. First-wave productization order is not the publication catalogue and not surface-area audit order

### Measurement before the decision

Three live orders in this repository were being used as if they answered the
same question: what work must happen so a first-wave consumer can actually
install and re-run the current `@clossys` packages as closed loops.

Measured:

1. `governance/release-catalog.json`'s active target lists
   `strategist`, `writer`, and `designer` immediately after the Trio, before
   `architect`, `observer`, `builder`, and `inspector`. That is correct
   *publication* order: publisher's first-party runtime edges are controller,
   writer, and designer, so those three must be public before publisher can
   publish. It is not a reason to productize frontend surfaces before
   operating loops.
2. Issue #897 ranks a per-package audit by consumer-facing surface area,
   most-exposed first. Its table puts publisher fourth and designer fifth,
   with advisor eleventh. That order is the right one for "what already burned
   a consumer." It is the wrong one for "what a first-wave consumer must be
   able to install as a closed loop."
3. Issue #517 still presents itself as the session entry point. A 2026-09-17
   comment on that issue recorded that its orientation command,
   `node scripts/check-package-programs.mjs`, does not exist, and that its
   programme-position table is not current. Orienting from it recreates the
   stale-table failure [LIFECYCLE.md](LIFECYCLE.md) already deleted its own
   prose table to avoid.
4. [ADOPTION.md](ADOPTION.md) already requires Advisor before any first-wave
   operating position, and already groups roles as engagement, operating
   control, strategy and expression, and agreements and custody. Decision 17
   made Advisor the engagement gate. Decision 15 removed A/B/C as a live
   operating model. None of those decisions ranked the remaining producer
   backlog against operational integrity versus frontend development.

The first-party runtime graph is unchanged: builder and inspector depend on
controller; publisher depends on controller, writer, and designer; every
other current package has no first-party runtime dependency. Advisor-before-
Controller remains engagement sequencing, not a manifest edge.

### Decision

Producer productization and first-wave install-readiness work follows
[docs/FIRST-WAVE.md](FIRST-WAVE.md) and
[`docs/contracts/first-wave-sequence.json`](contracts/first-wave-sequence.json):

1. catalogue integrity (no package: honest install docs, reachable bins,
   source/registry parity, current-version qualification);
2. Advisor;
3. Starter;
4. Controller;
5. operating control — observer, architect, inspector, builder, locksmith,
   integrator;
6. agreements and custody — bouncer, butler, messenger, giver, keeper;
7. strategy and expression — strategist, writer, designer, publisher,
   influencer.

Operational integrity stays ahead of frontend development. Publisher waits
for writer and designer at runtime and still sits in the expression wave.
Influencer waits for publisher even without a runtime edge, because
audience-response measurement is the learn stage of publication.

The release catalogue, the #897 audit order, and #517 remain what they are:
publication allowlist, surface-area audit, and historical programme record.
They are not this sequence. `npm run check:first-wave-sequence` fails when
the committed order drifts from the manifests' runtime graph, drops a
current package, breaks the Trio prefix, or lets expression outrank
operating control.

This decision does not lift the consumer-adoption hold, does not claim any
package adopted, grounded, or closed, and does not authorize a blanket
install. A first-wave consumer still opens only justified positions.

Refs: #517, #533, #567, #806, #897, #906, #909, #924

## 28. Roles read the engagement context from a snapshot in the brief, and intake cards may not reuse a context field id

### Measurement before the decision

Issue #1173 created the shared engagement context record and Advisor's
cards for it. A follow-up triage on 2026-09-23 found three gaps, each
checked against `main`:

1. The record lives only on the hub. `docs/contracts/consumer-layout.json`
   marks `clossys/advisor` as `hub-only` ("never on a product checkout"),
   and `packages/advisor/src/context.ts` places the record at
   `clossys/advisor/context.json`. Roles run in product repositories, so a
   role there had no path to what the founder already answered.
2. `docs/contracts/engagement-brief.json` -- the one Advisor-authored file
   the layout places in every staffed repository (`clossys/brief.json`) --
   had no property for the context.
3. The duplicate-question gate #1173 lists as a done-when item was not
   wired, and `docs/contracts/intake-question-cards.json` never referenced
   the engagement context.

`git grep '"intake"' -- 'packages/*/package.json'` returns nothing: no role
package declares `foundry.intake` yet, so a gate added now has nothing to
flag and constrains every intake file from its first commit.

### Decision

**The brief carries a contract-shaped snapshot.** `clossys/brief.json`
gains an optional `context` property holding the hub's engagement context
record as `docs/contracts/engagement-context.json` shapes it.
`toEngagementBrief()` takes an optional `context` and writes a normalized
copy: exactly one entry per field id, in the fixed field order, with a
field the supplied context lacks written as `unknown`, and it throws on a
field id that appears twice.
Every role, on the hub or in a product repository, reads the context
through the brief (`contextFromBrief()`), never from the hub path. The hub
record stays the single source of truth and only Advisor writes it; the
snapshot is refreshed by re-applying the plan (#1178), never edited in
place. An absent `context` reads as every field `unknown`, and so does any
single field missing from a present one: `contextFromBrief()` always
returns one entry per field id, as a copy. The brief's `schemaVersion`
stays `1`: the property is optional and no brief has been written to disk
yet (writing is wave 2, #1175/#1178).

**The snapshot widens where the context is visible, so it carries fixed
choice ids only.** The hub record sits under `clossys/advisor`, which the
layout marks `hub-only`; the brief is committed in every staffed
repository, and a product repository can be public when the hub is not.
Copying the context into the brief therefore extends its visibility to
every staffed repository -- the same exposure the brief's freeform `problem` already
has. To keep that bounded, a known field's `value` must be one of that
field's own fixed choice ids -- the answers on its Advisor question card,
never `unknown` or `something-else`. `toEngagementBrief()` accepts a
value only when `applyContextChoice(field, value)` returns `known` and
throws rather than copy anything else, and the contract lists the same ids
as a per-field `enum`, which a test keeps equal to the cards. A shape rule
is not enough: a lowercase-slug pattern would still admit a founder's
sentence once a caller slugified it (`mostly-dentists-near-our-office`), at
any length. Because the vocabulary is closed, no founder text -- a
"something else" sentence, or a slugified form of one -- can reach a
product repository through the brief.

**The context field ids are reserved intake question ids.** Matching is on
stable ids only: an intake card whose `id`, trimmed and lowercased, is
`business`, `product`, `audience`, `stage`, `intent`, or `constraints`
(read from the contract's `fieldId` enum, not a copy) duplicates a context
question. A case or whitespace variant is the same id, not a narrower
question, so intake card ids must also be lowercase slugs and the shape
check reports any other; only a genuine rename is left to review. A
role that needs one of those answers reads it from the brief; when it is
unknown there, the founder goes back to Advisor's own context card. A
narrower question (which audience segment first) uses its own id and is
not a duplicate. `scripts/check-package-framework.mjs` reports the rule as
`intake-card-duplicates-context-field`: a WARN line in report mode, which
is what CI runs, and a finding under `--enforce`, which arrives with the
rest of that gate's enforce wave (#1172). An unreadable context contract
is reported the same way (`engagement-context-contract-unreadable`), so an
enforcing run never passes on a check that did not run, and the summary
line prints how many intake files it examined.

### Alternatives considered

- **A pointer in the brief to the hub path.** Rejected: a product checkout
  cannot resolve a hub path, so the pointer only restates gap 1. It would
  also make a role's intake depend on reaching a second repository at run
  time.
- **A hub-inventory lookup (the role asks the hub, or Launcher's hub
  inventory resolves it).** Rejected for now: it needs a runtime channel
  between repositories that does not exist, and adds a failure mode
  (hub unreachable) to every intake. A snapshot degrades to `unknown`, the
  state every field already has before the founder answers.
- **Copying `context.json` itself into each repository.** Rejected: it
  would put a second Advisor-owned file under a role-owned layout and
  duplicate what the brief already is -- the one Advisor record every
  staffed repository carries.
- **Matching on prompt wording, or fuzzy id matching.** Rejected: prompt
  text is edited freely and paraphrase detection produces false positives
  a gate cannot adjudicate. Ids are the stable vocabulary a stored answer
  is keyed on (`intake-question-cards.json`'s own `rule`), so they are
  what "the same question" means. Paraphrase under a new id stays a review
  concern.
- **A runtime filter that hides a duplicating card only when the context
  field is `known`.** Rejected as the gate: it would let a role ship its
  own copy of a context question and ask it whenever the field is
  unknown -- exactly the repeated interview #1173 exists to prevent.

### Not decided here

Writing the brief to disk, and so populating `context`, is #1178. The
Strategist pilot reading `contextFromBrief()` first is #1173's own
remaining item. Promoting the rule to a failure is #1172's enforce wave.
Whether a public product repository should receive the snapshot at all is
for #1178, the first writer of the brief, to settle.

Drift detection is not decided here. The snapshot carries no digest of the
hub record and no timestamp, so nothing can yet report that a brief's
`context` is older than the hub's: if the founder answers a question after
the plan is applied, a product-repository role keeps reading the older
answer (or `unknown`) until the plan is re-applied. A later hub-side check
would need a source digest on the snapshot; adding one belongs with the
writer in #1178, not as a field declared ahead of anything that writes or
reads it.

Refs: #1171, #1172, #1173, #1176, #1178
