# @vespeneventures/repository

> **Deprecated compatibility package.** New integrations import
> `@vespeneventures/governance/repository`. This package preserves the same
> root API and `repository-check` command while existing consumers migrate.

Contracts and deterministic validation for repository values that belong to a
consumer: its default branch, verification commands, protected path patterns,
upward requirements, and exact direct-child vocabulary. The package ships
machinery only. It contains no repository profile, root entry, workflow,
policy value, provider account, or native agent configuration.

```bash
npm install @vespeneventures/repository
```

## Usage

```ts
import {
  validateRepositoryProfile,
  type RepositoryProfile,
} from "@vespeneventures/repository";

const profile: RepositoryProfile = {
  schemaVersion: 3,
  defaultBranch: "main",
  commands: [
    { name: "setup", run: "npm ci" },
    { name: "check", run: "npm run check" },
  ],
  protectedPaths: [".github/workflows/**", "packages/core/src/**"],
  requirements: [{
    id: "runtime.example",
    scope: "machine",
    constraint: { kind: "one-of", values: ["variant-a", "variant-b"] },
  }],
  rootEntries: [
    { name: "source", classification: "canonical", disposition: "required" },
    { name: "old-link", classification: "compatibility-alias", disposition: "prohibited" },
  ],
};

const findings = validateRepositoryProfile(profile);
if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.path}: ${finding.message}`);
  }
}
```

Validation is pure, performs no I/O, does not invoke Git, and never throws for
malformed input. Findings are deterministic and carry a stable rule, an input
path, and an error message. It inspects own data descriptors without invoking
accessors and intentionally does not narrow the caller's live object. Commands
are an ordered array with explicit names,
so consumers never need to treat inherited object properties as command names.
The command and protected-path collection types are read-only arrays, matching
the concrete arrays accepted by validation. Validation reads only own numeric
data descriptors and `length`; it does not invoke array methods or iteration on
untrusted values. Both profile collections are bounded at 10,000 entries, so a
consumer check never processes an unbounded untrusted configuration.
Protected paths support literal segments plus `*`
and `**` wildcards; brace expansion, character classes, extglobs, negation,
absolute paths, and parent traversal are rejected.

## Ownership boundary

Foundry owns the types and validator. A consumer owns every value: branch
names and branch policy, commands, protected paths, workflow YAML, and project
settings. User or machine account choices, connector or browser routing,
credentials references, cookies, OAuth grants, session state, and native agent
configuration are outside this package.

This package does not model reviews or providers. Those require separate
contracts or adapters once real provider-specific behavior and a proving
consumer exist.

Profile v2 adds caller-owned upward requirements and pure evaluation.
Repository, workspace, and machine scopes are supported; constraints require
presence or one of the caller's explicit values. A caller discovers profiles,
associates each declaration with its own source identifier, gathers normalized
observations, and calls `evaluateRepositoryRequirements`. Missing or explicit
unknown evidence fails closed. Foundry does not discover repositories, inspect
machines, select a compatible value, install anything, or mutate state.

The original version-1 profile and requirements-only version-2 profile remain
accepted. `RepositoryProfile` is the explicit v1/v2/v3 union, so compatibility
does not make either older closed shape silently accept new fields.

Profile v3 adds the caller's exact direct-child vocabulary. Each entry names a
single root child, classifies it as `canonical`, `extension`, `exception`,
`compatibility-alias`, or `legacy-artifact`, and explicitly declares whether
it is `required`, `allowed`, or `prohibited`. `evaluateRepositoryRoot` compares
that vocabulary with caller-discovered direct-child names. Missing required,
observed prohibited, and undeclared unknown entries all fail closed. Foundry
does not discover the filesystem, choose classifications or retention, resolve
aliases, or mutate anything.

Root vocabulary remains a repository concern under the governance repository
subpath. Account-container discovery and multi-plane composition stay with the
caller; this contract does not imply a governance workspace subpath.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `validateRepositoryProfile(value)` | function | Returns every independently checkable structural finding without throwing or performing I/O. |
| `validateRepositoryRequirementsEvaluationInput(value)` | function | Strictly validates caller-associated declarations and normalized observations. |
| `evaluateRepositoryRequirements(value)` | function | Pure evaluation with `satisfied`, `unsatisfied`, `conflicting`, `unknown`, and invalid fail-closed report states. |
| `validateRepositoryRootEvaluationInput(value)` | function | Strictly validates caller-owned root declarations and caller-normalized direct-child observations. |
| `evaluateRepositoryRoot(value)` | function | Pure exact-root proof; missing, prohibited, and unknown direct children fail closed. |
| `REPOSITORY_PROFILE_VERSION` / `PREVIOUS_REPOSITORY_PROFILE_VERSION` / `LEGACY_REPOSITORY_PROFILE_VERSION` | constants | Current schema `3` and deliberately supported schemas `2` and `1`. |
| `RepositoryCommand` | type | One consumer-owned command with `name`, `run`, and optional repository-relative `cwd`. |
| `RepositoryList` | type | Dense, read-only array values accepted by the profile validator. |
| `RepositoryProfileV1` / `RepositoryProfileV2` / `RepositoryProfileV3` / `RepositoryProfile` | types | The three closed profile versions and their explicit union. |
| `RepositoryProfileFinding` | type | A deterministic error with `rule`, `path`, and `message`. |
| `RepositoryProfileFindingRule` | type | Closed vocabulary of validator rule identifiers. |
| `RepositoryRequirement` / `RepositoryRequirementConstraint` / `RepositoryPresenceConstraint` / `RepositoryOneOfConstraint` | types | Neutral requirement and constraint grammar. |
| `RepositoryRequirementScope` / `RepositoryObservationState` | types | Closed scope and normalized evidence-state vocabularies. |
| `RepositoryRequirementDeclaration` / `RepositoryRequirementObservation` | types | Caller-associated declarations and caller-normalized evidence. |
| `RepositoryRequirementsEvaluationInput` / `RepositoryRequirementsEvaluation` / `RepositoryRequirementsEvaluationStatus` | types | Strict evaluator input and complete report. |
| `RepositoryRequirementEvaluation` / `RepositoryRequirementStatus` | types | One requirement's deterministic result. |
| `RepositoryRequirementFinding` / `RepositoryRequirementFindingRule` | types | Stable evaluation and input finding contracts. |
| `RepositoryRootEntry` / `RepositoryRootEntryClassification` / `RepositoryRootEntryDisposition` | types | Caller-owned exact-root declaration grammar. |
| `RepositoryRootEvaluationInput` / `RepositoryRootEvaluation` / `RepositoryRootEvaluationStatus` | types | Strict root evaluator input and complete report. |
| `RepositoryRootEntryEvaluation` | type | One declared or unknown direct child's result. |
| `RepositoryRootFinding` / `RepositoryRootFindingRule` | types | Stable exact-root structural and evaluation findings. |

## Requirements

Node 20+. ESM only. Runtime dependency: `@vespeneventures/governance`
(`~0.13.0`), which this package's own `src/index.ts` re-exports from.

This package is not dependency-free: `governance` itself depends on
`@vespeneventures/policy`, which is therefore pulled in transitively by
installing this package too.

## CLI

`repository-check` validates exactly one JSON profile file. It reads no
repository state, runs no declared commands, and invokes neither Git nor a
provider API.

Importing this package or its compatibility CLI API performs no filesystem
I/O, output, or process-state mutation. A separate executable-only wrapper
runs the command, so npm-created `node_modules/.bin/repository-check` symlinks
remain executable without adding work to module evaluation.

```bash
repository-check repository-profile.json
```

It writes one deterministic JSON report to standard output:

```json
{
  "ok": false,
  "findings": [
    {
      "rule": "default-branch",
      "severity": "error",
      "path": "defaultBranch",
      "message": "defaultBranch must be a valid Git branch name."
    }
  ]
}
```

Its exit codes are `0` for a valid profile, `1` for validation findings, and
`2` when it cannot run because its arguments are invalid, the profile file is
unreadable, or the file is not valid JSON. Use `repository-check --help` for
the complete invocation contract.

## Licence

MIT.
