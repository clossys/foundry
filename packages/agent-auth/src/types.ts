export type IsoDateTime = string;

export type AgentLifecycleState = "not_yet_active" | "active" | "expired" | "revoked";

export type AgentAuthorizationFailureReason =
  | "agent_revoked"
  | "agent_not_yet_active"
  | "agent_expired"
  | "tool_not_in_scope"
  | "monetary_limit_exceeded";

export interface BaseAgentAuditRecord {
  actorType: "agent";
  agentIdentityId: string;
  responsibleHumanId: string;
  toolId: string;
  authResult: "allowed" | "denied";
  occurredAt: IsoDateTime;
}

export interface GenericAgentContext<
  TToolId extends string = string,
  TKind extends string = string,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  agentIdentityId: string;
  agentKind: TKind;
  displayName: string;
  modelProvider: string;
  modelId: string;
  modelVersion: string;
  systemPromptHash: string;
  toolScope: TToolId[];
  monetaryLimitAmount: number | null;
  monetaryLimitCurrency: string | null;
  responsibleHumanId: string;
  validFrom: IsoDateTime | null;
  validTo: IsoDateTime | null;
  revokedAt: IsoDateTime | null;
  revokedReason: string | null;
  metadata?: TMeta;
}
