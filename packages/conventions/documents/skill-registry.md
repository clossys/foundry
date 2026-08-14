# Capability-first skill registries

A skill registry declares functional coverage. A routine may invoke one of its
skills on a cadence, but it never creates that coverage: disabling every
routine must leave the registry's answer unchanged.

This convention defines schema version 2. The values belong to the declaring
plane. This package contains no account, repository, path, scheduler, or
credential inventory.

## Identity and placement

A skill's identity is the pair `(repository, name)`. Repository-scoped skills
in different repositories may share a name when they implement the same local
workflow. A duplicate pair is always an error.

Scope is one of:

- `plane`: the skill may cover more than one governed repository and its source
  lives in the repository the caller identifies as the plane repository.
- `repository`: the skill may cover only the repository that owns its source.

First-party names satisfy the skill grammar. Third-party skills retain their
upstream names, are inventoried with `source: "third-party"`, and cannot satisfy
first-party capability coverage merely by being present.

## Capabilities and coverage

Each capability has a stable identifier, a purpose, and an explicit required
set of repository identifiers. Each first-party skill lists the capability and
subset it implements. Coverage is the set union of those implementations.

A valid registry accounts for every required pair of capability and repository
in exactly one of two ways:

1. at least one first-party skill covers it; or
2. an accepted gap names it, gives a non-empty reason, and cites a durable HTTPS
   issue or repository-relative decision/ADR path.

An accepted gap is not coverage. It is durable evidence that the absence was
seen and decided. The validator reports a stale gap once an implementation
does cover the same pair.

The evidence grammar is deliberately mechanical. An issue reference must parse
as an HTTPS URL with a valid host, no credentials or query, final path segments
of `issues` and a positive integer, and an optional fragment. A
repository-relative decision reference is a Markdown path with no absolute or
parent segments and either:

- a directory segment named `adr`, `adrs`, `decision`, or `decisions`; or
- a filename beginning `adr-`, `adr_`, `decision-`, or `decision_`.

Hidden repository metadata directories are valid path segments. A leading
current-directory segment is not; references remain canonical paths from the
repository root.

An issue URL ending in `issues` plus a positive numeric identifier qualifies,
as does a Markdown file beneath a decisions directory or named with an ADR
prefix. A site root, ordinary source path, or arbitrary nested Markdown file is
not decision evidence. A gap with an invalid reason or reference does not
satisfy coverage.

## Version 2 shape

```json
{
  "schemaVersion": 2,
  "capabilities": [
    {
      "id": "repository-integrity",
      "purpose": "Review declared repository policy against the tree.",
      "repositories": ["control", "product"]
    }
  ],
  "skills": [
    {
      "repository": "control",
      "name": "ex-audit-repository-integrity",
      "scope": "plane",
      "source": "first-party",
      "implements": [
        {
          "capability": "repository-integrity",
          "repositories": ["control", "product"]
        }
      ]
    },
    {
      "repository": "product",
      "name": "provider-database-guide",
      "scope": "repository",
      "source": "third-party"
    }
  ],
  "acceptedGaps": []
}
```

The caller separately supplies the governed repository identifiers, plane
repository, first-party prefixes, and provider namespaces. Those are plane
facts rather than portable defaults.

## Routines add tempo only

`validateRoutineSkillCoverage` resolves a routine's target using
`skillRepository` when present, or the caller's plane repository otherwise. It
checks only that the first-party skill exists and that the routine scope is a
subset of the skill's declared coverage.

It does not inspect cadence, install a routine, or read live scheduler state.
The ordinary routine validator still checks cadence, mode, and plane scope;
live reconciliation remains a separate session capability.

## Consumer migration patterns

For a plane that currently discovers skills only from its own tree:

1. inventory current skills using repository-qualified identity;
2. declare capabilities without consulting routine declarations;
3. move every default target set from routine-dependent skill prose into the
   capability registry;
4. record deliberate gaps with durable references; and
5. validate routines against the finished registry only after coverage passes.

For a plane that already has a central cross-repository skill inventory:

1. preserve its repository-owned rows;
2. replace global name uniqueness with composite identity;
3. add capability requirements and per-skill coverage;
4. keep repository API or checkout auditing in plane-owned tooling; and
5. distribute only this contract, never account-owned skill bodies.

The validator is pure set arithmetic. Repository discovery, tree inspection,
GitHub access, filesystem reads, scheduler state, and all mutation stay in the
consumer that owns those authorities. Callers may pass decoded JSON directly:
malformed documents, entries, or options produce deterministic findings rather
than exceptions.
