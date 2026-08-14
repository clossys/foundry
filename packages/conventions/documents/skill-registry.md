# Capability-first skill registry

A skill registry answers one question honestly: for a required piece of
functional coverage, which skill actually provides it, and which part is
still open. It says nothing about when a skill runs. Tempo belongs to a
routine; coverage belongs to the registry. Deleting or pausing a routine
must never make coverage disappear, because coverage was never the
routine's to hold.

## Required model

- **Skill identity is a pair: `(repository, name)`.** A plane may own
  several skills that happen to share a bare name across different
  repositories, or one repository-scoped skill and one plane-scoped skill
  sharing a name; neither collides. What must never repeat is the full
  pair — the same name at the same repository, or the same name at plane
  scope twice. A duplicate pair is a finding; a duplicate bare name on its
  own is not.
- **Scope is `plane` or `repository`.** A `repository`-scoped skill must
  name the one repository it belongs to, and everything it claims to cover
  must stay inside that repository. A skill that claims coverage of a
  target outside its own declared repository has escaped its scope — that
  is a finding regardless of how accurate the claim might actually be,
  because a repository-scoped skill has no standing to make it.
- **A capability declares a required target set.** The target set is
  whatever the capability needs covered — most often a list of repository
  identifiers, but the registry does not interpret the string itself, only
  compares it.
- **A skill declares which capability, and which targets within it, it
  implements.** Coverage for a capability is the union of every first-party
  skill's declared targets for that capability. This is deterministic set
  arithmetic: required, minus covered, minus accepted gaps, leaves what is
  actually missing.
- **An accepted gap needs both a durable reason and an issue or ADR
  reference.** A gap recorded with only one, or neither, is not a quieter
  version of an accepted gap — it is its own finding. Treating a
  half-recorded gap as sufficient to excuse missing coverage would let an
  unexplained hole close itself just by being labeled, which defeats the
  entire reason a gap needs recording in the first place.
  Evidence follows a mechanical grammar: either a parsed HTTPS URL with a
  valid host, no credentials or query, and final path segments
  `issues/<positive integer>`; or a repository-relative Markdown path with no
  absolute, current-directory, or parent-traversal segments and an `adr`,
  `adrs`, `decision`, or `decisions` directory or filename prefix. Hidden
  metadata directories such as `.github/decisions/` are valid path segments.
- **Third-party skills are inventoried, not assumed.** A skill installed
  from outside the plane can be marked as such, and marking it that way
  means it can never be counted toward a first-party capability's coverage
  — even if it happens to declare the exact same targets a first-party
  skill would. Coverage that depends on code the plane does not own and
  cannot change is not coverage the plane can rely on.
- **A routine's validation is exactly two checks: does the target skill
  exist, and is the routine's scope a subset of what that skill already
  declares it covers.** A routine cannot grant coverage a skill never
  claimed, and disabling or omitting a routine cannot take coverage away
  from a skill that still claims it. Tempo and coverage are different
  facts, checked independently, and this is the whole reason they are kept
  in different places.
  A repository-owned target uses composite identity through
  `skillRepository`; a plane-scoped target must remain unqualified so it cannot
  bypass the plane root's ordinary closed skill list.

## Hard boundary

This is schema plus pure functions over data the caller supplies. There is
no filesystem read, no GitHub call, no scheduler probe, no credential, and
no network access anywhere in this contract, and there must never be. A
registry document is just data; a validator takes a registry (and, for
routine checks, one routine query) and returns findings. Nothing here
mutates anything, executes anything, or remembers state between calls.
Decoded caller JSON is accepted as `unknown`; malformed top-level or nested
shapes produce deterministic findings rather than exceptions.

Everything about which repositories exist, which skills a plane has
actually built, which capabilities that plane cares about, and which gaps
it has chosen to accept is the plane's own fact, declared as input. This
document defines the shape that input must satisfy; it does not choose the
values.
