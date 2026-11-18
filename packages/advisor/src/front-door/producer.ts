/**
 * Producer's own facts, read from the installed (or sibling) @clossys/producer, never copied by hand: the loop
 * names, each loop's triggers and the trigger kinds (loop/names.js), the clossys.loop-version/1 schema and
 * Producer's validator for it, and Producer's clossys.conform-adapter/1 check (conform/model.js). The round
 * checks Advisor's loops and conform.json against these, so a Producer change shows up here as a red row.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PACKAGE_ROOT } from "./tree.js";

export interface ProducerFacts {
  readonly dir: string;
  readonly loopNames: readonly string[];
  readonly loopTriggers: Readonly<Record<string, readonly string[]>>;
  readonly triggerKinds: Readonly<Record<string, string>>;
  /** Issues with a loop version's content against Producer's clossys.loop-version/1. */
  loopIssues(content: unknown): string[];
  /** Issues with a conform.json value against Producer's clossys.conform-adapter/1. */
  adapterIssues(value: unknown, agent: string): string[];
}

type SchemaIssue = { readonly path: string; readonly message: string };
interface NamesModule { LOOP_NAMES: readonly string[]; LOOP_TRIGGERS: Readonly<Record<string, readonly string[]>>; TRIGGER_KINDS: Readonly<Record<string, string>> }
interface SchemaModule { validateAgainst(schema: unknown, value: unknown): SchemaIssue[] }
interface ConformModule { adapterIssues(value: unknown, agent: string): string[] }

const BUILT = ["dist/loop/names.js", "dist/records/schema.js", "dist/conform/model.js", "schemas/loop-version.json"] as const;

/**
 * Where @clossys/producer lives for this workspace: the consumer's node_modules first (what advisor install put
 * there), then the sibling package in the foundry checkout. Null when neither holds a built Producer.
 */
export function producerDir(root: string | undefined): string | null {
  const candidates = [...(root ? [join(root, "node_modules", "@clossys", "producer")] : []), join(PACKAGE_ROOT, "..", "producer")];
  return candidates.find(dir => BUILT.every(file => existsSync(join(dir, file)))) ?? null;
}

export async function loadProducerFacts(dir: string | null): Promise<ProducerFacts | null> {
  if (dir === null) return null;
  const load = async <T>(file: string): Promise<T> => await import(pathToFileURL(join(dir, file)).href) as T;
  const names = await load<NamesModule>("dist/loop/names.js");
  const schema = await load<SchemaModule>("dist/records/schema.js");
  const conform = await load<ConformModule>("dist/conform/model.js");
  const loopSchema = JSON.parse(readFileSync(join(dir, "schemas", "loop-version.json"), "utf8")) as unknown;
  return {
    dir,
    loopNames: names.LOOP_NAMES,
    loopTriggers: names.LOOP_TRIGGERS,
    triggerKinds: names.TRIGGER_KINDS,
    loopIssues: content => schema.validateAgainst(loopSchema, content).map(issue => `${issue.path} ${issue.message}`),
    adapterIssues: (value, agent) => conform.adapterIssues(value, agent),
  };
}
