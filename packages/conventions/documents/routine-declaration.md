# Routine declarations

Two scheduling layers exist and must not merge. Work that runs without a model
is a **schedule**: continuous integration, an application's own cron runtime, an
operations ticker. Work that needs an agent session to exercise judgment is a
**routine**: a trigger that invokes a procedure exactly as a person would.

This document defines the grammar a routine declaration must satisfy. The
values it declares belong to the plane that owns the work, never here.

## A routine is a pointer, not a procedure

A routine declares only which procedure to invoke, how often, and against what
scope. It never restates the procedure, and it never carries a copy of one.

This is the entire anti-rot rule, and it is written from a real failure. An
operator's routines each inlined a long procedure with an absolute path frozen
at install time. A later topology migration invalidated every one of them at
once, and nothing turned red, because no checker could see inside a body that
lived outside every repository. A pointer to a versioned, reviewed procedure
survives a migration that a frozen copy cannot, because the procedure is what
changes and the pointer is not.

Two consequences follow, and both are mechanical rather than advisory:

- The skill a routine invokes must contain no absolute path. Scope arrives from
  the declaration and is resolved against the plane's own registry at run time.
- That skill must not name a repository either. Naming one duplicates a fact the
  registry already owns, and duplicated facts drift in exactly one direction.

## Required fields

A declaration carries an identifier unique within its plane, the name of a
skill the plane owns, a cadence drawn from a closed list the plane declares, a
scope expressed as registry identifiers, a mode stating how far the routine may
act unattended, and a purpose in prose. Skill identity is composite: omitting
`skillRepository` targets the declaring plane's closed skill root, while a
repository-scoped target names its governed owning repository explicitly.

The target is always a skill, never a document. Allowing a routine to point at
prose in some other repository puts the procedure somewhere the plane can
neither version nor check, which is the same failure as inlining it, arrived at
politely. The skill is the procedure.

A plane-scoped skill is always unqualified. This forces it through the ordinary
validator's closed plane-root list; only a repository-scoped skill carries
`skillRepository`. The capability registry then confirms the qualified target
exists and the routine scope is a subset of its declared coverage.

A skill invoked by a clock must declare in its description that it is not
conversationally triggered. Skills compete for invocation, and a crowded list
does not fail politely by leaving one skill unreliable — it degrades every
skill sharing that list. A routine's skill should never win a selection it was
not scheduled for.

## Scope is closed

Every identifier in a routine's scope must name a repository the declaring
plane governs. There is no escape hatch, and deliberately not even a declared
one with a stated reason.

Planes are peers. A routine reaching across an account boundary is one plane
holding standing authority over repositories it does not own, and making that
reach visible does not make it legitimate — a documented crossing is still a
crossing, and it outlives whatever relationship justified it.

Where work genuinely needs doing on the other side of a boundary, the plane
that owns those repositories declares its own routine. If that plane chooses
not to, the work does not happen; that is a real consequence to be recorded and
decided, not routed around.

## Migrating an existing body into a skill

A body that predates this grammar is rarely a redundant copy of the procedure it
names. Bodies accumulate: a gotcha learned from an incident, a second tool the
documentation never mentioned, a correction someone verified once and wrote down
in the only place they were editing. Treat a body as a candidate source of truth
until proven otherwise, and check coverage item by item before reducing it.

The skill becomes the union of what the body and the existing documentation each
knew. Deleting the body first destroys the difference, and does so invisibly,
because what is lost is precisely what nothing else records. Machine-level rules
found among that content — shell behavior, branch discipline, secret handling —
belong in machine guidance rather than in any one skill.

Where a body contradicts the documentation it claims to follow, neither may be
edited to match until someone decides which is right. A body carrying no clause
deferring to its source cannot resolve such a conflict on a later run.

## Declared intent is not live state

A scheduler's registration — whether a routine is installed, whether it is
enabled, when it last ran — lives in the scheduler's own store, not in any
repository. A declaration is therefore intent, and a plane must never present
it as proof that anything runs.

How a plane resolves that gap depends on a boundary it does not choose:

- Where the scheduler belongs to someone the plane does not govern, live state
  is genuinely unreadable. The plane declares intent, says plainly that it
  cannot verify installation, and supplies a prompt its members install
  themselves.
- Where the scheduler belongs to the same principal that owns the plane, live
  state is readable and the plane must reconcile against it. Declaring intent
  honestly is not sufficient when the answer is available; an unreconciled
  declaration is how a routine stays dead and uncontradicted.

Reconciliation reports four findings: declared but not registered, registered
but not declared, registered in a state the declaration did not ask for, and a
registered body that is not a plain invocation of its declared skill.

The last is not a leftover from an earlier design. Adopting this grammar does
not rewrite what a scheduler already holds, so an identifier retained across
the change still carries whatever body was installed under it -- typically the
inlined procedure this grammar exists to eliminate, complete with the frozen
paths and stale claims that motivated it. It is the most dangerous state in the
system: a declaration that reads correctly, over a body that would actually
run. Nothing in a checkout can see it, so reconciliation is the only thing that
can.

## Deterministic checks and the reconciliation boundary

A declaration's internal consistency is deterministic and belongs in the
plane's ordinary offline checks: field presence, unique identifiers, cadence
and mode drawn from the declared lists, every scope identifier present in the
registry, every skill resolving inside the plane's own skills root, and the
body-content rules above — which are checkable precisely because the body is a
versioned skill in the same checkout. These hold anywhere the plane is checked
out, and gate on every change.

A check that reads the machine is not one of these. Probing a scheduler's store
makes a verdict depend on which machine ran it, so it passes in continuous
integration for the opposite reason it passes locally. Keep the deterministic
checks reading only the checkout, and give live reconciliation to the surface
that can actually perform it.

Splitting these is what keeps a green check honest: an offline pass proves the
declaration is well-formed, and never that the work runs.

## Exclusions are recorded, not assumed

A procedure deliberately kept off a schedule is recorded with its reason
alongside the routines. An absent exclusion is indistinguishable from an
oversight, and an oversight is what a later reader helpfully corrects.

Exclusions use the same composite identity. An unqualified exclusion names a
plane-root skill. A repository-scoped exclusion adds `skillRepository`, so two
governed repositories may deliberately exclude different procedures sharing a
name. The qualifier must be a non-empty governed repository identifier.
