# @vespeneventures/auth-agent

Dependency-free authorization guards for a software-agent context. The
context records the identity and model details needed for audit, a lifecycle
window, a declared tool scope, and an optional monetary limit. This package
does not verify identity, persist records, call tools, or move money.

```bash
npm install @vespeneventures/auth-agent
```

## Usage

```ts
import {
  assertAgentCanCall,
  assertAgentMonetaryAuthority,
  type GenericAgentContext,
} from "@vespeneventures/auth-agent";

const agent: GenericAgentContext<"records.read" | "payments.create", "automation"> = {
  agentIdentityId: "agent-example",
  agentKind: "automation",
  displayName: "Example automation",
  modelProvider: "example-provider",
  modelId: "example-model",
  modelVersion: "1",
  systemPromptHash: "sha256:example",
  toolScope: ["records.read", "payments.create"],
  monetaryLimitAmount: 250,
  monetaryLimitCurrency: "USD",
  responsibleHumanId: "operator-example",
  validFrom: null,
  validTo: null,
  revokedAt: null,
  revokedReason: null,
};

assertAgentCanCall(agent, "records.read");
assertAgentMonetaryAuthority(agent, 25, "USD", "payments.create");
```

## Authorization behavior

`isAgentContextActive` and `describeAgentLifecycleState` accept an optional
`Date` or date-time string so callers can evaluate a fixed instant. An active
context begins at `validFrom` and ends at `validTo`; either boundary can be
`null` for an unbounded side. `validTo` is exclusive. Any non-null
`revokedAt` denies access. Missing, malformed, or inactive time data never
authorizes a call.

`assertAgentCanCall` throws `AgentAuthorizationError` with one of the stable
reasons `agent_revoked`, `agent_not_yet_active`, `agent_expired`, or
`tool_not_in_scope`. An absent context fails closed with `agent_revoked` and
the sentinel identity `<missing>`.

`assertAgentMonetaryAuthority` independently enforces lifecycle and tool scope
before checking the monetary limit, so it is safe to use as the sole guard for
a monetary tool call. It accepts the same optional evaluation instant as
`assertAgentCanCall`. A `null` configured amount means unlimited after those
base checks pass; otherwise the requested amount must be finite and
non-negative and the currency must match case-insensitively. A malformed,
mismatched, or exceeded configured limit throws
`AgentAuthorizationError` with `monetary_limit_exceeded`. A negative or
non-finite requested amount throws `TypeError`.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `isAgentContextActive(agent, now?)` | function | Returns whether a non-null context is active at the supplied instant. |
| `describeAgentLifecycleState(agent, now?)` | function | Returns `not_yet_active`, `active`, `expired`, `revoked`, or `null` for an absent context. |
| `assertAgentCanCall(agent, toolId, now?)` | function | Asserts an active context and an in-scope tool; otherwise throws a typed authorization error. |
| `assertAgentMonetaryAuthority(agent, amount, currency, toolId, now?)` | function | Asserts lifecycle, tool scope, amount, currency, and configured monetary-limit authority. |
| `AgentAuthorizationError` | class | Error with stable `reason`, `agentIdentityId`, and `toolId` fields. |
| `GenericAgentContext<TToolId, TKind, TMeta>` | type | Generic agent context with identity, model, lifecycle, scope, authority, and optional metadata fields. |
| `BaseAgentAuditRecord` | type | Provider-neutral audit row for an authorized or denied agent tool call. |
| `AgentAuthorizationFailureReason` | type | Closed union of authorization failure codes. |
| `AgentLifecycleState` | type | Closed union describing an agent context's lifecycle state. |
| `IsoDateTime` | type | String alias for stored date-time values. |

## Requirements

Node 20+. ESM only. No runtime dependencies and no I/O.

## Licence

MIT
