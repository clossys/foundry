/**
 * Test helpers for the agent verbs: a temp consumer holding copies of the repository's own flat
 * slot folders (`clossys/agents/<agent>/<slot-id>/{slot.json,candidates/,pin.json}`), and a
 * byte-and-mtime snapshot that proves a verb wrote nothing into it.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SlotAgent } from "../../records/slot-model/index.js";
import { consumerPath } from "../../consumer-root.js";
import { recutCandidateBytes } from "../../migrate/recut.js";

const here = dirname(fileURLToPath(import.meta.url));
export const entry = resolve(here, "../../../dist/cli/index.js");
export const repoConsumer = consumerPath();
/**
 * The int2 fixture consumer's clossys/ as it was before `clossys migrate recut` moved test-fixtures/consumer to the
 * current tree (foundry-build-0048 U2): the input of the tests that migrate a legacy store.
 */
export const int2Consumer = resolve(here, "../../../test-fixtures/consumer-int2/clossys");

/** A temp root whose `clossys/` holds copies of the named agents' slot folders (from the repository consumer by default). */
export function flatConsumer(agents: readonly SlotAgent[], from: string = repoConsumer): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-flat-")));
  mkdirSync(join(root, "clossys", "agents"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "throw new Error('Config must not execute');\n");
  for (const agent of agents) cpSync(join(from, "agents", agent), join(root, "clossys", "agents", agent), { recursive: true });
  // Director evidence lives outside the agent tree (clossys/evidence/director, rule R-GIT-CMS). It is optional, as
  // readDirectorEvidence treats a missing folder as no findings; the synthetic fixture consumer holds none.
  if (agents.includes("director") && existsSync(join(from, "evidence", "director"))) cpSync(join(from, "evidence", "director"), join(root, "clossys", "evidence", "director"), { recursive: true });
  return root;
}

/**
 * Make the repository's installed brief contracts (`@clossys/<pkg>/strategy-brief.json`) visible to a temp consumer,
 * as they are to the repository's own `clossys/`: a real `node_modules/@clossys/<pkg>/` holding a copy of each
 * workspace package's contract (copies, not links, so `snapshot` stays inside the temp root).
 */
export function withBriefContracts(root: string): string {
  const scope = join(root, "node_modules", "@clossys");
  mkdirSync(scope, { recursive: true });
  const packages = resolve(here, "../../../..");
  for (const name of readdirSync(packages).sort()) {
    try { statSync(join(packages, name, "strategy-brief.json")); } catch { continue; }
    mkdirSync(join(scope, name));
    cpSync(join(packages, name, "strategy-brief.json"), join(scope, name, "strategy-brief.json"));
  }
  return root;
}

/**
 * The first pinned slot of an agent, with its pinned candidate's path. A Writer Prose or Copy slot pins per record
 * (`clossys.pin-map/1`); its first record in record order stands as the slot's pin, as the slot reader reads it
 * (`pinView`), and `record` names it.
 */
export function firstPinned(root: string, agent: SlotAgent, accept: (id: string) => boolean = () => true): { id: string; dir: string; candidate: string; record?: string } {
  const base = join(root, "clossys", "agents", agent);
  for (const id of readdirSync(base).sort()) {
    const dir = join(base, id);
    if (!accept(id) || !statSync(dir).isDirectory()) continue;
    try {
      const pin = JSON.parse(readFileSync(join(dir, "pin.json"), "utf8")) as { schema?: string; candidate?: string; records?: Record<string, { candidate: string }> };
      if (pin.schema === "clossys.pin-map/1") {
        const record = Object.keys(pin.records ?? {}).sort()[0];
        if (record) return { id, dir, candidate: join(dir, "candidates", pin.records![record]!.candidate), record };
        continue;
      }
      if (typeof pin.candidate === "string") return { id, dir, candidate: join(dir, "candidates", pin.candidate) };
    } catch { /* unpinned */ }
  }
  throw new Error(`No pinned ${agent} slot`);
}

/** Record new candidate bytes' sha256 in a pin found by `firstPinned` (the record's entry, for a pin map). */
export function repinSha(pinned: { dir: string; record?: string }, bytes: string): void {
  const file = join(pinned.dir, "pin.json");
  const pin = JSON.parse(readFileSync(file, "utf8"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (pinned.record !== undefined) pin.records[pinned.record] = { ...pin.records[pinned.record], sha256 };
  else pin.sha256 = sha256;
  writeFileSync(file, `${JSON.stringify(pin, null, 2)}\n`);
}

/**
 * Seed a temp consumer's pinned Writer set, for the verbs that read one: the synthetic fixture consumer pins nothing
 * (it holds slot folders and package defaults only), and no Writer package default is a native Writer body
 * (`## <locale>` records under `locales`, writer/skill/SKILL.md). Each named Director slot gets one synthetic
 * Direction/Because/Watch candidate; one Writer record slot gets one native Writer candidate. Every candidate carries
 * the candidate/1 header the migration writes, and every pin goes through `clossys pin` (its checks unchanged).
 */
export function seedWriterPins(root: string, director: readonly string[], writer: { slot: string; record: string }): void {
  const at = "2026-11-17T00:00:00Z";
  const put = (agent: SlotAgent, slotId: string, name: string, text: string) => {
    const dir = join(root, "clossys", "agents", agent, slotId, "candidates");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), recutCandidateBytes(name, text, { agent, slotId, at, version: "0.0.0", sourceRef: `agents/${agent}/${slotId}/candidates/${name}` }));
  };
  const pin = (target: string, name: string) => {
    const result = runVerb(["pin", target, name, "--by", "planner", "--at", at], root);
    if (result.status !== 0) throw new Error(`seed pin ${target} refused: ${result.stdout}${result.stderr}`);
  };
  for (const id of director) {
    put("director", id, "seed-v1.md", `---\nslot: "${id}"\nsource: {"kind":"original","ref":[]}\nfeeds: []\nfunctions: []\n---\n\n`
      + "## Direction\n- Sound: plain and specific.\n\n## Because\n- The example site speaks to readers who want facts first.\n\n"
      + "## Watch\n- If a page uses a word the voice rules out, then return it to Writer.\n");
    pin(`director/${id}`, "seed-v1.md");
  }
  const name = `${writer.record}-v1.md`;
  put("writer", writer.slot, name, `---\nslot: "${writer.slot}"\nlocales: ["en"]\nsource: {"kind":"original","ref":[]}\n---\n\n`
    + `## en\n\n### Heading\n<!-- {"id":"${writer.record}.heading","bindings":[]} -->\nA plain heading\n`);
  pin(`writer/${writer.slot}#${writer.record}`, name);
}

export function runVerb(args: readonly string[], cwd: string): { status: number | null; stdout: string; stderr: string; value: any } {
  const result = spawnSync(process.execPath, [entry, ...args, "--json"], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  let value: any;
  try { value = JSON.parse(result.stdout); } catch { value = undefined; }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, value };
}

export function snapshot(root: string, dir = root): unknown[] {
  return readdirSync(dir).sort().flatMap((name): unknown[] => {
    const path = join(dir, name), stat = statSync(path);
    const item = { path: relative(root, path), mtimeMs: stat.mtimeMs };
    return stat.isDirectory() ? [item, ...snapshot(root, path)] : [{ ...item, hash: createHash("sha256").update(readFileSync(path)).digest("hex") }];
  });
}
