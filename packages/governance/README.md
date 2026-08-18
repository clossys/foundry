# @vespeneventures/governance

> **Deprecated compatibility package.** This package's source moved to
> `@vespeneventures/controller` (issue #282 — see
> [`docs/DECISIONS.md`](../../docs/DECISIONS.md#9-consolidating-governance-conventions-and-policy-under-controller)).
> New integrations use `@vespeneventures/controller` directly. This
> package preserves the same root import, every subpath, and the same
> installed command names (`foundry-governance`, `foundry-check`,
> `repository-check`, `review-check`) while existing consumers migrate.
> Issue #288 removes this compatibility package once the migration window
> closes.

```bash
npm install @vespeneventures/governance
```

## Migrating from this package

Every export below is a straight `export *` forward — nothing here is
reimplemented. Update the import path only; nothing about the call shape,
argument order, or return type changes.

| This package | Forwards to |
| --- | --- |
| `@vespeneventures/governance` | `@vespeneventures/controller` |
| `@vespeneventures/governance/catalog` | `@vespeneventures/controller/catalog` |
| `@vespeneventures/governance/gates` | `@vespeneventures/controller/gates` |
| `@vespeneventures/governance/release` | `@vespeneventures/controller/release` |
| `@vespeneventures/governance/repository` | `@vespeneventures/controller/repository` |
| `@vespeneventures/governance/review` | `@vespeneventures/controller/review` |
| `@vespeneventures/governance/review/github` | `@vespeneventures/controller/review/github` |
| `@vespeneventures/governance/artifacts` | `@vespeneventures/controller/artifacts` |
| `@vespeneventures/governance/cleanup` | `@vespeneventures/controller/cleanup` |
| `@vespeneventures/governance/composition` | `@vespeneventures/controller/composition` |
| `foundry-governance` (installed command) | Same command, now shipped by `@vespeneventures/controller` too. |
| `foundry-check` (installed command) | Same command, now shipped by `@vespeneventures/controller` too. |
| `repository-check` (installed command) | Same command, now shipped by `@vespeneventures/controller` too. |
| `review-check` (installed command) | Same command, now shipped by `@vespeneventures/controller` too. |

See [`@vespeneventures/controller`'s README](../controller/README.md) for
the full API, the package's job, its metric, and its loop.

## Requirements

Node 20+. ESM only. One runtime dependency: `@vespeneventures/controller`
(`^0.1.0`), which every export in this package forwards to.

## Licence

MIT
