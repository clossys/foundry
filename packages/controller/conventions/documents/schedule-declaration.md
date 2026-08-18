# Schedule declarations

Two scheduling layers exist and must not merge. Work that needs an agent session
to exercise judgment is a **routine**, and `routine-declaration.md` defines its
grammar. Work that runs without a model is a **schedule**: continuous
integration, an application's own cron runtime, an operations ticker.

This document defines the grammar a schedule declaration must satisfy. The
values it declares belong to the plane that owns the work, never here.

## Why the tiers stay apart

The two tiers look alike from a distance. Both carry an identifier, a cadence, a
scope, and an intended state; both are invisible when they stop working. The
temptation is to collapse them into one list, and the reason not to is what each
one points at.

A routine points at a procedure a model reads. Its grammar can therefore demand
that the body contain no absolute path, name no repository, and announce that it
is not conversationally triggered — rules that are meaningful precisely because
prose is the thing being invoked.

A schedule points at deployed code. There, naming a repository and a path is not
a defect but the entire content of the pointer. A checker can confirm a skill
exists and reads correctly; it cannot confirm that about a compiled artifact
running on someone else's infrastructure, and it must not pretend otherwise.

Merging the tiers does not produce one strong grammar. It produces one grammar
that enforces the weaker half of each.

## The execution host is not the discriminator

A schedule may run anywhere a clock exists, and so may a routine. The same
continuous-integration runner can host a job that never calls a model and a job
whose only purpose is to call one. Tier and host vary independently, and a
declaration must state both because neither implies the other.

The host belongs in the declaration for a harder reason than description. A
schedule is the only tier whose work happens somewhere the declaring plane does
not run. Without a declared host there is nothing to reconcile against, and
nothing to reconcile against is how a schedule stops silently.

## Required fields

A declaration carries an identifier unique within its plane, a cadence, a scope
expressed as registry identifiers, an execution host drawn from a closed list the
plane declares, an artifact naming what actually runs, and a purpose in prose.

The artifact is a repository-relative location, never an absolute path. This is
the same anti-rot rule the routine tier applies to a skill body, and it exists
here for the same reason: a path frozen at authoring time survives no migration,
and a declaration that still reads correctly while pointing at nothing is worse
than one that is obviously broken.

## Cadence is an expression, not a word

A routine's cadence may be a word, because the scheduler that reads it belongs
to the same plane that declares it. A schedule's cadence must be the expression
the host itself will match, because the host is a stranger.

This is the tier's signature failure. Where a runtime dispatches by comparing the
fired cadence against its own table, the declaration and the host's trigger
configuration are two copies of one fact. When they disagree, nothing errors: the
clock fires, no branch matches, and the work silently does not happen. A
schedule that carries its cadence in more than one place must therefore state the
correspondence, so that a check can compare the copies rather than trusting that
someone kept them aligned.

## Scope is closed

Every identifier in a schedule's scope must name a repository the declaring plane
governs, resolved from that plane's registry at run time rather than written into
the artifact.

This is the rule that decides where a schedule lives. A schedule acting on
several repositories belongs to the plane that governs them, not to whichever one
happened to host it first. A repository that schedules its siblings holds standing
authority over work it does not own, and the arrangement is self-concealing: when
one of those siblings removes the endpoint the schedule targets, the removal is
invisible from inside the repository doing the removing, because the thing
pointing at it lives somewhere that repository never reads.

Scope closure is what makes that structural, rather than a matter of remembering.

## A declaration is not a deployment

Declaring a schedule states intent. Whether the artifact is deployed, whether the
host holds the cadence the declaration names, and whether the deployed copy is the
one that was reviewed are all state belonging to the host, and no check reading a
repository can see any of it.

This gap is wider in this tier than in the routine tier, and more dangerous,
because deployment is usually a manual step that merging does not perform. An
artifact can be merged, reviewed, and correct while the host continues to run an
older copy — for as long as nobody looks. The failure produces no error, no
alert, and no diff; the schedule keeps running, just not the schedule that was
approved.

A plane must therefore name the surface that reconciles declared intent against
deployed reality, and must state plainly that a green offline check never means
the work runs. Reporting a passing declaration check as evidence that a schedule
is live is the specific mistake this rule exists to prevent.

This is one instance of a shape `live-state-reconciliation.md` names once: a
declaration of intent, a live state owned elsewhere, a reconciliation surface
that may not exist yet, and the same failure mode if a green offline check is
mistaken for the whole answer. `scheduleReconciliationFindingKinds` (four
findings: declared but not deployed, deployed but not declared, a deployed
cadence differing from declared, a deployed artifact predating its
declaration) is this tier's own wording of that document's four drift
findings, plus the fifth state — could-not-verify, with a named blocker —
that a reconciliation surface built against this tier's live state should
report whenever the host cannot currently be read, rather than omitting the
check.

## Deliberate absences are declared

A schedule whose target is not yet live is declared with its host connection
explicitly unconfigured, rather than omitted. An unconfigured target that is
skipped and reported is a fail-closed state a reader can verify; an absent one is
indistinguishable from an oversight.

The same applies to work deliberately kept off a clock. An exclusion carries a
reason, because an unexplained absence is what a later reader helpfully corrects.
