# @vespeneventures/repository

> **Deprecated compatibility package.** New integrations import
> `@vespeneventures/governance/repository`. This package preserves the same
> root API and `repository-check` command while existing consumers migrate.

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

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `validateRepositoryProfile(value)` | function | Returns every independently checkable structural finding without throwing or performing I/O. |
| `REPOSITORY_PROFILE_VERSION` | constant | The supported profile schema version, currently `1`. |
| `RepositoryCommand` | type | One consumer-owned command with `name`, `run`, and optional repository-relative `cwd`. |
| `RepositoryList` | type | Dense, read-only array values accepted by the profile validator. |
| `RepositoryProfile` | type | The complete profile shape: schema version, default branch, commands, and protected paths. |
| `RepositoryProfileFinding` | type | A deterministic error with `rule`, `path`, and `message`. |
| `RepositoryProfileFindingRule` | type | Closed vocabulary of validator rule identifiers. |

## Requirements

Node 20+. ESM only. Runtime dependency: `@vespeneventures/governance`
(`^0.5.0`), which this package's own `src/index.ts` re-exports from.

This package is not dependency-free: `governance` itself depends on
`@vespeneventures/policy`, which is therefore pulled in transitively by
installing this package too.

## CLI

`repository-check` validates exactly one JSON profile file. It reads no
repository state, runs no declared commands, and invokes neither Git nor a
provider API.

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
