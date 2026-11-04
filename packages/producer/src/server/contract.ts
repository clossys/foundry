import type { AgentKind } from "../agents.js";

/** Same-origin, read-only Studio transport: a slot-model change event. */
export interface ChangeEvent { agent: AgentKind | null; id: string | null; reload: true }
export const TOKEN_HEADER = "X-Clossys-Token";
