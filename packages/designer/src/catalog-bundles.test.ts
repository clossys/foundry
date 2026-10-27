// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { installedHeadlessLibrary, loadCatalogBundles, prepareSourceOwnerClosure } from "./catalog-bundles.js";
import { createRequire } from "node:module";
import { planComponentDefaults } from "./catalog-core/component-defaults.js";
import data from "./catalog-bundles.data.json" with { type: "json" };
import starterData from "./rac-starter.data.json" with { type: "json" };
import { sha256 } from "./catalog-core/digest.js";
import { componentDescriptorHash } from "./catalog-core/resolve-components.js";
import { FOUNDRY_COMPONENT_MAP } from "./importers/foundry-components.map.js";

describe("offline catalog candidate bundle", () => {
  it("exposes declared candidates and exact packed-version pointers without qualifying drafts", () => {
    const bundle = loadCatalogBundles();
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
    expect(bundle.package).toEqual({ name: pkg.name, version: pkg.version });
    expect(bundle.valueFills.filter(doc => doc.$extensions["com.clossys.fill"].source === "phosphor")).toHaveLength(40);
    expect(bundle.valueFills.some(doc => doc.$extensions["com.clossys.fill"].slot === "tokens.action-color")).toBe(true);
    expect(bundle.valueFills.some(doc => doc.$extensions["com.clossys.fill"].slot === "assets.image-ratio")).toBe(true);
    const foundry = bundle.componentFills.filter(doc => doc.$extensions["com.clossys.fill"].source === "foundry");
    const foundrySlots = foundry.map(doc => doc.$extensions["com.clossys.fill"].slot);
    expect(foundrySlots.toSorted()).toEqual(Object.keys(FOUNDRY_COMPONENT_MAP).map(leaf => `components.${leaf}`).sort());
    expect(new Set(foundrySlots).size).toBe(foundrySlots.length);
    for (const doc of foundry) {
      const fill = Object.values(doc.components)[0]!;
      expect(fill.pin).toMatchObject({ package: pkg.name, version: pkg.version });
      expect(doc.$extensions["com.clossys.fill"].conforms).toEqual([]);
    }
    // ColorPicker and NumberField reads are source-covered (no K11); Toolbar, TagGroup and Tree pass their measured
    // K5 craft comparison (importers/foundry-craft.json), so none of these offers is blocked.
    for (const slot of ["color-picker", "number-field", "tag-group", "toolbar", "tree"]) expect(Object.values(foundry.find(doc => doc.components[slot])!.components)[0]!.blockers, slot).toBeUndefined();
    expect(bundle.notices.some(file => file.path.endsWith("phosphor/LICENSE"))).toBe(true);
  });

  it("binds every payload document to its actual source bytes", () => {
    for (const file of data.valueFiles) {
      const bytes = readFileSync(resolve(import.meta.dirname, file.path), "utf8");
      expect(sha256(bytes), file.path).toBe(file.sha256);
      expect(JSON.parse(bytes), file.path).toEqual(file.document);
    }
  });

  it("ships pinned upstream, rewritten output and notices while keeping blocked bytes out of adoption bundles", () => {
    const bundle = loadCatalogBundles();
    expect(bundle.sourceCandidates.filter(candidate => candidate.fill.startsWith("shadcn@aria/"))).toHaveLength(26);
    expect(bundle.sourceCandidates.filter(candidate => candidate.fill.startsWith("rac-starter/"))).toHaveLength(7);
    expect(bundle.sourceCandidates.some(candidate => candidate.status === "blocked")).toBe(true);
    expect(bundle.sourceBundles).toHaveLength(bundle.sourceCandidates.filter(candidate => candidate.status === "ready").length);
    for (const candidate of bundle.sourceCandidates) {
      const fill = Object.values(bundle.componentFills.find(doc => doc.$extensions["com.clossys.fill"].id === candidate.fill)!.components)[0]!;
      expect(candidate.descriptorHash).toBe(componentDescriptorHash(fill));
      for (const pin of fill.pin!.files!) expect(sha256(candidate.upstreamFiles.find(file => file.path === pin.path)!.content)).toBe(pin.sha256);
      for (const pin of fill.outputSha256!) expect(sha256(candidate.outputFiles.find(file => file.path === pin.path)!.content)).toBe(pin.sha256);
      // The extensionless Adobe LICENSE remains authenticated in the adapter
      // input; it is not renamed to fit the source materializer's path grammar.
      const license = candidate.fill.startsWith("rac-starter/")
        ? starterData.upstream.find(file => file.path === "LICENSE")!
        : candidate.upstreamFiles.find(file => file.path === "LICENSE.md")!;
      expect(candidate.outputFiles.some(file => file.path === fill.notice && file.content.includes(license.content))).toBe(true);
      const ready = bundle.sourceBundles.filter(item => item.descriptorHash === candidate.descriptorHash);
      expect(ready).toHaveLength(candidate.status === "ready" ? 1 : 0);
      if (candidate.status === "blocked") expect(candidate.blockers.length).toBeGreaterThan(0);
    }
    const changed = loadCatalogBundles();
    changed.sourceCandidates[0]!.outputFiles[0]!.content += "mutation";
    expect(loadCatalogBundles()).toEqual(bundle);
  });

  it("rejects altered pinned source before offering candidates", () => {
    const file = data.shadcn.items.find(item => item.name === "button")!.files[0]!;
    const original = file.content;
    try {
      file.content += "\nmutation";
      expect(() => loadCatalogBundles()).toThrow(/pinned sha256 mismatch/);
    } finally {
      file.content = original;
    }
  });

  it("bundles for an offline browser without Node runtime capabilities", async () => {
    const result = await build({ entryPoints: [resolve(import.meta.dirname, "catalog-bundles.ts")], bundle: true, platform: "browser", format: "iife", globalName: "CatalogBundle", write: false, metafile: true });
    expect(result.outputFiles[0]!.text).toContain("loadCatalogBundles");
    expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
    // css-tree and source-map-js are browser-compatible dependencies. Exercise
    // the complete bundle with Web APIs but no process, require or Buffer.
    const browser = { structuredClone, TextEncoder, TextDecoder };
    runInNewContext(result.outputFiles[0]!.text, browser);
    const bundled = (browser as typeof browser & { CatalogBundle: { loadCatalogBundles: typeof loadCatalogBundles } }).CatalogBundle.loadCatalogBundles();
    expect(bundled).toEqual(loadCatalogBundles());
    const input = { catalog: { values: { slots: [], fills: [], sources: [], standards: [], placements: [], retired: [] }, components: { slots: [], fills: [] } }, library: { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, values: { fills: [] }, components: { fills: [], files: [] } } };
    const closure = runInNewContext(`CatalogBundle.prepareSourceOwnerClosure(JSON.parse(${JSON.stringify(JSON.stringify(input))}))`, browser);
    expect(closure).toEqual(prepareSourceOwnerClosure(input as Parameters<typeof prepareSourceOwnerClosure>[0]));
    expect(closure.runtimeQualification).toBe("unavailable");
  });
  it("exposes the installed headless library version, read from its own package.json rather than typed by hand", async () => {
    const installed = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("react-aria-components/package.json"), "utf8")) as { name: string; version: string };
    expect(installedHeadlessLibrary()).toEqual({ version: installed.version, instance: installed.name });
    expect(installedHeadlessLibrary()).not.toBe(installedHeadlessLibrary());
    expect(planComponentDefaults).toBeTypeOf("function");
    const input: Parameters<typeof planComponentDefaults>[0]["installedRac"] = installedHeadlessLibrary();
    expect(input.instance).toBe("react-aria-components");
    const result = await build({ entryPoints: [resolve(import.meta.dirname, "catalog-bundles.ts")], bundle: true, platform: "browser", format: "iife", globalName: "CatalogBundle", write: false, metafile: true });
    expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
    const browser = { structuredClone, TextEncoder, TextDecoder };
    runInNewContext(result.outputFiles[0]!.text, browser);
    expect(runInNewContext("CatalogBundle.installedHeadlessLibrary()", browser)).toEqual(installedHeadlessLibrary());
  });
});
