/**
 * `clossys director check archetype`: the one writer of the archetype record. With a name it records
 * the owner's archetype choice as `<consumer>/evidence/director/director-archetype.md`; without one it
 * prints the recorded archetype. The clossys CLI traces each `director check` run as step
 * `director.store`, so a write leaves its run record in `clossys/.state/runs`. Exit 0 done, 2 could not run.
 */
import { dirname, join, relative } from "node:path";
import { ARCHETYPE_DECIDER, ARCHETYPE_RECORD_ID, ARCHETYPE_VIAS, archetypeNames, archetypeRecord, recordedArchetype, type ArchetypeVia } from "../archetype.js";
import { loadCatalog } from "../catalog.js";
import { readStrategyFile, readStrategyRoot, EVIDENCE_PREFIX, evidenceBase } from "../store.js";
import { resolveStrategyRoot } from "../strategy-dir-default.js";
import type { DirectorStore } from "../store-io.js";

export const ARCHETYPE_USAGE = `Usage: clossys director check archetype [<name> --by owner --via chat|app|cli --quote "<the owner's words>" | <name> --by owner:<ref> [--via <via> --quote <words>]] [--root <dir>] [--json]
With a name, records the owner's archetype (default, product-saas, services or marketplace) as
clossys/evidence/director/${ARCHETYPE_RECORD_ID}.md; status and complete then use its core cells. --by owner
takes the owner's channel (--via) and words, verbatim (--quote), which the record keeps. Without a
name, prints the recorded archetype. --archetype on status and complete still overrides the record.`;

interface ArchetypeArgs { name?: string; by?: string; via?: string; quote?: string; root?: string; json: boolean; help: boolean }

function parse(argv: string[]): ArchetypeArgs {
  const args: ArchetypeArgs = { json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === "--json") args.json = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--by" || token === "--root" || token === "--via" || token === "--quote") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${token} needs a value`);
      const key = token.slice(2) as "by" | "root" | "via" | "quote";
      if (args[key] !== undefined) throw new Error(`${token} is given twice`);
      args[key] = value;
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
    // The record as the repo root sees it (`clossys/evidence/director/...`), the path every message names.
    const shown = relative(dirname(base), join(base, "evidence", "director", `${ARCHETYPE_RECORD_ID}.md`)).split("\\").join("/");
    if (args.name === undefined) {
      if (args.by !== undefined || args.via !== undefined || args.quote !== undefined) throw new Error("--by, --via and --quote need an archetype name");
      const model = readStrategyRoot(root, store.reader, { catalog });
      const recorded = recordedArchetype(model.findings, catalog);
      if (recorded?.ok === false) throw new Error(`${path}: ${recorded.message}`);
      return out(0, { result: { archetype: model.tree?.archetype ?? "default", recorded: recorded ? { path: shown, by: recorded.by } : null } },
        recorded ? `Archetype: ${recorded.archetype} (recorded by ${recorded.by} in ${shown}).` : "Archetype: default (no archetype record).");
    }
    if (!archetypeNames(catalog).includes(args.name)) throw new Error(`Unknown strategy archetype: ${args.name} (expected ${archetypeNames(catalog).join(", ")})`);
    if (args.by === undefined || !ARCHETYPE_DECIDER.test(args.by)) throw new Error("--by owner[:<ref>] is required: the archetype is an owner decision");
    // The owner's own answer names its channel and keeps their words; owner:<ref> names where the words are already.
    if (args.by === "owner" && (args.via === undefined || args.quote === undefined)) throw new Error("--by owner takes --via chat|app|cli and --quote \"<the owner's words, verbatim>\"");
    if ((args.via === undefined) !== (args.quote === undefined)) throw new Error("--via and --quote go together");
    if (args.via !== undefined && !(ARCHETYPE_VIAS as readonly string[]).includes(args.via)) throw new Error(`--via must be ${ARCHETYPE_VIAS.join(", ")}, got ${args.via}`);
    if (args.quote !== undefined && (!args.quote.trim() || /[\r\n]/.test(args.quote))) throw new Error("--quote must be the owner's words on one line");
    const name = args.name, by = args.by;
    const said = args.via !== undefined ? { via: args.via as ArchetypeVia, quote: args.quote! } : undefined;
    return store.writer.locked(root, () => {
      const before = readStrategyFile(root, store.reader, path);
      const after = archetypeRecord(name, by, now(), said);
      if (before !== after) store.writer.commit(base, [{ path: `evidence/director/${ARCHETYPE_RECORD_ID}.md`, before, after }]);
      return out(0, { result: { archetype: name, recorded: { path: shown, by, ...(said ?? {}) }, changed: before !== after } }, `Archetype: ${name}, recorded by ${by}${said ? ` via ${said.via}` : ""} in ${shown}.`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return out(2, { error: message }, `clossys director check archetype: ${message}`);
  }
}
