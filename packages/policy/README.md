# @vespeneventures/policy

> **Deprecated compatibility package.** This package's source moved to
> `@vespeneventures/controller/policy` (issue #282 — see
> [`docs/DECISIONS.md`](../../docs/DECISIONS.md#9-consolidating-governance-conventions-and-policy-under-controller)).
> New integrations use `@vespeneventures/controller/policy` directly.
> This package preserves the same root import while existing consumers
> migrate. Issue #288 removes this compatibility package once the
> migration window closes.

```bash
npm install @vespeneventures/policy
```

## Migrating from this package

`src/index.ts` is a single `export * from "@vespeneventures/controller/policy"` —
nothing here is reimplemented. Update the import path only; every export
name, argument order, and return type is unchanged:

| This package | Forwards to |
| --- | --- |
| `@vespeneventures/policy` | `@vespeneventures/controller/policy` |

See [`@vespeneventures/controller`'s README](../controller/README.md) for
the full `PolicyBinding` API (`computeDigest`, `validateBindingShape`,
`verifyBinding`, `OWN_LICENSE_BINDING`), the package's job, its metric, and
its loop.

## Requirements

Node 20+. ESM only. One runtime dependency: `@vespeneventures/controller`
(`^0.1.0`), which every export in this package forwards to.

## Licence

MIT
