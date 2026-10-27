// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import data from "../rac-starter.data.json" with { type: "json" };
import { importRacStarter, generatedRacStarterFiles, RAC_STARTER_PIN, type RacStarterInput } from "./rac-starter.js";
import { materializeSourceFill } from "../catalog-core/changeset-components.js";
import { componentOf } from "../catalog-core/resolve-components.js";
import { build } from "esbuild";
import { cva } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

const input = (): RacStarterInput => structuredClone(data) as RacStarterInput;
describe("authenticated Adobe starter declarations", () => {
  it("binds seven existing leaves to the exact locked RAC release source without conformance claims", () => {
    const result = importRacStarter(input());
    expect(RAC_STARTER_PIN.commit).toBe("4dd44e0f400636a87a9ad4390903e78c5ae6113c");
    expect(result.fills.map(doc => doc.$extensions["com.clossys.fill"].slot)).toEqual([
      "components.color-picker", "components.form", "components.navigation-tree", "components.number-field",
      "components.tag-group", "components.toolbar", "components.tree",
    ]);
    for (const doc of result.fills) {
      expect(doc.$extensions["com.clossys.fill"].conforms).toEqual([]);
      expect(componentOf(doc).license).toBe("Apache-2.0");
      const candidate = result.candidates.find(row => row.slot === componentOf(doc).slot)!;
      expect(candidate.outputFiles.find(file => file.path === componentOf(doc).notice)!.content)
        .toBe(input().upstream.find(file => file.path === "LICENSE")!.content);
    }
    expect(result.upstreamNotice).toBe("absent-at-pinned-commit");
  });
  it("refuses changed source, licence, package metadata, foreign commits and omitted closure bytes", () => {
    for (const path of ["starters/tailwind/src/Form.tsx", "LICENSE", "starters/tailwind/package.json"]) {
      const changed = input(); changed.upstream.find(file => file.path === path)!.content += " ";
      expect(() => importRacStarter(changed)).toThrow(/pinned source/);
    }
    const foreign = input(); foreign.commit = "0".repeat(40);
    expect(() => importRacStarter(foreign)).toThrow(/commit/);
    const omitted = input(); omitted.upstream = omitted.upstream.filter(file => !file.path.endsWith("/ColorThumb.tsx"));
    expect(() => importRacStarter(omitted)).toThrow(/pinned source/);
    const metadata = input(); metadata.dependencies[0]!.version = "0.0.0";
    expect(() => importRacStarter(metadata)).toThrow(/declaration/);
    const closure = input(); closure.closures.form = ["starters/tailwind/src/Form.tsx"];
    expect(() => importRacStarter(closure)).toThrow(/declaration/);
    const missingLeaf = input(); delete missingLeaf.entries.tree;
    expect(() => importRacStarter(missingLeaf)).toThrow(/declaration/);
  });
  it("keeps upstream/output hashes distinct and reproduces all stored declaration bytes", () => {
    const generated = generatedRacStarterFiles(input());
    // Explicit local regeneration writes only this generator's enumerated fill files.
    if (process.env.UPDATE_RAC_STARTER_FILLS === "1") for (const [name, bytes] of Object.entries(generated)) writeFileSync(resolve(import.meta.dirname, "../catalog/fills/rac-starter", name), bytes);
    for (const [name, bytes] of Object.entries(generated)) {
      expect(readFileSync(resolve(import.meta.dirname, "../catalog/fills/rac-starter", name), "utf8")).toBe(bytes);
    }
    const result = importRacStarter(input());
    const form = componentOf(result.fills.find(doc => doc.components.form)!);
    expect(form.outputSha256!.find(file => file.path.endsWith("/Form.tsx"))!.sha256)
      .not.toBe(form.pin!.files!.find(file => file.path.endsWith("/Form.tsx"))!.sha256);
  });
  it("preserves supported compound clauses while retaining unbound source utilities", () => {
    const result = importRacStarter(input());
    const tags = result.candidates.find(row => row.slot === "components.tag-group")!;
    expect(tags.blockers.some(issue => issue.code === "K9" && issue.message.includes("compound"))).toBe(false);
    expect(tags.outputFiles.find(file => file.path.endsWith("/TagGroup.tsx"))!.content).toContain("compoundVariants:");
    for (const row of result.candidates) {
      expect(row.outputFiles.some(file => /from\s*["'](?:tailwind-variants|lucide-react)["']/.test(file.content))).toBe(false);
    }
    expect(result.candidates.some(row => row.blockers.some(issue => issue.code === "K4"))).toBe(true);
  });
  it("preserves the supported base/variant/extend truth table and refuses default/slot reinterpretation", async () => {
    const file = importRacStarter(input()).candidates.find(row => row.slot === "components.toolbar")!.outputFiles
      .find(file => file.path === "components/_parts/rac-starter-variants/index.ts")!;
    const compiled = await build({ stdin: { contents: file.content, loader: "ts", resolveDir: process.env.FOUNDRY_TEST_DEPENDENCIES ?? process.cwd() }, bundle: true, format: "esm", platform: "node", write: false });
    const { starterVariants } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0]!.text).toString("base64")}`);
    const focus = { base: "outline outline-offset-2", variants: { isFocusVisible: { true: "outline-2", false: "outline-0" } } };
    const toolbar = { base: "flex gap-2", variants: { orientation: { horizontal: "flex-row", vertical: "flex-col" } } };
    const actual = starterVariants({ ...toolbar, extend: starterVariants(focus) });
    for (const isFocusVisible of [true, false]) for (const orientation of ["horizontal", "vertical"] as const) {
      const selection = { isFocusVisible, orientation };
      expect(actual(selection)).toBe(twMerge(cva(focus.base, { variants: focus.variants })(selection), cva(toolbar.base, { variants: toolbar.variants })(selection)));
    }
    for (const unsupported of [{ defaultVariants: {} }, { slots: {} }]) expect(() => starterVariants(unsupported)).toThrow(/Unsupported starter style semantics/);
    expect(() => starterVariants({ variants: focus.variants, extend: starterVariants(focus) })).toThrow(/variant override/);
  });
  it("preserves explicit compound booleans, absent state and caller precedence with the locked CVA API", async () => {
    const file = importRacStarter(input()).candidates.find(row => row.slot === "components.tag-group")!.outputFiles
      .find(file => file.path === "components/_parts/rac-starter-variants/index.ts")!;
    const compiled = await build({ stdin: { contents: file.content, loader: "ts", resolveDir: process.env.FOUNDRY_TEST_DEPENDENCIES ?? process.cwd() }, bundle: true, format: "esm", platform: "node", write: false });
    const { starterVariants } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0]!.text).toString("base64")}`);
    const colors = ["gray", "green", "yellow", "blue"];
    const definition = {
      extend: starterVariants({ base: "focus-root", variants: { isFocusVisible: { true: "focus-on", false: "focus-off" } } }),
      base: "tag",
      variants: { color: Object.fromEntries(colors.map(color => [color, ""])), isSelected: { true: "selected" }, isDisabled: { true: "disabled" } },
      compoundVariants: colors.map(color => ({ isSelected: false, isDisabled: false, color, class: "color-" + color })),
    };
    const styles = starterVariants(definition);
    for (const color of colors) for (const isSelected of [undefined, false, true]) for (const isDisabled of [undefined, false, true]) {
      const actual = styles({ color, isSelected, isDisabled, isFocusVisible: true, className: "caller" });
      expect(actual).toBe(["focus-root focus-on tag", isSelected === true ? "selected" : "", isDisabled === true ? "disabled" : "", isSelected === false && isDisabled === false ? "color-" + color : "", "caller"].filter(Boolean).join(" "));
    }
    expect(starterVariants({ ...definition, compoundVariants: [{ color: "gray", className: "named" }] })({ color: "gray" })).toContain("named");
    for (const compoundVariants of [[{ color: ["gray", "green"], class: "colors" }], [{ unknown: true, class: "unknown" }], [{ color: "gray", class: () => "dynamic" }]]) {
      expect(() => starterVariants({ ...definition, compoundVariants })).toThrow(/Unsupported starter compound/);
    }
  });
  it("uses the real source materializer and refuses tampered ready output", async () => {
    const result = importRacStarter(input());
    const doc = result.fills.find(doc => doc.components.form)!;
    const fill = componentOf(doc);
    expect(fill.blockers).toEqual([]);
    const fetch = async (pin: { path: string }) => input().upstream.find(file => file.path === pin.path)!.content;
    const bundle = await materializeSourceFill(fill, fetch, [result.transform]);
    expect(bundle.files.length).toBeGreaterThan(0);
    await expect(materializeSourceFill(fill, fetch, [{ id: result.transform.id, run: () => ({ files: bundle.files.map(file => ({ ...file, content: file.content + " " })), blockers: [] }) }]))
      .rejects.toThrow(/output hash/);
  });
});
