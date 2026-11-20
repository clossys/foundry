/**
 * Upstream setup for guarded decision tests (foundry-build-0048 U13 r4, B1). The pin and pick guards run R02.2
 * (every slot in the target's dependency set is live and intactly pinned) and R20.2 (a Writer candidate cites a
 * pinned Director slot), so a test that pins a downstream slot with the guard on first pins its upstream. Each
 * unpinned dependency gets one fixture candidate valid for its kind family (a brief, strings, or a registry item),
 * headered by the one candidate codec, and a clossys.pin/2 naming its bytes, written as data: the guard judges only
 * the target's rows, so these pins are not under test, but every reader of pinned candidates (specimens, Publisher
 * install) reads them as valid candidates.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { candidateCodec } from "../../records/candidate-codec.js";
import { sha256Hex } from "../../records/hash.js";
import { slotFamily } from "../../records/slot-current.js";
import { readSlot } from "../../records/slots.js";
import { jsonBytes, KIND_EXT } from "../../records/slot-model/index.js";

/** The agent folder that holds slot `id`, or undefined. */
function agentOf(consumer: string, id: string): string | undefined {
  const agents = join(consumer, "agents");
  return readdirSync(agents).find(agent => existsSync(join(agents, agent, id, "slot.json")));
}

const SOURCE = { kind: "original", ref: [] } as const;

/** An unheadered candidate view valid for the slot's kind family (records/slot-model/validate.ts validateCandidate). */
function upstreamView(family: unknown, id: string): { readonly ext: string; readonly bytes: string } {
  if (family === "brief") {
    return { ext: "md", bytes: `---\nslot: "${id}"\nsource: ${JSON.stringify(SOURCE)}\nfeeds: []\nfunctions: []\n---\n## Direction\n- ${id}: fixture upstream.\n\n## Because\n- A guarded test needs it pinned.\n\n## Watch\n- Nothing.\n` };
  }
  if (typeof family === "string" && Object.hasOwn(KIND_EXT, family) && KIND_EXT[family as keyof typeof KIND_EXT] === "md") {
    return { ext: "md", bytes: `---\nslot: "${id}"\nlocales: ["en"]\nsource: ${JSON.stringify(SOURCE)}\n---\n\n## en\n` };
  }
  const type = id.startsWith("themes.") ? "registry:theme" : "registry:ui";
  return { ext: "json", bytes: jsonBytes({ name: "upstream", type, files: [], meta: { slot: id, source: SOURCE } }) };
}

/** Pin every unpinned slot in `<agent>/<slotId>`'s dependency set (inputs and uses); returns the slots it pinned. */
export function pinUpstream(consumer: string, agent: string, slotId: string, at: string): string[] {
  const doc = readSlot(consumer, agent as never, slotId);
  const pinned: string[] = [];
  for (const id of [...new Set([...(doc.inputs ?? []), ...(doc.uses ?? [])])].sort()) {
    if (id === slotId) continue;
    const owner = agentOf(consumer, id);
    if (!owner) continue;
    const cell = join(consumer, "agents", owner, id);
    if (existsSync(join(cell, "pin.json"))) continue;
    let family: unknown;
    try { family = slotFamily(readSlot(consumer, owner as never, id).kind); } catch { family = undefined; }
    const view = upstreamView(family, id);
    const name = `upstream-v1.${view.ext}`;
    const bytes = candidateCodec.headered(name, view.bytes, { agent: owner as never, slotId: id, at: at as never, version: "0.0.0-test", sourceRef: `agents/${owner}/${id}/candidates/${name}`, cli: "clossys test" });
    mkdirSync(join(cell, "candidates"), { recursive: true });
    writeFileSync(join(cell, "candidates", name), bytes);
    writeFileSync(join(cell, "pin.json"), jsonBytes({
      schema: "clossys.pin/2", id: `${owner}/${id}/pin`, agent: owner, kind: "pin", status: "pinned",
      createdBy: { actor: "code", cli: "clossys pin", version: "1.0.0" }, createdAt: at, updatedAt: at, refs: [],
      candidate: name, sha256: sha256Hex(bytes), decidedBy: "planner:fixture", basis: "planner", at,
    }));
    pinned.push(`${owner}/${id}`);
  }
  return pinned;
}
