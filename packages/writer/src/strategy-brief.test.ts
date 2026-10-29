import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateBriefContract } from "@clossys/strategist";

it("ships the complete writer.messaging contract against the Strategist catalog", () => {
  const contract = JSON.parse(readFileSync(new URL("../strategy-brief.json", import.meta.url), "utf8"));
  expect(validateBriefContract(contract)).toEqual({ ok: true, value: contract });
  expect(contract).toEqual({
    id: "writer.messaging", schemaVersion: 1, owner: "@clossys/writer",
    requires: ["identity.verbal.narrative", "identity.verbal.voice", "advantage.proposition.promise", "advantage.proposition.proof", "focus.segment.core", "context.customer.need"],
    optional: [],
  });
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(pkg.files).toContain("strategy-brief.json");
});
