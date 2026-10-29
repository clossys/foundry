/** Fictional cell roots shared by Publisher launch integration tests. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStrategy, validateBriefContract } from "@clossys/strategist";
import contract from "../strategy-brief.json";
export function launchRoot(ready = true): string {
  const root = mkdtempSync(join(tmpdir(), "publisher-launch-"));
  const ids = ready ? ["focus.segment.core", "focus.reach.channel", "focus.offer.included"] : [];
  writeFileSync(join(root, "tree.json"), JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: Object.fromEntries(ids.map(id => [id, 1])) }));
  for (const id of ids) {
    mkdirSync(join(root, "cells", id), { recursive: true });
    const cite = id === "focus.reach.channel" ? "focus.segment.core@1" : "";
    writeFileSync(join(root, "cells", id, "v1.md"), `---\nid: ${id}\nversion: 1\nstatus: active\nupdated: 2026-10-29\ncites: [${cite}]\nfeeds: []\nfunctions: []\nconfirmed: msg:2026-10-29-1#U2\n---\n\n## Direction\n- A fictional product summary for the review.\n- Not large factories.\n\n## Because\n- Fictional interview evidence.${cite ? ` (${cite})` : ""}\n\n## Watch\n- If requests > 5 each month, then review.\n`);
  }
  return root;
}
export function launchBrief(root: string) {
  const validated = validateBriefContract(contract);
  if (!validated.ok) throw new Error("Invalid Publisher test contract");
  return openStrategy(root, { contracts: [validated.value] }).getBrief("publisher.launch");
}
