import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { criterionIds } from "../constitution/criteria/core/catalog.js";
import {
  DEFAULT_LICENSES, exemplarIssues, ledgerEvents, loadStandards, parseTaste, readStandard, readStandardPolicy, requirementIssues,
  resolveRequirements, seedIssues, slotKinds, STANDARD_AGENTS, standardFits, standardFor, tasteIssues,
} from "./standards.js";

const FIXTURE = fileURLToPath(new URL("../constitution/__fixtures__/standards/fixture-headline/", import.meta.url));
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "standards-"));
  cpSync(FIXTURE, join(root, "packages", "writer", "standards", "fixture-headline"), { recursive: true });
  return root;
}

describe("records/standards", () => {
  it("reads the fixture standard clean, with every file hashed and the ledger kept apart", () => {
    const standard = readStandard(workspace(), "writer", "fixture-headline");
    expect(standard.issues).toEqual([]);
    expect(standard.dir).toBe("packages/writer/standards/fixture-headline");
    expect(standard.doc).toMatchObject({ id: "fixture-headline", kinds: ["strings"], mode: "craft", craftTier: "high", seeds: [] });
    expect(Object.keys(standard.files).sort()).toEqual(["exemplars/exemplars.json", "exemplars/house-voice.md", "exemplars/plain-claim.md", "requirements.json", "taste.md"]);
    expect(standard.exemplarFiles).toEqual(["house-voice.md", "plain-claim.md"]);
    expect(standard.taste?.criteria.map(criterion => criterion.id)).toEqual(["clarity", "voice", "rhythm"]);
    expect(standard.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(standard.ledger).toHaveLength(1);
    const registered = criterionIds();
    expect(requirementIssues(standard, registered)).toEqual([]);
    expect(tasteIssues(standard, registered)).toEqual([]);
    expect(exemplarIssues(standard, {})).toEqual([]);
    expect(seedIssues(standard, {})).toEqual([]);
  });

  it("the standard sha is the files' tree hash: stable, ledger-blind, content-sensitive", () => {
    const root = workspace();
    const first = readStandard(root, "writer", "fixture-headline").sha256;
    put(join(root, "packages", "writer", "standards", "fixture-headline", "ledger.json"), "{\"events\":[]}\n");
    expect(readStandard(root, "writer", "fixture-headline").sha256).toBe(first);
    put(join(root, "packages", "writer", "standards", "fixture-headline", "taste.md"), "## clarity\n");
    expect(readStandard(root, "writer", "fixture-headline").sha256).not.toBe(first);
  });

  it("reports unreadable parts: bad JSON, a symlink, missing files", () => {
    const root = workspace();
    const dir = join(root, "packages", "writer", "standards", "fixture-headline");
    put(join(dir, "requirements.json"), "{");
    expect(readStandard(root, "writer", "fixture-headline").issues.join("\n")).toMatch(/requirements\.json: /);
    symlinkSync(join(dir, "taste.md"), join(dir, "link.md"));
    expect(readStandard(root, "writer", "fixture-headline").issues.join("\n")).toMatch(/link\.md is a symbolic link/);
    const empty = mkdtempSync(join(tmpdir(), "standards-"));
    mkdirSync(join(empty, "packages", "writer", "standards", "bare"), { recursive: true });
    expect(readStandard(empty, "writer", "bare").issues).toEqual(["no requirements.json", "no taste.md", "no exemplars/ folder"]);
  });

  it("loads every agent's standards in agent then id order and finds one by agent", () => {
    const root = workspace();
    cpSync(FIXTURE, join(root, "packages", "director", "standards", "brief.voice"), { recursive: true });
    const all = loadStandards(root);
    expect(all.map(item => `${item.agent}/${item.id}`)).toEqual(["director/brief.voice", "writer/fixture-headline"]);
    expect(standardFor(all, "writer", "fixture-headline")?.agent).toBe("writer");
    expect(standardFor(all, "designer", "fixture-headline")).toBeUndefined();
    expect(STANDARD_AGENTS).toContain("producer");
  });

  it("parses taste anchors and ledger shapes", () => {
    expect(parseTaste("# t\n## `clarity`\n- 1: a\n* 2) b\n- 3. c\n# other\n- 4: ignored\n")).toEqual([{ id: "clarity", anchors: { 1: "a", 2: "b", 3: "c" } }]);
    expect(ledgerEvents([{ op: "a" }, 1])).toEqual([{ op: "a" }]);
    expect(ledgerEvents({ events: [{ op: "b" }] })).toEqual([{ op: "b" }]);
    expect(ledgerEvents("x")).toEqual([]);
  });

  it("matches a slot kind and its contract sub-kind", () => {
    expect(slotKinds("element", { kind: "button" })).toEqual(["element/button", "element"]);
    expect(slotKinds("element", {})).toEqual(["element"]);
    expect(standardFits({ kinds: ["element/button"] }, "element", { kind: "button" })).toBe(true);
    expect(standardFits({ kinds: ["element/button"] }, "element", {})).toBe(false);
    expect(standardFits({ kinds: ["element"] }, "element", { kind: "card" })).toBe(true);
  });

  it("reads policy.json licenses and seed registries, and defaults the license allowlist", () => {
    const consumer = mkdtempSync(join(tmpdir(), "standards-consumer-"));
    expect(readStandardPolicy(consumer, "designer")).toEqual({});
    put(join(consumer, "agents", "designer", "policy.json"), JSON.stringify({ licenses: ["MIT"], seedRegistries: ["shadcn", 3], other: true }));
    expect(readStandardPolicy(consumer, "designer")).toEqual({ licenses: ["MIT"], seedRegistries: ["shadcn"] });
    put(join(consumer, "agents", "writer", "policy.json"), "[");
    expect(readStandardPolicy(consumer, "writer").error).toMatch(/policy\.json/);
    expect(DEFAULT_LICENSES).toEqual(["MIT", "Apache-2.0", "CC0-1.0", "CC-BY-4.0"]);
  });

  it("resolves requirements: the contract parameterises and extends the standard's", () => {
    const standard = [{ check: "text.word-limit", params: { max: 12 } }, { check: "lexicon.clean", params: {} }];
    expect(resolveRequirements(standard, {})).toEqual(standard);
    expect(resolveRequirements(standard, { requirements: [{ check: "text.word-limit", params: { max: 8 } }, { check: "text.nonempty", params: {} }] })).toEqual([
      { check: "text.word-limit", params: { max: 8 } }, { check: "lexicon.clean", params: {} }, { check: "text.nonempty", params: {} },
    ]);
  });
});
