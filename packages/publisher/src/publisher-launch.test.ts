import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBriefContract } from "@clossys/strategist";
import contract from "@clossys/publisher/strategy-brief.json";
import { publisherLaunchBrief } from "../templates/site/app/pack-review.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
describe("publisher.launch contract", () => {
  it("ships exactly the launch cells with the release optional", () => {
    expect(validateBriefContract(contract).ok).toBe(true);
    expect(contract.requires).toEqual(["focus.reach.channel", "focus.offer.included"]);
    expect(contract.optional).toEqual(["execution.roadmap.release"]);
  });
  it("blocks launch when required cells have no active version", () => {
    const root = mkdtempSync(join(tmpdir(), "publisher-launch-")); roots.push(root);
    mkdirSync(join(root, "cells"));
    writeFileSync(join(root, "tree.json"), JSON.stringify({ schemaVersion: 1, catalog: "@clossys/strategist#strategy-v1", archetype: "default", core: "archetype", active: {} }));
    const brief = publisherLaunchBrief(root);
    expect(brief.state).toBe("missing");
    expect(brief.missing).toEqual(["focus.offer.included", "focus.reach.channel"]);
  });
});
