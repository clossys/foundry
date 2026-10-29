import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateBriefContract } from "../../strategist/src/brief-contracts.js";

it("ships a valid customer persona brief contract", () => {
  const contract: unknown = JSON.parse(readFileSync(new URL("../strategy-brief.json", import.meta.url), "utf8"));
  const result = validateBriefContract(contract);

  expect(result).toMatchObject({ ok: true, value: { id: "customer.persona", owner: "@clossys/customer" } });
});
