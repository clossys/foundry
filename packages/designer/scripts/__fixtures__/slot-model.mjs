/**
 * Test support: write a minimal valid Designer slot model (ia.json, slot folders, candidates,
 * pins) under `<root>/agents/designer`, so checks read it through the one slot-model reader.
 * Never used by a check at run time.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sha = text => createHash("sha256").update(text).digest("hex");

/**
 * Add or replace one Designer slot. `candidates` maps candidate file name to the registry item
 * (an object, written as JSON); `pin` names the pinned candidate (none = unpinned).
 */
export function writeDesignerSlot(root, { id, candidates, pin, uses = [] }) {
  const agent = join(root, "agents", "designer");
  const iaPath = join(agent, "ia.json");
  const ia = existsSync(iaPath) ? JSON.parse(readFileSync(iaPath, "utf8")) : { schema: "clossys.ia/1", source: "synthetic#test", extensions: [], nodes: [] };
  const layer = id.split(".")[0];
  let node = ia.nodes.find(row => row.id === layer);
  if (!node) ia.nodes.push(node = { id: layer, label: layer, children: [{ id: "all", label: "All", slots: [] }] });
  if (!node.children[0].slots.includes(id)) node.children[0].slots.push(id);
  mkdirSync(agent, { recursive: true });
  writeFileSync(iaPath, JSON.stringify(ia, null, 2));
  const dir = join(agent, id);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), JSON.stringify({ schema: "clossys.slot/1", id, agent: "designer", ia: {}, kind: "element", contract: {}, inputs: [], uses }));
  // IA order is global across nodes: place every slot again after the IA changed.
  let order = 0;
  for (const row of ia.nodes) for (const child of row.children) for (const slot of child.slots) {
    const path = join(agent, slot, "slot.json");
    if (existsSync(path)) {
      const doc = JSON.parse(readFileSync(path, "utf8"));
      writeFileSync(path, JSON.stringify({ ...doc, ia: { l0: row.id.split(".")[0], l1: row.id, l2: child.id, order } }));
    }
    order++;
  }
  let bytes;
  for (const [name, item] of Object.entries(candidates)) {
    const text = typeof item === "string" ? item : JSON.stringify(item);
    writeFileSync(join(dir, "candidates", name), text);
    if (name === pin) bytes = text;
  }
  if (pin) writeFileSync(join(dir, "pin.json"), JSON.stringify({ candidate: pin, sha256: sha(bytes), decidedBy: "owner:fixture", basis: "picked", at: "2026-11-04T00:00:00Z" }));
  return dir;
}
