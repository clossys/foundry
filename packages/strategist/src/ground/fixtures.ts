import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../catalog.js";

/** Fictional records shared by the grounding and CLI tests. */
export function findingFixture(id = "active-customers", value = 4200, aliases = ["4,200"]): string {
  return `---\nid: ${id}\nsource: evidence/count.csv\nobserved: 2026-10-29\nby: researcher\nvalue: ${value}\nunit: customers\naliases: ${JSON.stringify(aliases)}\n---\n- Observed in the count export.\n`;
}
export function stageFinding(root: string): void {
  mkdirSync(join(root, "findings"), { recursive: true });
  writeFileSync(join(root, "findings/active-customers.md"), findingFixture());
}
export function stageCell(root: string, id: string, version: number, key: string, text: string, status = "active"): void {
  mkdirSync(join(root, "cells", id), { recursive: true });
  writeFileSync(join(root, "cells", id, `v${version}.md`), `---\nid: ${id}\nversion: ${version}\nstatus: ${status}\nupdated: 2026-10-29\ncites: []\nfeeds: []\nfunctions: []\n${status === "active" ? "confirmed: msg:2026-10-29-1#U1\n" : ""}---\n\n## Direction\n- ${key}: ${text}\n\n## Because\n- Observed.\n\n## Watch\n- Review.\n`);
}
export function stageWontClaimCells(root: string): void {
  const active = Object.fromEntries(loadCatalog().cells.map(c => [c.id, null])) as Record<string, number | null>;
  active["advantage.proposition.proof"] = 1;
  active["identity.verbal.voice"] = 1;
  writeFileSync(join(root, "tree.json"), JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active }));
  stageCell(root, "advantage.proposition.proof", 1, "Never-claim", '"guaranteed results"');
  stageCell(root, "identity.verbal.voice", 1, "Never", '“risk-free”');
}
