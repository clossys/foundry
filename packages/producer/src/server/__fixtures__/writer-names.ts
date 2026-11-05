/**
 * Test fixture: the pinned Writer names (writer/strings.names) of a synthetic consumer. A slot or
 * IA label has no fallback (src/records/slot-labels.ts), so a fixture that projects labels names
 * every IA node, group and slot of every agent, by its IA label or id, and places the names slot
 * in the writer IA. Synthetic test data only; never a consumer's copy.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeFrontmatter, slotPositions, type IaDoc, type SlotAgent } from "../../records/slot-model/index.js";

const NAMES = "strings.names";
const NODE = "strings.fixture-names";

/** `root` is a repository (with `clossys/`) or a consumer root (with `agents/`). */
export function writeFixtureNames(root: string): void {
  const agents = existsSync(join(root, "clossys")) ? join(root, "clossys/agents") : join(root, "agents");
  const writerIa = join(agents, "writer/ia.json");
  mkdirSync(join(agents, "writer"), { recursive: true });
  const ia: IaDoc = existsSync(writerIa) ? JSON.parse(readFileSync(writerIa, "utf8")) : { schema: "clossys.ia/1", source: "synthetic-test-only#fixture-names", extensions: [], nodes: [] };
  if (!ia.nodes.some(node => node.id === NODE)) {
    writeFileSync(writerIa, JSON.stringify({ ...ia, nodes: [...ia.nodes, { id: NODE, label: "Names", children: [{ id: "fixture-names", label: "Names", slots: [NAMES] }] }] }));
  }
  const rows: [string, string][] = [];
  for (const agent of readdirSync(agents)) {
    const file = join(agents, agent, "ia.json");
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, "utf8")) as IaDoc;
    for (const layer of (doc as { layers?: { id: string; label?: string }[] }).layers ?? []) rows.push([`${agent}.ia.${layer.id}`, layer.label ?? layer.id]);
    for (const node of doc.nodes) {
      rows.push([`${agent}.ia.${node.id}`, node.label]);
      for (const group of node.children) {
        rows.push([`${agent}.ia.${group.id}`, group.label]);
        for (const slot of group.slots) rows.push([`${agent}.item.${slot}`, slot]);
      }
    }
    // A slot's layer (its l0) is named too, the IA's own layer or the fallback slotPositions gives it.
    try { for (const position of slotPositions(agent as SlotAgent, doc).values()) if (position.l0) rows.push([`${agent}.ia.${position.l0}`, position.l0]); }
    catch { /* an invalid IA places nothing */ }
  }
  const seen = new Set<string>();
  rows.splice(0, rows.length, ...rows.filter(([context]) => !seen.has(context) && !!seen.add(context)));
  const body = rows.map(([context, text], index) => `### ${context}\n<!-- {"id":"st.names${index}","bindings":[]} -->\n${text}\n`).join("\n");
  const bytes = serializeFrontmatter({ slot: NAMES, locales: ["en"], source: { kind: "original", ref: [] } }, `## en\n\n${body}`);
  const dir = join(agents, "writer", NAMES);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "candidates/names-v1.md"), bytes);
  writeFileSync(join(dir, "pin.json"), JSON.stringify({ candidate: "names-v1.md", sha256: createHash("sha256").update(bytes).digest("hex"), decidedBy: "planner:synthetic-test-only", basis: "planner", at: "2026-01-01T00:00:00Z" }));
}
