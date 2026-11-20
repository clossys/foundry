/**
 * DIR-CERT (foundry-audit-0011): the 55 Director brief contracts carry a contract fixture, and the
 * certifier both passes and fails against it for every Director standard.
 *
 * The repository's own clossys/ records are retired (SOURCE-MIGRATE step 11), and the fixture consumer
 * ships its Director slots unpinned. Each standard's proof therefore runs on a scratch copy of the
 * fixture consumer in which one slot of that standard holds a pinned brief written from the slot's
 * own contract keys and citing the Director input that slot declares. The fixture consumer itself is never written.
 */
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { consumerPath } from "../../consumer-root.js";
import { dependencySet } from "../checks/shared.js";
import { buildContext } from "../context.js";
import { NO_HISTORY, validPin } from "../__fixtures__/workspace.js";
import { certify, certifyEnv, slotDocOf } from "./index.js";

/** The repository root: the packages' standards are read from here. */
const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const HEADINGS = ["Direction", "Because", "Watch"];
const STANDARDS = ["brief.list", "brief.measure", "brief.profile", "brief.statement"];
const CANDIDATE = "fixture-brief-v1.md";

/**
 * A brief that meets every Director standard's checks for this slot: each contract key answered once
 * with a short quantified, bounded value, one cited reason, and one measurable watch.
 */
function briefFor(slot: string, keys: readonly string[], ref: string): string {
  const direction = keys.map(key => `- ${key}: 25 units by 2027, not more.`).join("\n");
  return `---\nslot: "${slot}"\nsource: {"kind":"derived","ref":["${ref}"]}\nfeeds: []\nfunctions: []\n---\n\n## Direction\n\n${direction}\n\n## Because\n\n- The upstream brief sets this target (${ref}).\n\n## Watch\n\n- If weekly signups fall below 40 in any month, then revisit this brief.\n`;
}

describe("Director contract fixtures (R05 for agent director)", () => {
  const fixture = consumerPath();
  const base = buildContext(ROOT, fixture, { history: () => NO_HISTORY });
  const baseSlots = [...base.agents.find(agent => agent.agent === "director")!.slots.values()].filter(slot => slot.live);
  const standardOf = (slot: (typeof baseSlots)[number]) => String(slotDocOf(slot).doc.standard ?? "");

  // One slot per standard gets a pinned brief in a scratch copy, citing a Director slot its slot.json declares as an input or use.
  const inputOf = (slot: (typeof baseSlots)[number]) =>
    [...(dependencySet(slot) ?? [])].filter(id => base.agents.find(agent => agent.agent === "director")!.slots.has(id)).sort()[0];
  const scratch = mkdtempSync(join(realpathSync(tmpdir()), "director-fixtures-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const consumer = join(scratch, "clossys");
  cpSync(fixture, consumer, { recursive: true });
  const chosen = new Map<string, string>();
  for (const standard of STANDARDS) {
    const slot = baseSlots.filter(item => standardOf(item) === standard && inputOf(item)).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!slot) continue;
    const ref = inputOf(slot)!;
    const keys = ((slotDocOf(slot).contract.mustContain ?? []) as { key?: unknown }[]).map(item => item.key).filter((key): key is string => typeof key === "string");
    const text = briefFor(slot.id, keys, ref);
    const dir = join(consumer, "agents", "director", slot.id);
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "candidates", CANDIDATE), text);
    writeFileSync(join(dir, "pin.json"), `${JSON.stringify(validPin(CANDIDATE, text), null, 2)}\n`);
    chosen.set(standard, slot.id);
  }
  const ctx = buildContext(ROOT, consumer, { history: () => NO_HISTORY });
  const env = certifyEnv(ctx);
  const director = ctx.agents.find(agent => agent.agent === "director")!;
  const slots = [...director.slots.values()].filter(slot => slot.live);

  it("every live Director slot declares the brief fixture headings", () => {
    expect(baseSlots).toHaveLength(55);
    for (const slot of baseSlots) expect((slotDocOf(slot).contract.fixture as { headings?: unknown })?.headings, slot.id).toEqual(HEADINGS);
    expect([...new Set(baseSlots.map(standardOf))].sort()).toEqual(STANDARDS);
    expect([...chosen.keys()].sort()).toEqual(STANDARDS);
  });

  for (const standard of STANDARDS) {
    it(`${standard}: a pinned candidate passes its fixture and standard; without "## Watch", or against a fixture asking one more heading, it fails`, () => {
      const pinned = slots.filter(slot => standardOf(slot) === standard && slot.pin).map(slot => ({ slot, candidate: slot.candidates.find(item => item.name === (slot.pin!.value as { candidate?: string }).candidate)! })).filter(input => input.candidate);
      expect(pinned.map(input => input.slot.id), standard).toEqual([chosen.get(standard)]);
      const passing = pinned.filter(input => certify(input, env).certified);
      expect(passing.length, `${standard}: ${JSON.stringify(pinned.map(input => certify(input, env).reasons))}`).toBeGreaterThan(0);
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
