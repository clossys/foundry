import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flatConsumer } from "../cli/__fixtures__/flat-consumer.js";
import { runCli } from "../cli/main.js";
import { readiness } from "../records/slots.js";
import { DESIGN_BRIEF_INPUTS } from "../records/slot-model/design-brief-inputs.js";
import { designerIa } from "../records/slot-model/foundry-ia.js";
import { applyInputsMigration, planInputsMigration } from "./inputs.js";

const BRIEF = DESIGN_BRIEF_INPUTS.map(([, id]) => id as string);

/** A copy of the repository consumer with two slots put back to undeclared inputs. */
function undeclaredConsumer() {
  const root = flatConsumer(["director", "designer", "writer"]);
  const consumer = join(root, "clossys");
  const designer = join(consumer, "agents", "designer", "sections.cards", "slot.json");
  const writer = join(consumer, "agents", "writer", "passages.sectioned-document", "slot.json");
  const declared = { designer: readFileSync(designer, "utf8"), writer: readFileSync(writer, "utf8") };
  const clear = (path: string) => writeFileSync(path, `${JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), inputs: [] }, null, 2)}\n`);
  clear(designer); clear(writer);
  return { root, consumer, designer, writer, declared };
}

describe("clossys migrate inputs", () => {
  it("declares Designer inputs from the brief and the slot contract's theme and asset reads", () => {
    const cards = designerIa().slots.get("sections.cards")!;
    expect(cards.declaredInputs).toEqual(expect.arrayContaining([...BRIEF, "assets.image", "themes.card"]));
    expect(cards.declaredInputs).not.toContain("sections.cards");
  }, 60_000);

  it("restores undeclared inputs from the read graph, and a second run plans nothing", () => {
    const fixture = undeclaredConsumer();
    expect(readiness(fixture.consumer, "writer", "passages.sectioned-document").blockedBy).toEqual([{ slot: "passages.sectioned-document", reason: "inputs-undeclared" }]);
    const plan = planInputsMigration(fixture.consumer);
    expect(plan.findings).toEqual([]);
    expect(plan.changes.find(change => change.slot === "passages.sectioned-document")?.added).toEqual(["identity.verbal.voice"]);
    expect(plan.changes.find(change => change.slot === "sections.cards")?.added).toEqual(expect.arrayContaining([...BRIEF, "assets.image"]));
    applyInputsMigration(fixture.consumer, plan);
    expect(readFileSync(fixture.designer, "utf8")).toBe(fixture.declared.designer);
    expect(readFileSync(fixture.writer, "utf8")).toBe(fixture.declared.writer);
    expect(readiness(fixture.consumer, "writer", "passages.sectioned-document").blockedBy).toEqual([]);
    expect(planInputsMigration(fixture.consumer).files).toEqual([]);
  }, 60_000);

  it("only adds inputs: a declared input outside the read graph stays", async () => {
    const fixture = undeclaredConsumer();
    const doc = JSON.parse(readFileSync(fixture.writer, "utf8"));
    writeFileSync(fixture.writer, `${JSON.stringify({ ...doc, inputs: ["focus.segment.core"] }, null, 2)}\n`);
    expect((await runCli(["migrate", "inputs", "--check", "--root", fixture.root], fixture.root)).exitCode).toBe(1);
    expect((await runCli(["migrate", "inputs", "--root", fixture.root], fixture.root)).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(fixture.writer, "utf8")).inputs).toEqual(["focus.segment.core", "identity.verbal.voice"]);
    expect((await runCli(["migrate", "inputs", "--check", "--root", fixture.root], fixture.root)).exitCode).toBe(0);
  }, 60_000);
});
