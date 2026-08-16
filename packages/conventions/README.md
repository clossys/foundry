# @vespeneventures/conventions

Account-neutral agent conventions that two parties can share without either
owning the other — branch provenance, skill naming, agent interoperability,
routine declarations, CI gate naming, and a capability-first skill registry —
shipped as default documents plus the validators that enforce their grammar.

The shipped machine guidance treats a configured workspace root as a local
discovery location, not a singular authority. Applicable account-owned
workspace planes are discovered from caller-owned policy and composed without
letting discovery order become precedence.

```bash
npm install @vespeneventures/conventions
```

## The problem this closes

An operator running coding agents across more than one account ends up needing
the same handful of rules in every one of them: how an agent-created branch is
named, how a reusable workflow is named and who owns it, what a scheduled
trigger may point at.

Putting those rules in one account's repository and having the others read them
makes that account govern the rest. Copying them into each account makes them
drift, silently, in the direction that is hardest to notice — each copy stays
internally consistent while the set stops agreeing.

Neither is acceptable between peers. The way out is for the shared rules to
live somewhere neither party owns, which in practice means published and
public. That is this package.

## What it does and does not enforce

It enforces the **grammar**: that a branch names its creating agent, that a
skill name parses as `<owner>-<verb>-<what>` with a verb from a closed list,
that a routine declares every required field and scopes only repositories its
own plane governs, that a CI gate name parses as verb-noun with no account or
repository prefix, that a capability-first skill registry's identities,
scopes, and accepted gaps are internally consistent, and that shared content
names no absolute path or operator-specific home directory.

It ships the **prose** as a default, and never gates on byte-identity with it.
A consumer that adopts the documents verbatim and one that rewrites them
entirely are both conforming, so long as what they declare satisfies the
grammar. Requiring its own wording back would make this a seeder wearing a
standard's clothes — and a check that compares against what a manifest claims,
rather than against what is actually in place, is the failure mode this whole
design exists to avoid.

Values are always the caller's. This package never contains a list of accounts,
repositories, workspace planes, exact roots, prefixes, or cadences; every
validator takes them as input. Repository inventory, observations, topology,
privacy, retention, and composition decisions remain with their owning planes.
That is what keeps it publishable.

## Usage

```ts
import {
  scanNeutrality,
  validateBranchName,
  validateGateName,
  validateGateSet,
  validateRoutineSet,
  validateSkillSet,
} from "@vespeneventures/conventions";

// Branch provenance. Which agents exist is your plane's fact, not this package's.
const findings = validateBranchName("claude/extract-governance", {
  agents: ["codex", "claude"],
  exempt: ["main"],
});

// Skill naming, against your own registered prefixes.
validateSkillSet(["ex-audit-dependencies"], { prefixes: ["ex"] });

// Routine declarations, against your own closed lists.
validateRoutineSet(declarations, {
  repositories: ["owned-one"],
  skills: ["ex-audit-dependencies"],
  cadences: ["daily", "weekly"],
  modes: ["report-only", "apply"],
});

// CI gate naming. The five-name default is a suggestion, not a requirement --
// any conforming verb-noun set validates, and GATE_VERBS may be extended with
// a real verb of your own through GateNameOptions.verbs.
validateGateName("scan-secrets"); // []
validateGateSet(["scan-secrets", "check-task-record", "verify-repository"]);

// Neutrality, before publishing anything shared.
scanNeutrality(documentText, { forbiddenNames: myPrivateNameList });

// Capability-first skill registry, against your own capabilities and skills.
import {
  SKILL_REGISTRY_SCHEMA_VERSION,
  computeCapabilityCoverage,
  validateRoutineCoverage,
  validateSkillRegistry,
} from "@vespeneventures/conventions";

const skillRegistry = {
  schemaVersion: SKILL_REGISTRY_SCHEMA_VERSION,
  capabilities: [
    {
      id: "dependency-freshness-review",
      description: "Repositories reviewed for dependency drift on a recurring basis.",
      requiredTargets: ["repo-a", "repo-b"],
    },
  ],
  skills: [
    {
      name: "review-dependency-freshness",
      scope: "repository",
      repository: "repo-a",
      implements: [{ capability: "dependency-freshness-review", targets: ["repo-a"] }],
    },
  ],
  acceptedGaps: [
    {
      capability: "dependency-freshness-review",
      target: "repo-b",
      reason: "repo-b is archived and receives no further dependency work.",
      reference: "https://github.com/example/project/issues/42",
    },
  ],
};

validateSkillRegistry(skillRegistry);
computeCapabilityCoverage(skillRegistry, "dependency-freshness-review"); // { required, covered, acceptedGaps, missing }

// A routine only ever confirms two things: the skill resolves, and the
// routine's own scope is a subset of what that skill already declares.
validateRoutineCoverage(
  { skill: "review-dependency-freshness", skillRepository: "repo-a", scope: ["repo-a"] },
  skillRegistry,
);

for (const f of findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
```

Every validator returns `Finding[]` and never throws, prints, or exits. A
repository gate exits non-zero on a finding; a migration tool reports and
continues. Encoding that choice here would make the package usable in exactly
one of those roles.

## Shipped documents

Resolve a path with `documentPath(id)` and read it yourself; this package does
no I/O of its own. The files also ship under `documents/` and `adapters/` in
the published tarball, reachable either way: `documentPath("branch-provenance")`
for a filesystem path, or the equivalent import specifier — `documents/` or
`adapters/` followed by the real filename — via the `./documents/*` and
`./adapters/*` export subpaths, for a consumer whose own tooling wants a
specifier rather than a resolved path (a bundler asset import, for instance).
Both routes point at the same bytes; use whichever your tooling expects.

| id | File | Contents |
| --- | --- | --- |
| `branch-provenance` | [documents/branch-provenance.md](documents/branch-provenance.md) | How an agent-created branch is named, and why taxonomy is not provenance |
| `skill-grammar` | [documents/skill-grammar.md](documents/skill-grammar.md) | Skill naming, prefix ownership, and the closed verb vocabulary |
| `agent-interoperability` | [documents/agent-interoperability.md](documents/agent-interoperability.md) | The canonical layer table, supported surfaces, and the admission test for a new agent |
| `routine-declaration` | [documents/routine-declaration.md](documents/routine-declaration.md) | Why a trigger is a pointer, why scope is closed, and why declared intent is not live state |
| `skill-registry` | [documents/skill-registry.md](documents/skill-registry.md) | The capability-first skill registry contract: composite identity, closed scope, coverage as set arithmetic, and why a routine can only confirm coverage, never grant it |
| `machine-guidance` | [documents/machine-guidance.md](documents/machine-guidance.md) | Machine-wide guidance for discovery and composition across account-owned workspace planes. **Templated** — carries `${WORKSPACE_ROOT}` |
| `machine-baseline` | [documents/machine-baseline.md](documents/machine-baseline.md) | The durable posture a development machine holds, and which part of it is mechanically checkable |
| `gate-naming` | [documents/gate-naming.md](documents/gate-naming.md) | CI gate naming grammar, why there is no account or repository prefix, and a suggested (not required) canonical gate set |

## Shipped adapters

An adapter carries discovery, permissions, hooks, and interface metadata only —
never behavioral prose of its own. Resolve one with `adapterPath(id)`.

| id | File | Purpose |
| --- | --- | --- |
| `agent-policy-rules` | [adapters/agent-policy.rules](adapters/agent-policy.rules) | Execution-policy rules for destructive and publishing commands |
| `shell-integration` | [adapters/shell-integration.zsh](adapters/shell-integration.zsh) | Navigation-only shell integration. **Templated** — carries `${WORKSPACE_ROOT}` |
| `branch-provenance-hook` | [adapters/branch-provenance-hook.sh](adapters/branch-provenance-hook.sh) | Pre-tool-use hook enforcing branch provenance and default-branch protection |

### The product loader is generated, not shipped

A product that wants its own instruction file needs a one-line import pointing
at the shared guidance. That is `renderProductLoader({ guidancePath })` rather
than a file in `adapters/`, because the import target depends on where your
manifest installed the guidance and where the product keeps its configuration —
two facts this package does not know. A shipped loader had to hardcode one
relative path, which silently became wrong the moment either end moved, in a
file whose only job is to point at the other end.

```ts
import { renderProductLoader } from "@vespeneventures/conventions";

// Whatever your manifest actually installed the shared guidance to, expressed
// relative to where this loader will live (or absolute). Only you know both.
const guidancePath = myInstalledGuidancePath;

writeFileSync(loaderSource, renderProductLoader({ guidancePath, productName: "Example" }));
```

The hook is configured entirely through the environment, so it encodes no
operator topology: `AGENT_BRANCH_PREFIX` (required — it refuses to run
unconfigured rather than silently allowing everything) and the optional
`AGENT_CANONICAL_GLOBS`, a colon-separated list of paths where the rules apply
strictly. With no globs set the rules apply everywhere, which is the fail-safe
direction.

### Templated files

A file marked templated contains `${TOKEN}` placeholders and is only correct
after expansion. **Never symlink one** — the reader gets the literal token.
Install it as a templated copy or a managed block. `templatedFilenames()`
returns the full list so a provisioning step can refuse the unsafe case
mechanically rather than by convention.

The token syntax collides with braced shell variable expansion, so a shipped
shell file writes `$VAR` rather than the braced form wherever it is not meant
to be substituted at install time — including inside comments, which an
expander reads like any other bytes.

## API

| Export | Kind | Description |
| --- | --- | --- |
| `validateBranchName(name, options)` | function | Validates one branch name against declared agent prefixes. Returns `Finding[]`. Reports `branch/no-agents-declared` rather than passing vacuously when no agents are given |
| `TAXONOMY_PREFIXES` | `readonly string[]` | Prefixes that describe what a change is rather than who made it (`feat`, `fix`, `chore`, `task`, `agent`, …), reported specifically because they are the common mistake |
| `validateSkillName(name, options, directoryName?)` | function | Validates one skill name; compares against the directory name when supplied, since that drift makes a skill silently undiscoverable |
| `validateSkillSet(names, options)` | function | Validates a set and adds the cross-cutting duplicate-name rule |
| `SKILL_VERBS` | `readonly string[]` | The closed verb vocabulary |
| `validateRoutineDeclaration(declaration, registry)` | function | Validates one declaration against a plane's own registry of repositories, skills, cadences, and modes |
| `validateRoutineSet(declarations, registry, options?)` | function | Validates a set; adds unique-identifier checking and validates exclusion reasons and repository qualifiers |
| `validateScheduledSkillDescription(skill, description)` | function | Checks that a clock-invoked skill declares it is not conversationally triggered |
| `reconciliationFindingKinds` | `readonly string[]` | The four findings only live reconciliation can produce. Data, not an implementation — this package cannot read a scheduler's store |
| `scanNeutrality(contents, options?)` | function | Reports absolute paths, operator-specific home directories, and caller-supplied plane-owned names. Exempts a shebang line |
| `validateSkillRegistry(registry)` | function | Validates decoded caller JSON without throwing: schema and entry shapes, composite identity, scope escape, capability coverage, and durable accepted-gap evidence |
| `computeCapabilityCoverage(registry, capabilityId)` | function | Pure set arithmetic for one capability: required, covered, accepted gaps, and what is still missing |
| `validateRoutineCoverage(query, registry)` | function | Non-throwingly resolves a routine or coverage query's composite skill identity and confirms scope is a subset of declared coverage |
| `SKILL_REGISTRY_SCHEMA_VERSION` | `string` | The schema version this validator understands. A registry declaring a different version is a finding, not a silent pass |
| `CONVENTION_DOCUMENTS` | `readonly ConventionDocument[]` | Metadata for every shipped document |
| `CONVENTION_ADAPTERS` | `readonly ConventionAdapter[]` | Metadata for every shipped adapter |
| `documentPath(id)` | function | Absolute path to a shipped document; throws on an unknown id |
| `adapterPath(id)` | function | Absolute path to a shipped adapter; throws on an unknown id |
| `renderProductLoader(options)` | function | Renders a product's one-line instruction-file loader against a caller-supplied guidance path. Throws rather than rendering a loader that points nowhere |
| `ProductLoaderOptions` | type | `{ guidancePath, productName? }` |
| `templatedFilenames()` | function | Every shipped filename that must be expanded before use |
| `DOCUMENTS_ROOT` | `string` | Absolute path to the shipped `documents/` directory |
| `ADAPTERS_ROOT` | `string` | Absolute path to the shipped `adapters/` directory |
| `Finding` | type | `{ rule, severity, message }` |
| `Severity` | type | `"high" \| "medium" \| "low"` |
| `ConventionDocument` | type | `{ id, filename, title, templated }` |
| `ConventionAdapter` | type | `{ id, filename, description, templated, mode? }` |
| `RoutineDeclaration` | type | `{ id, skill, skillRepository?, cadence, scope, mode, purpose }`; an unqualified target resolves through the plane root |
| `RoutineRegistry` | type | The declaring plane's closed lists |
| `BranchOptions` | type | `{ agents, exempt? }` |
| `SkillOptions` | type | `{ prefixes, reservedNamespaces?, thirdParty? }` |
| `RoutineExclusion` | type | `{ skill, skillRepository?, reason }`; unqualified identity is the plane root and qualified identity names a governed repository |
| `RoutineSetOptions` | type | `{ exclusions? }` |
| `NeutralityOptions` | type | `{ forbiddenNames?, allowTemplateTokens? }` |
| `SkillRegistry` | type | `{ schemaVersion, capabilities, skills, acceptedGaps? }` |
| `Capability` | type | `{ id, description, requiredTargets }` |
| `RegisteredSkill` | type | `{ name, scope, repository?, thirdParty?, implements }`. Identity is `(repository, name)` for `scope: "repository"`, or `(plane, name)` for `scope: "plane"` |
| `SkillScope` | type | `"plane" \| "repository"` |
| `SkillCapabilityImplementation` | type | `{ capability, targets }` |
| `AcceptedGap` | type | `{ capability, target, reason, reference }` |
| `RoutineCoverageQuery` | type | `{ skill, repository?, skillRepository?, scope }`; qualifier spellings must agree if both are present |
| `CapabilityCoverage` | type | `{ capability, required, covered, acceptedGaps, missing }` |

## What this package deliberately does not do

- **It does not read a scheduler.** Whether a routine is installed, enabled, or
  firing is state a scheduler holds, and a check that probed it would pass in
  continuous integration for the opposite reason it passes locally. Splitting
  the offline check from live reconciliation is what keeps a green check
  honest: an offline pass proves a declaration is well-formed, never that the
  work runs.
- **It does not hold identity.** `scanNeutrality` finds structure — paths and
  home directories — without any list. Catching a person, an account, or a
  client needs a denylist, which is private by nature and belongs to whoever
  holds those names. Pass them in via `forbiddenNames`.
- **It does not install anything.** Applying these defaults to a machine is
  provisioning, which mutates state outside version control and belongs in a
  package that says so.
- **It does not discover or compose workspace planes.** The guidance states the
  ownership and fail-closed boundaries, but the caller supplies its plane
  registry, observations, requirement evaluation, precedence decisions, and
  any eventual machine manifest.
- **The skill registry never reads a scheduler either.** `validateRoutineCoverage`
  confirms only that a named skill resolves and that a routine's declared
  scope is a subset of what that skill already claims; it never asks whether
  the routine is actually installed. Live reconciliation still belongs to
  whichever plane owns the scheduler, exactly as it does for routine
  declarations above.
- **It never lets a third-party skill count toward first-party coverage.** A
  skill marked `thirdParty: true` can still declare `implements`, but
  `computeCapabilityCoverage` and `validateSkillRegistry` both exclude it from
  the union. Coverage the plane cannot change is not coverage the plane can
  rely on.

## Requirements

Node.js >= 20. No runtime dependencies.

## Licence

MIT
