/**
 * Test support: certified fixture slots (R05) in a temp workspace, built the way the constitution's
 * certified fixtures are (`constitution/rules/r05.world.ts`): a fixture standard copied into
 * `packages/<agent>/standards/`, named on the slot, and a contract fixture the candidates fit. Pins
 * and picks are guarded by R05.1 and R05.2 (slot-constitution.md section 4), so a test that pins a
 * slot of a scratch copy of the real records certifies that slot first. The slot.json change goes
 * through `clossys ia --contract --standard`, the verb that writes a slot's contract and standard
 * with its ledger event (R14.1); nothing here writes a record by hand.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bodyHeadings } from "../../constitution/certify/brief.js";
import { writerRecords } from "../../constitution/certify/env.js";
import type { CandidateRecord } from "../../constitution/types.js";
import { parseFrontmatter } from "../../records/slot-model/index.js";
import { runCli } from "../main.js";

/** The fixture standard for scratch-copy pins: Writer strings and Director briefs, one core requirement (text.nonempty). */
export const COPY_STANDARD = "fixture-copy";
const STANDARDS = fileURLToPath(new URL("../../constitution/__fixtures__/standards/", import.meta.url));

type CertifiedAgent = "writer" | "director";
const intersect = (sets: readonly (readonly string[])[]): string[] => sets.length ? [...new Set(sets[0])].filter(item => sets.every(set => set.includes(item))).sort() : [];

/**
 * The contract fixture `candidates` all fit: a strings slot's keys and locales (closed when every
 * candidate holds the same keys, else open over the keys they share), a brief's shared headings.
 */
export function fittingFixture(agent: CertifiedAgent, texts: readonly string[]): { fixture: Record<string, unknown>; open?: true } {
  if (agent === "director") {
    const headings = texts.map(text => {
      const parsed = parseFrontmatter(text);
      if (!parsed.ok) throw new Error(`fixture brief does not parse: ${parsed.message}`);
      return [...bodyHeadings(parsed.value.body)];
    });
    return { fixture: { headings: intersect(headings) } };
  }
  const read = texts.map(text => {
    const records = writerRecords({ text } as CandidateRecord);
    if ("error" in records) throw new Error(`fixture strings do not parse: ${records.error}`);
    return records;
  });
  const keys = read.map(records => [...new Set(records.rows.map(row => row.id))]);
  const shared = intersect(keys);
  const fixture = { keys: shared, locales: intersect(read.map(records => records.locales)) };
  return keys.every(set => set.length === shared.length) ? { fixture } : { fixture, open: true };
}

/**
 * A Writer candidate's bytes with a frontmatter `reason` citing the pinned Director slot it realises
 * (R20.2: a pinned Writer candidate names the Director decision it realises; `source.ref` alone is
 * not a trace). An existing reason line is replaced.
 */
export function directorTraced(text: string, director: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("directorTraced: the candidate has no frontmatter");
  const fields = match[1]!.split("\n").filter(line => !line.startsWith("reason:"));
  fields.push(`reason: ${JSON.stringify(`Realises director:${director}.`)}`);
  return `---\n${fields.join("\n")}\n---\n${text.slice(match[0].length)}`;
}

/** The slot ids a candidate's `source.ref` cites (a `finding:`-style ref is not a slot). */
function citedSlots(text: string): string[] {
  const parsed = parseFrontmatter(text);
  const ref = parsed.ok ? (parsed.value.fields.source as { ref?: unknown } | undefined)?.ref : undefined;
  return Array.isArray(ref) ? ref.filter((item): item is string => typeof item === "string" && /^[a-z0-9][a-z0-9.-]*$/.test(item)) : [];
}

/**
 * Certify `slots` (slot id → the candidate names the test pins) of `agent` under `root`: copy the
 * fixture standard into `packages/<agent>/standards/`, then name it and a fitting contract fixture
 * on each slot through `clossys ia`. The slot's other contract fields are kept.
 */
export async function certifySlots(root: string, agent: CertifiedAgent, slots: Readonly<Record<string, readonly string[]>>): Promise<void> {
  const standard = join(root, "packages", agent, "standards", COPY_STANDARD);
  if (!existsSync(standard)) cpSync(join(STANDARDS, COPY_STANDARD), standard, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "certified-contract-"));
  try {
    for (const [id, names] of Object.entries(slots)) {
      const dir = join(root, "clossys", "agents", agent, id);
      const doc = JSON.parse(readFileSync(join(dir, "slot.json"), "utf8")) as { contract?: Record<string, unknown>; inputs?: string[] };
      const texts = names.map(name => readFileSync(join(dir, "candidates", name), "utf8"));
      // A rewritten contract passes the kind's contract gate (foundry-build-0048 U5): it names a registered requirement.
      const contract = { requirements: [{ check: "text.nonempty" }], ...(doc.contract ?? {}), ...fittingFixture(agent, texts) };
      const file = join(scratch, `${id}.json`);
      writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
      // A slot a candidate cites is declared an input (R05.1 citation, R07.1).
      const inputs = [...new Set([...(doc.inputs ?? []), ...texts.flatMap(citedSlots)])].sort();
      const result = await runCli(["ia", `${agent}/${id}`, "--contract", file, "--standard", COPY_STANDARD, ...(inputs.length ? ["--inputs", inputs.join(",")] : []), "--root", root], root);
      if (result.exitCode !== 0) throw new Error(`certifySlots: clossys ia ${agent}/${id} exited ${result.exitCode}: ${result.message}`);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
