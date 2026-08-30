# Decisions

The identity decisions below are made, not placeholders, so a future reader
doesn't have to reconstruct the reasoning from git history.

## 1. The publishing scope — `@clossys`

**Status:** set in [`package-scope.json`](../package-scope.json).

The transferred `clossys/platform` producer owns the complete nineteen-package
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

## 2. The registry — public npm Trio published, trusted publishing pending

**Status:** `https://registry.npmjs.org`, scope `@clossys`, and explicit public
access are declared together in [`package-scope.json`](../package-scope.json).
All package manifests carry the same tuple. W1D left publication and OIDC trust
inert. W1E has since published and anonymously verified the first Trio
identities: Advisor 0.1.3, Starter 0.1.2, and Controller 0.8.21. These
owner-present releases do not yet carry npm trusted-publisher/OIDC provenance.
Publication and installation are not consumer adoption, independent grounding,
or closure.

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
  [issue #213](https://github.com/vespeneventures/foundry/issues/213), which
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

**Status:** documented, not worked around. [Issue #226](https://github.com/vespeneventures/foundry/issues/226)
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

**Status:** `clossys/platform` is the public neutral producer. The prior
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
Issue [#567](https://github.com/vespeneventures/foundry/issues/567) is the
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
transferred `clossys/platform` repository, and all 19 source identities plus
their first-party edges have moved together to `@clossys`. Exact predecessor
lines remain only through the content-addressed history inventory. The
producer programme remains tracked by
[#567](https://github.com/clossys/platform/issues/567), with W1D's reviewed
source result retained in
[#593](https://github.com/clossys/platform/issues/593).

W1D proved reversible source readiness only. W1E has now completed the first
irreversible Trio publications and anonymous registry verification. npm trusted
publishing and provenance remain unproved. These producer facts create no
consumer adoption, independent grounding, closure, or consumer-outcome
evidence.

The remaining critical path is deliberately narrow:

1. Retain the completed W1E [#594](https://github.com/clossys/platform/issues/594)
   evidence for the owner-present Advisor 0.1.3, Starter 0.1.2, and Controller
   0.8.21 publications, including anonymous public access and served-digest
   parity.
2. Enable the Trio's
   npm trusted-publisher bindings. The later activation must satisfy the
   protected `npm-publish` environment/reviewer, Node `>=22.14`, npm `>=11.5.1`,
   upload-job-only `id-token: write`, and no token environment. Prove each
   binding with a bounded patch release and verify npm provenance plus
   served-byte parity; configuring trust alone is not publication evidence.
3. Run one minimal credentialless consumer smoke test from a clean disposable
   project. Install the exact public Trio, exercise the qualified Advisor and
   Starter CLI controls plus Controller's selected public surface, and prove
   removal/reinstall rollback. Retain commands, versions, exits, and served
   digests under W1E.

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

## Settled

**Author attribution — keep a real name in the `"author"` field.** A real
author name is conventional in open source, and the MIT licence requires a
named copyright holder to be a valid grant. The gate's `neutralize` list is
path-scoped to `package.json`, where that field actually lives — this
document deliberately does not repeat the literal value, since a doc file is
not one of the neutralized paths and would fail the same gate it describes.
