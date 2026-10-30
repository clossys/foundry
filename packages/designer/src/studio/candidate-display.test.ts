import { expect, it } from "vitest";
import { applyLibraryChange, libraryHash } from "../catalog-core/index.js";
import { activeCandidateSource } from "./candidate-display.js";
import { buildCandidates } from "./model.js";
import { adopt, catalog, emptyLibrary } from "./__fixtures__/studio.js";

function candidates(library = adopt()) { return buildCandidates({ catalog, library, working: library, slotId: "tokens.surface-color", scope: "slot", target: "tokens.surface-color" }); }
it("displays one adopted provided source only when every current variant exactly matches it", () => {
 const rows = candidates();
 expect(rows.find(candidate => candidate.source === "foundry")!.usable).toBe(true);
 expect(activeCandidateSource(rows)).toBe("foundry");
 expect(rows.filter(candidate => candidate.selected).map(candidate => candidate.source)).toEqual(["example"]);
});
it("keeps authored or mixed variants in Custom", () => {
 const library = adopt();
 const authored = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: [{ op: "author", slot: "tokens.surface-color", tokens: { base: { $type: "color", $value: "#abcdef" } } }] });
 expect(activeCandidateSource(candidates(authored))).toBe(authored.source.id);
 expect(activeCandidateSource(candidates(emptyLibrary()))).toBeNull();
});
it("does not mark refreshed values, changed source bytes or a partial variant set active by source name", () => {
 for (const change of ["values", "bytes", "members"]) {
  const rows = structuredClone(candidates());
  const offered = rows.find(candidate => candidate.source === "foundry")!;
  if (change === "members") { expect(activeCandidateSource(rows.map(candidate => candidate === offered ? { ...candidate, members: offered.members.slice(1) } : candidate))).toBe("example"); continue; }
  if (change === "values") offered.members[0]!.member.css = { light: "#123456" };
  else { const origin = offered.members[0]!.member.origin!; if (origin.kind === "adopted") origin.sha256 = "b".repeat(64); }
  expect(activeCandidateSource(rows)).toBe("example");
 }
});
