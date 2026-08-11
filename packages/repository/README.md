# @vespeneventures/repository

Dependency-free contracts and deterministic validation for repository values
that belong to a consumer: its default branch, verification commands, and
protected path patterns. The package ships machinery only. It contains no
repository profile, workflow, policy value, provider account, or native agent
configuration.

```bash
npm install @vespeneventures/repository
```

## Usage

```ts
import {
  isRepositoryProfile,
  validateRepositoryProfile,
  type RepositoryProfile,
} from "@vespeneventures/repository";

const profile: RepositoryProfile = {
  schemaVersion: 1,
  defaultBranch: "main",
  commands: [
    { name: "setup", run: "npm ci" },
    { name: "check", run: "npm run check" },
  ],
  protectedPaths: [".github/workflows/**", "packages/core/src/**"],
};

const findings = validateRepositoryProfile(profile);
if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.path}: ${finding.message}`);
  }
}

if (isRepositoryProfile(profile)) {
  // profile is narrowed to RepositoryProfile
}
```

Validation is pure, performs no I/O, does not invoke Git, and never throws for
malformed input. Findings are deterministic and carry a stable rule, an input
path, and an error message. Commands are an ordered array with explicit names,
so consumers never need to treat inherited object properties as command names.
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

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `validateRepositoryProfile(value)` | function | Returns every independently checkable structural finding without throwing or performing I/O. |
| `isRepositoryProfile(value)` | function | Type guard that returns true only when validation has no findings. |
| `REPOSITORY_PROFILE_VERSION` | constant | The supported profile schema version, currently `1`. |
| `RepositoryCommand` | type | One consumer-owned command with `name`, `run`, and optional repository-relative `cwd`. |
| `RepositoryProfile` | type | The complete profile shape: schema version, default branch, commands, and protected paths. |
| `RepositoryProfileFinding` | type | A deterministic error with `rule`, `path`, and `message`. |
| `RepositoryProfileFindingRule` | type | Closed vocabulary of validator rule identifiers. |

## Requirements

Node 20+. ESM only. Zero runtime dependencies.

## Licence

MIT.
