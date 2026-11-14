/**
 * DIR-CERT (foundry-audit-0011): the 57 Director brief contracts carry a contract fixture, and the
 * certifier both passes and fails against it for every Director standard, on the real records.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import { NO_HISTORY } from "../__fixtures__/workspace.js";
import { certify, certifyEnv, slotDocOf } from "./index.js";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const HEADINGS = ["Direction", "Because", "Watch"];
const STANDARDS = ["brief.list", "brief.measure", "brief.profile", "brief.statement"];

describe("Director contract fixtures (R05 for agent director)", () => {
  const ctx = buildContext(ROOT, `${ROOT}clossys`, { history: () => NO_HISTORY });
  const env = certifyEnv(ctx);
  const director = ctx.agents.find(agent => agent.agent === "director")!;
  const slots = [...director.slots.values()].filter(slot => slot.live);
  const standardOf = (slot: (typeof slots)[number]) => String(slotDocOf(slot).doc.standard ?? "");

  it("every live Director slot declares the brief fixture headings", () => {
    expect(slots).toHaveLength(57);
    for (const slot of slots) expect((slotDocOf(slot).contract.fixture as { headings?: unknown })?.headings, slot.id).toEqual(HEADINGS);
    expect([...new Set(slots.map(standardOf))].sort()).toEqual(STANDARDS);
  });

  for (const standard of STANDARDS) {
    it(`${standard}: a pinned candidate passes its fixture and standard; without "## Watch", or against a fixture asking one more heading, it fails`, () => {
      const pinned = slots.filter(slot => standardOf(slot) === standard && slot.pin).map(slot => ({ slot, candidate: slot.candidates.find(item => item.name === (slot.pin!.value as { candidate?: string }).candidate)! })).filter(input => input.candidate);
      const passing = pinned.filter(input => certify(input, env).certified);
      expect(passing.length, standard).toBeGreaterThan(0);
      for (const { slot, candidate } of passing) {
        const text = candidate.text.replace(/^## Watch\b[\s\S]*?(?=^## |(?![\s\S]))/m, "");
        expect(text).not.toBe(candidate.text);
        expect(certify({ slot, candidate: { ...candidate, text } }, env).certified, `${slot.id} ${candidate.name} without Watch`).toBe(false);
        const contract = { ...slotDocOf(slot).contract, fixture: { headings: [...HEADINGS, "Counterpoint"] } };
        const failed = certify({ slot, candidate, contract }, env);
        expect(failed.certified, `${slot.id} ${candidate.name}`).toBe(false);
        expect(failed.reasons.map(item => item.code)).toContain("fixture");
      }
    });
  }
});
