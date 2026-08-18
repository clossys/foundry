# Live-state reconciliation

`routine-declaration.md` and `schedule-declaration.md` each independently
reach the same conclusion: a declaration states intent, live state is owned
by somewhere else, and a green offline check must never be presented as
proof that either one runs. This document names that conclusion once, as a
contract any subject can adopt, rather than leaving it as a paragraph each
tier rewrites in its own words.

## Three subjects, one shape

A scheduler's registration, a deployed artifact, and a repository standard
read back through a script look unrelated from a distance — a routine tier,
a schedule tier, and a policy-configuration check, owned by different parts
of a plane. Read closely, each one is the same four things:

- a declaration of intent, checkable offline;
- a live state owned by somewhere else;
- a reconciliation surface that may or may not exist yet;
- and a failure mode where the offline check goes green and is mistaken for
  the whole answer.

A plane that treats these as three unrelated subjects ends up with three
unrelated postures for the one condition they all share: the probe could not
run. One check might report that condition as `skipped`, harmless only for
as long as nothing downstream reads a skip as a pass. A sibling check in the
very same plane might fail closed on the identical condition, and say why in
an inline comment. Neither author is careless — there was simply nothing
shared to conform to, so each one picked a posture alone. This document is
that shared posture, so the next check does not have to pick one at random.

## Required fields

A declaration names four things, in prose:

- **`store`** — where the live state actually lives. Not a schema, not a
  type — a sentence a person could act on: an S3 bucket a platform team
  owns, a branch-protection API, a scheduler's own installed-skill table.
- **`readableByScript`** — an explicit boolean, never left implicit.
  Defaulting this on a declarer's behalf would be the document deciding
  something about infrastructure it cannot see.
- **`readableBy`** — the named surface or command that reads `store`,
  required whenever `readableByScript` is `true`.
- **`reconciledBy`** — what performs the reconciliation instead, required
  whenever `readableByScript` is `false`. A live state a script cannot read
  is not exempt from reconciliation; it is reconciled by something else,
  and that something else must be named.
- **`note`** — required in every declaration, and the one field this
  contract insists on above the other four: a plain statement that a green
  offline check is not evidence the declared thing is live. A declaration
  that omits this field, or states it vaguely, has not actually said the
  thing the whole contract exists to say.

## Three states, never two

A reconciliation attempt reports exactly one of three outcomes:

- **verified** — the declaration and the live state were both read, and
  they agree.
- **drifted** — both were read, and they disagree. Reported as one of four
  findings: declared but not live, live but not declared, live differing
  from declared, or a live artifact that predates the declaration claiming
  to describe it (agreement here proves nothing about intent — the artifact
  was already there before whatever wrote the declaration).
- **could-not-verify** — the read did not happen at all, for a named
  reason. Never a fifth finding alongside the four above; a different kind
  of outcome entirely, because nothing was actually compared.

The third state is the one addition this document makes over an ordinary
pass/fail check, and it is the point of the whole contract. A two-state
result collapses "I read the live state and it agreed" and "I never read
the live state at all" into the same green outcome. Both existing tiers
already learned a version of this lesson on their own terms — see the next
section — but neither one named the state where the probe itself could not
run. **A reconciliation surface that cannot currently read live state is a
declared gap with a named blocker, not a silent pass, and not a reason to
drop the field.** The blocker is required, not optional: "could not verify,
and I decline to say why" is not a result this contract allows to exist.

A green run through a reconciliation surface is therefore never, by itself,
evidence that the declared thing is live. It is evidence that whatever was
actually evaluated came back clean. The `note` field exists so that
distinction is stated in the declaration itself, next to the fields that
make reconciliation possible at all, rather than left as background
knowledge a reader has to already hold.

## How the routine and schedule tiers specialize this

`routine-declaration.md` and `schedule-declaration.md` each ship their own
finding vocabulary — the routine tier's four (declared but not registered,
registered but not declared, registered in an unrequested state, a
registered body that is not a plain skill invocation) and the schedule
tier's four (declared but not deployed, deployed but not declared, a
deployed cadence differing from declared, a deployed artifact predating its
declaration). Both are specializations of the four drift findings above,
worded for what each tier's live state actually is: a scheduler's own
store in one case, a stranger's deployment host in the other.

Neither vocabulary is being replaced. Each stays exactly as it is, because
each already names something this general contract cannot: what "the
subject" concretely means for that tier, and what a live probe concretely
has to do to answer it. What changes is that both are now documented as
what they always were — instances of one shape — rather than two
coincidentally similar designs that happened to arrive at the same
structure independently. A third instance adopting this contract afresh
should reuse this document's vocabulary directly, the same way the routine
and schedule tiers' own four-finding lists already map onto it, rather than
inventing a third wording of the same five ideas.

## A declaration is not a deployment, a registration, or a configuration

Declaring a live-state surface states intent. Whether the store actually
holds what is declared, whether it agrees, and whether anyone has looked
recently are all facts belonging to the store, and no offline check reading
a declaration can see any of them. This is not a gap unique to one tier —
`routine-declaration.md` and `schedule-declaration.md` each state it for
their own subject, and it holds identically for any third subject this
contract is applied to.

Reporting a passing declaration check as evidence that the declared thing is
live is the specific mistake this whole document exists to prevent. The
`note` field is where a declaration commits, in its own words, to not making
that mistake.

## Deliberate absences are declared

A live-state surface that is not yet reconcilable — no script can read the
store, and nothing else has been assigned to check it either — is declared
with `readableByScript: false` and a `reconciledBy` naming the gap
explicitly (a scheduled human review, an upcoming credential grant, a
process not yet built), rather than omitted from the declaration entirely.
An omitted field reads as an oversight nobody noticed; a declared gap with a
named blocker reads as a fact a later reader can act on, escalate, or
accept — and is exactly what `liveStateCouldNotVerify`'s required blocker
argument enforces at the type level for any reconciliation surface built on
this contract.
