/**
 * `clossys director check archetype`: the one writer of the archetype record. With a name it records
 * the owner's archetype choice as `<consumer>/evidence/director/director-archetype.md`; without one it
 * prints the recorded archetype. The clossys CLI traces each `director check` run as step
 * `director.store`, so a write leaves its run record in `.clossys/runs`. Exit 0 done, 2 could not run.
 */
import { ARCHETYPE_DECIDER, ARCHETYPE_RECORD_ID, archetypeNames, archetypeRecord, recordedArchetype } from "../archetype.js";
import { loadCatalog } from "../catalog.js";
import { readStrategyFile, readStrategyRoot, EVIDENCE_PREFIX, evidenceBase } from "../store.js";
import { resolveStrategyRoot } from "../strategy-dir-default.js";
import type { DirectorStore } from "../store-io.js";

export const ARCHETYPE_USAGE = `Usage: clossys director check archetype [<name> --by owner[:<ref>]] [--root <dir>] [--json]
With a name, records the owner's archetype (default, product-saas, services or marketplace) as
evidence/director/${ARCHETYPE_RECORD_ID}.md; status and complete then use its core cells. Without a
name, prints the recorded archetype. --archetype on status and complete still overrides the record.`;

interface ArchetypeArgs { name?: string; by?: string; root?: string; json: boolean; help: boolean }

function parse(argv: string[]): ArchetypeArgs {
  const args: ArchetypeArgs = { json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === "--json") args.json = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--by" || token === "--root") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${token} needs a value`);
      if (token === "--by") args.by = value; else args.root = value;
      i += 1;
    } else if (token.startsWith("-")) throw new Error(`Unknown option ${token}`);
    else if (args.name === undefined) args.name = token;
    else throw new Error(`Unexpected argument ${token}`);
  }
  return args;
}

function today(): string { return new Date().toISOString().slice(0, 10); }

export function runArchetypeCli(argv: string[], store: DirectorStore, print: (text: string) => void = console.log, now: () => string = today): number {
  const json = argv.includes("--json");
  const out = (code: number, result: Record<string, unknown>, text: string) => { print(json ? JSON.stringify({ command: "archetype", code, ...result }) : text); return code; };
  try {
    const args = parse(argv);
    if (args.help) return out(0, { help: ARCHETYPE_USAGE }, ARCHETYPE_USAGE);
    const root = resolveStrategyRoot(args.root);
    const base = evidenceBase(root);
    if (base === undefined) throw new Error("The archetype record needs the flat store root <consumer>/agents/director");
    const catalog = loadCatalog();
    const path = `${EVIDENCE_PREFIX}/${ARCHETYPE_RECORD_ID}.md`;
    if (args.name === undefined) {
      if (args.by !== undefined) throw new Error("--by needs an archetype name");
      const model = readStrategyRoot(root, store.reader, { catalog });
      const recorded = recordedArchetype(model.findings, catalog);
      if (recorded?.ok === false) throw new Error(`${path}: ${recorded.message}`);
      return out(0, { result: { archetype: model.tree?.archetype ?? "default", recorded: recorded ? { path, by: recorded.by } : null } },
        recorded ? `Archetype: ${recorded.archetype} (recorded by ${recorded.by} in ${path}).` : "Archetype: default (no archetype record).");
    }
    if (!archetypeNames(catalog).includes(args.name)) throw new Error(`Unknown strategy archetype: ${args.name} (expected ${archetypeNames(catalog).join(", ")})`);
    if (args.by === undefined || !ARCHETYPE_DECIDER.test(args.by)) throw new Error("--by owner[:<ref>] is required: the archetype is an owner decision");
    const name = args.name, by = args.by;
    return store.writer.locked(root, () => {
      const before = readStrategyFile(root, store.reader, path);
      const after = archetypeRecord(name, by, now());
      if (before !== after) store.writer.commit(base, [{ path: `evidence/director/${ARCHETYPE_RECORD_ID}.md`, before, after }]);
      return out(0, { result: { archetype: name, recorded: { path, by }, changed: before !== after } }, `Archetype: ${name}, recorded by ${by} in ${path}.`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return out(2, { error: message }, `clossys director check archetype: ${message}`);
  }
}
