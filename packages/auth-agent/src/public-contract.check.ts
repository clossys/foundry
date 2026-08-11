import { assertAgentCanCall, assertAgentMonetaryAuthority, describeAgentLifecycleState, isAgentContextActive } from "./index.js";
import type {
  AgentAuthorizationError,
  AgentAuthorizationFailureReason,
  AgentLifecycleState,
  BaseAgentAuditRecord,
  GenericAgentContext,
  IsoDateTime,
} from "./index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;

type ToolId = "records.read" | "payments.create";
type Metadata = { requestId: string };
type Context = GenericAgentContext<ToolId, "automation", Metadata>;

type _AuditFields = Assert<
  Equal<
    BaseAgentAuditRecord,
    {
      actorType: "agent";
      agentIdentityId: string;
      responsibleHumanId: string;
      toolId: string;
      authResult: "allowed" | "denied";
      occurredAt: IsoDateTime;
    }
  >
>;
type _ContextToolScope = Assert<Equal<Context["toolScope"], ToolId[]>>;
type _ContextDates = Assert<Equal<Context["validFrom"], IsoDateTime | null>>;
type _ContextMetadata = Assert<Equal<Context["metadata"], Metadata | undefined>>;
type _LifecycleReturn = Assert<Equal<ReturnType<typeof describeAgentLifecycleState>, AgentLifecycleState | null>>;
type _ActiveReturn = Assert<Equal<ReturnType<typeof isAgentContextActive>, boolean>>;
type _AuthorizationErrorReason = Assert<Equal<InstanceType<typeof AgentAuthorizationError>["reason"], AgentAuthorizationFailureReason>>;
type _CanCallReturn = Assert<Equal<ReturnType<typeof assertAgentCanCall>, void>>;
type _MonetaryReturn = Assert<Equal<ReturnType<typeof assertAgentMonetaryAuthority>, void>>;

// @ts-expect-error AgentAuthorizationFailureReason is a closed set of stable codes.
type _UnknownReasonIsRejected = Assert<Equal<AgentAuthorizationFailureReason, "agent_missing">>;

// @ts-expect-error A context keeps its tool scope constrained to its TToolId parameter.
type _GenericScopeDoesNotWiden = Assert<Equal<Context["toolScope"], string[]>>;
