import type { Port } from "../define.js";

/**
 * Typed ports for the decision files every step shares (R2: ports are contracts). An edge exists
 * only between an output and an input that name the same schema, so each reader names the schema
 * of the files it reads: a reader of every agent's candidates reads one typed port per agent.
 */
export const AGENTS = ["director", "designer", "writer", "publisher"] as const;
export type Agent = typeof AGENTS[number];
export const CANDIDATE_SCHEMA: Readonly<Record<Agent, string>> = { director: "candidate-brief", designer: "candidate-element", writer: "candidate-strings", publisher: "candidate-publisher" };

export const IA: Port = { glob: "clossys/agents/*/ia.json", schema: "ia" };
export const SLOTS: Port = { glob: "clossys/agents/*/*/slot.json", schema: "slot" };
export const PINS: Port = { glob: "clossys/agents/*/*/pin.json", schema: "pin" };
export const SEATS: Port = { glob: "clossys/agents/producer/*/seat.json", schema: "seat" };
export const slotsOf = (agent: Agent): Port => ({ glob: `clossys/agents/${agent}/*/slot.json`, schema: "slot" });
export const pinsOf = (agent: Agent): Port => ({ glob: `clossys/agents/${agent}/*/pin.json`, schema: "pin" });
export const candidatesOf = (agent: Agent): Port => ({ glob: `clossys/agents/${agent}/*/candidates/*`, schema: CANDIDATE_SCHEMA[agent] });
/** Every agent's candidate files, one typed port per agent schema. */
export const CANDIDATES: readonly Port[] = AGENTS.map(candidatesOf);
/** Library element records (src/records/schemas.ts ELEMENT_SCHEMA); their payload files stay untyped. */
export const LIBRARY_ELEMENTS: Port = { glob: "clossys/library/*/*/v*/element.json", schema: "library-element" };
/** The consumer selection (src/records/schemas.ts SELECTION_SCHEMA). */
export const SELECTION: Port = { glob: "clossys/selection.json", schema: "selection" };
/** The Studio map projection the Studio checks and capture read. */
export const STUDIO_MAP: Port = { glob: "pkg:studio/generated/studio-map.json", schema: "studio-map" };
/** The compile lock `clossys compile` writes. */
export const COMPILE_LOCK: Port = { glob: "pkg:studio/compile.lock.json", schema: "compile-lock" };
/** The page-check source receipt the build writes and `clossys check --pages` reads. */
export const SOURCE_RECEIPT: Port = { glob: "pkg:dist/check/source-receipt.json", schema: "source-receipt" };
/** The committed pipeline graph the Studio server reads at GET /api/pipeline. */
export const PIPELINE_GRAPH: Port = { glob: "pkg:pipeline/graph.json", schema: "pipeline-graph" };
/*
 * Field carve-outs (`slot.json#uses`, `slot.json#notNeeded`, `candidates/*#status`) stay untyped:
 * a field write is not the file's contract, so it feeds no edge and is listed as untyped.
 */
