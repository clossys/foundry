/** Types for compile-studio.mjs, the implementation behind `clossys compile`. */
export interface DecisionInput { id: string; decision?: string; glob?: string; pinned?: string }
export interface DecisionInputs { schema: "clossys.decision-inputs/1"; note?: string; inputs: DecisionInput[] }
export const DECISION_INPUTS: string;
export const STUDIO_DIR: string;
export const LOCK_FILE: string;
export function readDecisionInputs(path?: string): Promise<DecisionInputs>;
export function resolveDecisionInputs(clossysRoot: string, spec: DecisionInputs): Promise<string[]>;
export function compileStudio(options: { root: string; out?: string; decisionInputs?: string }): Promise<{ target: string; inputs: number; outputs: number; lock: string }>;
