# Capability-first skill registry

A skill registry answers one question honestly: for a required piece of
functional coverage, which skill actually provides it, and which part is
still open. It says nothing about when a skill runs. Tempo belongs to a
routine; coverage belongs to the registry. Deleting or pausing a routine
must never make coverage disappear, because coverage was never the
routine's to hold.

## Required model

- **Skill identity is a pair: `(repository, name)` for a `repo`-scoped
  skill, or `(scope, name)` for an `account`- or `third-party`-scoped one.**
  An account may own several skills that happen to share a bare name across
  different repositories, or one `repo`-scoped skill and one `account`-scoped
  skill sharing a name; neither collides. What must never repeat is the full
  identity — the same name at the same repository, the same name at account
  scope twice, or the same name declared third-party twice. A duplicate
  identity is a finding; a duplicate bare name on its own is not.
- **Scope is exactly one of three tiers: `account`, `repo`, or
  `third-party`.** Assign a skill's tier by asking which test it passes —
  not by guessing which sounds closest:

  | tier | test |
  | --- | --- |
  | `account` | operates on one account's own repository inventory |
  | `repo` | operates inside a single repository |
  | `third-party` | vendored from an external source; has no owning account |

  A `repo`-scoped skill must name the one repository it belongs to, and
  everything it claims to cover must stay inside that repository. A skill
  that claims coverage of a target outside its own declared repository has
  escaped its scope — that is a finding regardless of how accurate the claim
  might actually be, because a `repo`-scoped skill has no standing to make
  it. An `account`-scoped skill must not name a repository at all: its
  coverage is not bounded to one. A `third-party` skill must not carry a
  repository either, and it is never required to — see below.

  **There is deliberately no fourth, "machine" or plane-spanning, tier.** A
  skill encodes judgment about a specific inventory someone actually
  reviewed — an account's repositories, or one repository's own internals.
  "The machine" is not an inventory; it is the substrate several accounts'
  inventories happen to share, and nobody's judgment about their own
  inventory transfers to it just because it runs there too. A tier that
  claimed to span every account would either duplicate whichever
  account-scoped skill already did the real reviewing, or claim coverage
  nobody actually reviewed — and the registry's whole job is to make that
  distinction checkable, not to open a tier that erases it.

  Two legacy spellings are rejected outright rather than silently accepted
  or left to a generic "invalid" error: `plane` (this registry's own former
  name for `account`) and `workspace` (an independent name a different
  consuming account settled on for the identical concept) both fail with a
  message naming `account` as the replacement. The former `repository` value
  fails the same way, naming `repo`. A caller migrating existing data gets
  told what to write, not just that what it wrote no longer works.
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
- **A `third-party` skill is inventoried, not assumed, and its tier already
  says so.** Declaring `scope: "third-party"` means it can never be counted
  toward a first-party capability's coverage — even if it happens to declare
  the exact same targets a first-party skill would. Coverage that depends on
  code no account here owns and cannot change is not coverage that account
  can rely on. Because a `third-party` skill has no owning account, it
  cannot carry a `repository` field, and — unlike a `repo`-scoped skill — it
  is never required to name one.
- **A routine's validation is exactly two checks: does the target skill
  exist, and is the routine's scope a subset of what that skill already
  declares it covers.** A routine cannot grant coverage a skill never
  claimed, and disabling or omitting a routine cannot take coverage away
  from a skill that still claims it. Tempo and coverage are different
  facts, checked independently, and this is the whole reason they are kept
  in different places.
  A repository-owned target uses composite identity through
  `skillRepository`; an account-scoped or third-party target must remain
  unqualified so it cannot bypass the account root's ordinary closed skill
  list.

## Hard boundary

This is schema plus pure functions over data the caller supplies. There is
no filesystem read, no GitHub call, no scheduler probe, no credential, and
no network access anywhere in this contract, and there must never be. A
registry document is just data; a validator takes a registry (and, for
routine checks, one routine query) and returns findings. Nothing here
mutates anything, executes anything, or remembers state between calls.
Decoded caller JSON is accepted as `unknown`; malformed top-level or nested
shapes produce deterministic findings rather than exceptions.

Everything about which repositories exist, which skills an account has
actually built, which capabilities that account cares about, and which gaps
it has chosen to accept is that account's own fact, declared as input. This
document defines the shape that input must satisfy; it does not choose the
values.
