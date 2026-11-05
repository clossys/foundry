/** Fictional flat Director slot roots shared by Publisher launch integration tests. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStrategy, validateBriefContract } from "@clossys/director";
import contract from "../strategy-brief.json";
import { directorStoreReader } from "../../producer/src/records/slots.js";

/**
 * Stages one pinned Director slot: `<id>/{slot.json, candidates/fixture-v1.md, pin.json}`, the
 * same shape as @clossys/director's own test fixtures (src/ground/fixtures.ts), kept local so the
 * package's public exports stay unchanged.
 */
function stageSlot(root: string, id: string, cite?: string): void {
  const dir = join(root, id);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  const [l1, l2] = id.split(".");
  writeFileSync(join(dir, "slot.json"), `${JSON.stringify({ schema: "clossys.slot/1", id, agent: "director", ia: { l1, l2: `${l1}.${l2}`, order: 0 }, kind: "brief", contract: { question: "Fixture question?", mustContain: [] }, inputs: [], uses: [], options: 1 }, null, 2)}\n`);
  const name = "fixture-v1.md";
  const bytes = [
    "---",
    `slot: ${JSON.stringify(id)}`,
    `source: ${JSON.stringify({ kind: "derived", ref: cite ? [cite] : [] })}`,
    "feeds: []",
    "functions: []",
    "---",
    "",
    "## Direction",
    "- A fictional product summary for the review.",
    "- Not large factories.",
    "",
    "## Because",
    `- Fictional interview evidence.${cite ? ` (${cite})` : ""}`,
    "",
    "## Watch",
    "- If requests > 5 each month, then review.",
    "",
  ].join("\n");
  writeFileSync(join(dir, "candidates", name), bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(dir, "pin.json"), `${JSON.stringify({ candidate: name, sha256, decidedBy: "fixture", basis: "test", at: "2026-10-29T00:00:00Z" }, null, 2)}\n`);
}

export function launchRoot(ready = true): string {
  const root = mkdtempSync(join(tmpdir(), "publisher-launch-"));
  const ids = ready ? ["focus.segment.core", "focus.reach.channel", "focus.offer.included"] : [];
  for (const id of ids) stageSlot(root, id, id === "focus.reach.channel" ? "focus.segment.core@1" : undefined);
  return root;
}
export function launchBrief(root: string) {
  const validated = validateBriefContract(contract);
  if (!validated.ok) throw new Error("Invalid Publisher test contract");
  return openStrategy(root, directorStoreReader, { contracts: [validated.value] }).getBrief("publisher.launch");
}
