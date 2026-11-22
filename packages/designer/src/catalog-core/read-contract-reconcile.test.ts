// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import assetSlots from "../catalog/slots/assets.json" with { type: "json" };
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import themeSlots from "../catalog/slots/themes.json" with { type: "json" };
import { checkComponentProfile } from "./check-components.js";
import type { ComponentCheckFill } from "./check-components.js";
import type { ComponentSlot } from "./types.js";
import { sha256 } from "./digest.js";
import { flatten } from "./model.js";
import { importShadcnAriaComponents, materializeShadcnComponent } from "../importers/shadcn-aria-components.js";
import { importShadcnAriaRail } from "../importers/shadcn-aria-rail.js";

// Target-state invariants over the current contracts, committed fills and importer output. Nothing here records a
// past state: every id, count and hash is computed at run time. THEMES-F: contracts grant shadcn themes leaves.
const registered = { themes: new Set((themeSlots as { id: string }[]).map(slot => slot.id)), assets: new Set((assetSlots as { id: string }[]).map(slot => slot.id)), components: new Set((componentSlots as { id: string }[]).map(slot => slot.id)) };
const slots = componentSlots as ComponentSlot[];
const directory = resolve(import.meta.dirname, "../catalog/fills/shadcn@aria");
const names = readdirSync(directory).filter(name => /^components\..*\.json$/.test(name)).sort();
const documents = names.filter(name => name !== "components.coverage.json").map(name => JSON.parse(readFileSync(resolve(directory, name), "utf8")));
const descriptors = documents.map(doc => Object.values(doc.components)[0] as ComponentCheckFill);
// Resolution-only registry: real existing member IDs, synthetic values, no observations.
const tokenDirectory = resolve(import.meta.dirname, "../catalog/fills");
const tokens = Object.fromEntries(readdirSync(tokenDirectory).flatMap(source => readdirSync(resolve(tokenDirectory, source)).filter(name => /^themes\..*\.json$/.test(name)).flatMap(name => Object.keys(flatten(JSON.parse(readFileSync(resolve(tokenDirectory, source, name), "utf8")))).map(id => [id, { property: `--fixture-${id.replaceAll(".", "-")}`, light: "#000000" }]))));
const profile = (contracts = slots, fills = descriptors) => ({ slots: contracts, fills, tokens, assets: [], observations: {}, installedRac: { version: "1.21.1", instance: "unobserved" } });
const tokenFindings = (contracts = slots, fills = descriptors) => checkComponentProfile(profile(contracts, fills)).findings.filter(f => f.code === "K3" && /(?:Token read|Read themes\.)/.test(f.message));
const read = (name: string) => readFileSync(resolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria", name), "utf8");
const input = () => ({ items: readdirSync(resolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria")).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"), styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } });
const outputHashes = (files: readonly { path: string; content: string }[]) => files.map(file => ({ path: file.path, sha256: sha256(file.content) })).sort((a, b) => a.path.localeCompare(b.path));

describe("read-contract reconciliation holds at the current source", () => {
  it("grants only registered leaves of the granted layer, once each, under the current allowedReads keys", () => {
    for (const slot of slots) {
      const reads = slot.contract.allowedReads as Record<string, readonly string[]>;
      // THEMES-F renamed the retired tokens key to themes; no contract grants a layer outside these three.
      expect(Object.keys(reads).filter(key => !Object.hasOwn(registered, key)), slot.id).toEqual([]);
      expect(Array.isArray(reads.themes) && Array.isArray(reads.assets), slot.id).toBe(true);
      for (const [layer, leaves] of Object.entries(reads)) {
        const known = registered[layer as keyof typeof registered];
        expect(leaves.filter(leaf => !known.has(leaf)), `${slot.id} grants unregistered ${layer}`).toEqual([]);
        expect(leaves.filter((leaf, index) => leaves.indexOf(leaf) !== index), `${slot.id} repeats ${layer}`).toEqual([]);
      }
    }
  });
  for (const descriptor of descriptors) it(`restores K3 when a granted ${descriptor.slot} read leaf is removed`, () => {
    expect(tokenFindings(slots, [descriptor])).toEqual([]);
    for (const leaf of [...new Set(descriptor.reads.themes.map(read => read.split(".").slice(0, 2).join(".")))]) {
      const changed = structuredClone(slots);
      const contract = changed.find(slot => slot.id === descriptor.slot)!.contract;
      contract.allowedReads.themes = contract.allowedReads.themes.filter(read => read !== leaf);
      // components.rich-text reads whole leaves (themes.font-sans); every other descriptor reads members.
      const member = descriptor.reads.themes.find(read => read === leaf || read.startsWith(`${leaf}.`))!;
      expect(tokenFindings(changed, [descriptor]), leaf).toContainEqual(expect.objectContaining({ subject: descriptor.slot, message: `Read ${member} is outside the contract` }));
    }
  });
  it("resolves every descriptor read against a registered themes member", () => {
    expect(tokenFindings().filter(f => f.message.startsWith("Token read "))).toEqual([]);
  });
  it("every committed descriptor joins one registered contract, reads members only, and claims no unmeasured runtime evidence", () => {
    const filled = descriptors.map(fill => fill.slot);
    expect(filled.filter((slot, index) => filled.indexOf(slot) !== index)).toEqual([]);
    const findings = checkComponentProfile(profile()).findings;
    for (const doc of documents) {
      const fill = Object.values(doc.components)[0] as ComponentCheckFill;
      const meta = doc.$extensions["com.clossys.fill"];
      const contract = slots.find(slot => slot.id === fill.slot);
      expect(contract, fill.slot).toBeDefined();
      expect(meta.slot, fill.slot).toBe(fill.slot);
      expect(fill.root, fill.slot).toBe(contract!.contract.root);
      expect(fill.reads.themes.filter(read => !/^themes\.[^.]+\.[^.]+$/.test(read)), fill.slot).toEqual([]);
      if (contract!.contract.members.mode === "closed") expect(fill.members.filter(member => !(contract!.contract.members as { names: readonly string[] }).names.includes(member)), fill.slot).toEqual([]);
      // No observation is supplied, so no fill is conformant or evidenced and each one is held on missing runtime evidence.
      expect({ evidence: meta.evidence, conforms: meta.conforms, status: meta.status }, fill.slot).toEqual({ evidence: [], conforms: [], status: "draft" });
      for (const code of ["K5", "K6", "K10"]) expect(findings.some(f => f.code === code && f.subject === fill.slot), `${fill.slot} ${code}`).toBe(true);
    }
  });
  it("every recorded output hash equals the hash of the importer's actual output", () => {
    const result = importShadcnAriaComponents(input()), rail = importShadcnAriaRail();
    const owned = new Set([...result.fills, ...result.composed].map(doc => doc.$extensions["com.clossys.fill"].slot));
    for (const doc of documents) {
      const fill = Object.values(doc.components)[0] as ComponentCheckFill & { item?: string; outputSha256: { path: string; sha256: string }[] };
      const composed = (doc.$extensions["com.clossys.fill"].originKinds ?? []).includes("composed");
      const leaf = fill.slot.replace(/^components\./, "");
      const files = composed
        ? [...JSON.parse(readFileSync(resolve(import.meta.dirname, `../catalog/rules/${fill.slot}.json`), "utf8")).files, ...result.composedFiles[leaf] ?? []]
        : (owned.has(fill.slot) ? result.rewrites[fill.item!] : rail.rewrites[fill.item!])?.files;
      expect(files, `${fill.slot} has no importer output`).toBeDefined();
      expect(fill.outputSha256, `${fill.slot} recorded output hash`).toEqual(outputHashes(files!));
    }
  });
  it("a DEC-A blocked rewrite stays blocked while its blocking rule holds, and a clean rewrite materializes only its hashed bytes", () => {
    const result = importShadcnAriaComponents(input());
    for (const [item, rewrite] of Object.entries(result.rewrites)) {
      expect(rewrite.outputSha256, item).toEqual(outputHashes(rewrite.files));
      if (rewrite.issues.length) {
        expect(() => materializeShadcnComponent(result, item), `${item} is blocked by ${rewrite.issues.map(issue => issue.code).join(", ")}`).toThrow(/unresolved/);
        continue;
      }
      expect(materializeShadcnComponent(result, item), item).toEqual(rewrite.files);
      const blocked = structuredClone(result); blocked.rewrites[item]!.issues.push({ code: "K7", file: rewrite.files[0]!.path, value: "glyph", message: "Unbound icon artwork remains" });
      expect(() => materializeShadcnComponent(blocked, item), `${item} with a blocker`).toThrow(/unresolved/);
      const changed = structuredClone(result); changed.rewrites[item]!.files[0]!.content += " ";
      expect(() => materializeShadcnComponent(changed, item), `${item} with a changed byte`).toThrow(/output hash differs/);
    }
    // A filled descriptor carries exactly its rewrite's blockers.
    for (const doc of result.fills) {
      const fill = Object.values(doc.components)[0]!;
      expect(fill.blockers, fill.slot).toEqual(result.rewrites[fill.item]!.issues);
    }
    // The committed coverage receipt keeps each item blocked exactly while the importer still finds its blockers.
    const committed = JSON.parse(readFileSync(resolve(directory, "components.coverage.json"), "utf8")) as { receipt: { item: string; slot: string; status: string; issues: unknown[] }[] };
    expect(committed.receipt.map(row => `${row.item} ${row.slot}`)).toEqual(result.receipt.map(row => `${row.item} ${row.slot}`));
    for (const row of result.receipt) {
      const recorded = committed.receipt.find(entry => entry.item === row.item && entry.slot === row.slot)!;
      expect({ status: recorded.status, issues: recorded.issues }, `${row.item} receipt`).toEqual({ status: row.status, issues: row.issues });
    }
  });
});
