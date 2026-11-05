// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { cx } from "../components/internal/cx.js";
import { generateRailAdapters, lowerVariant, utilitySource } from "../../scripts/generate-rail-adapters.mjs";
import slots from "../catalog/slots/components.json" with { type: "json" };
import bindings from "./rail-token-bindings.json" with { type: "json" };
import { emittedTokenProperties } from "../catalog-core/emit.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { loadCatalog, resolve } from "../catalog-core/index.js";
import { adaptRailClasses } from "./rail-classes.js";
import { generateCompiledCss } from "../compiled-css/generate.js";
import * as cssTree from "css-tree";
import { JSDOM } from "jsdom";

const generated = generateRailAdapters();
const javascript = (source: string): string => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;

describe("generated Aria rail adaptation contract", () => {
  it("registers immutable input defaults at real parent slots, and real Writer draft identities", () => {
    expect(JSON.parse(readFileSync(new URL("./vendor/shadcn-aria-rail.adapters.json", import.meta.url), "utf8"))).toEqual(generated);
    const registered = new Set(slots.map(slot => slot.id));
    const rows = generated.files.flatMap(file => file.defaults.map(row => ({ ...row, item: file.item })));
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map(row => `${row.item}.${row.function}.${row.prop}`)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.slots.length).toBeGreaterThan(0);
      for (const slot of row.slots) expect(registered.has(slot)).toBe(true);
      const file = generated.files.find(file => file.item === row.item)!;
      expect(file.content).toContain(`/** @default ${JSON.stringify(row.value)} */`);
    }
    expect(generated.copy.map(row => row.key)).toEqual(["command.title", "command.description", "command.search", "sheet.close", "sidebar.title", "sidebar.description", "sidebar.toggle"]);
    expect(generated.host).toHaveLength(1);
    const host = generated.host[0]!;
    expect(host.consumerImport).toBe('import { mergeUiClasses as cx } from "@clossys/designer/components"');
    expect(createHash("sha256").update(readFileSync(join(import.meta.dirname, "..", host.source))).digest("hex")).toBe(host.sourceSha256);
    expect(readFileSync(join(import.meta.dirname, "../components/index.ts"), "utf8")).toContain('export { cx as mergeUiClasses }');
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8"));
    expect(manifest.exports["./components"].import).toBe("./dist/components/index.js");
  });

  it("lowers every closed upstream variant table with CVA parity, including absent and compound selections", () => {
    let checked = 0;
    for (const row of generated.files.flatMap(file => file.variants)) {
      const actual = new Function("classNames", javascript(lowerVariant(row.name, row.base, row.config)) + `; return ${row.name};`)(clsx);
      const expected = cva(row.base, row.config);
      let selections: object[] = [{}];
      for (const [axis, choices] of Object.entries(row.config.variants)) {
        selections = selections.flatMap(selection => [undefined, null, false, "", ...Object.keys(choices).map(value => value === "true" ? true : value === "false" ? false : value)]
          .map(value => ({ ...selection, [axis]: value })));
      }
      for (const selection of [undefined, null, ...selections.flatMap(selection => [{}, { class: ["extra", { present: true }] }, { className: "px-4 px-8" }, { class: 0, className: false }].map(classes => ({ ...selection, ...classes })))]) {
        expect(actual(selection), `${row.item}.${row.name}: ${JSON.stringify(selection)}`).toBe(expected(selection));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1_000);
  });

  it("reuses the guarded token-aware merge while preserving clsx flattening", () => {
    const source = utilitySource.replace(/^import .*\n|^export \{.*from .*\n/gm, "");
    const helpers = new Function("cx", javascript(source).replace(/^export /gm, "") + "; return { classNames, cn };")(cx);
    for (const values of [["px-md", "px-lg"], [Object.create({ inherited: true })], [false, 0, "", null, undefined, "text-body", "text-ink-primary"], [["px-4", ["px-8"]], { block: true, hidden: false }], ["focus-visible:outline-none", "focus-visible:outline-solid"]]) {
      expect(helpers.classNames(...values)).toBe(clsx(...values));
      expect(helpers.cn(...values)).toBe(cx(clsx(...values)));
    }
    // The imported helper is the existing optional-peer implementation; no copied substitute owns its policy.
    expect(readFileSync(join(import.meta.dirname, "../components/internal/cx.ts"), "utf8")).toContain('await import("tailwind-merge")');
  });


  it("builds and executes the materialized consumer helper through the real public package export", () => {
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { readFileSync, mkdtempSync, mkdirSync } from "node:fs";
      import { resolve, join } from "node:path";
      import { pathToFileURL } from "node:url";
      import { build } from "esbuild";
      const input = JSON.parse(readFileSync(0, "utf8"));
      const files = new Map([["index.ts", input.utility], ["types.ts", input.types], ["copy.ts", input.copy]]);
      mkdirSync("node_modules/.cache", { recursive: true });
      const outfile = resolve(mkdtempSync(join("node_modules/.cache/", "rail-consumer-")), "consumer.mjs");
      const built = await build({ entryPoints: ["index.ts"], outfile, bundle: true, format: "esm", platform: "node", metafile: true, packages: "external", plugins: [{ name: "materialized", setup(builder) {
        builder.onResolve({ filter: /^(?:index|\\.\\/(?:types|copy))$/ }, args => ({ path: args.path === "index.ts" ? args.path : args.path.slice(2) + ".ts", namespace: "materialized" }));
        builder.onResolve({ filter: /^index\\.ts$/ }, () => ({ path: "index.ts", namespace: "materialized" }));
        builder.onLoad({ filter: /.*/, namespace: "materialized" }, args => ({ contents: files.get(args.path), loader: "ts", resolveDir: process.cwd() }));
      } }] });
      const consumer = await import(pathToFileURL(outfile).href);
      const host = await import("@clossys/designer/components");
      const values = ["px-md", "px-lg", { block: true, hidden: false }];
      process.stdout.write(JSON.stringify({ actual: consumer.cn(...values), expected: host.mergeUiClasses("px-md px-lg block"), ref: consumer.RAIL_COPY_REFS["sheet.close"], imports: Object.values(built.metafile.outputs).flatMap(row => row.imports.map(entry => entry.path)) }));
    `], { cwd: join(import.meta.dirname, "../.."), input: JSON.stringify({ utility: generated.utility, types: generated.utilityTypes, copy: generated.copySource }), encoding: "utf8" }));
    expect(result.actual).toBe(result.expected);
    expect(result.ref).toEqual(generated.copy.find(row => row.key === "sheet.close")!.ref);
    expect(result.imports).toEqual(["@clossys/designer/components"]);
  });

  it("binds every utility/variable registration to an actual emitted token member and property", () => {
    const catalog = loadCatalog();
    const library = completedCatalogLibrary(catalog, { id: "rail-map-fixture", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-28");
    const members = new Map(emittedTokenProperties(resolve({ catalog, library })));
    for (const row of bindings.variables) expect(members.get(row.member)?.property, row.member).toBe(row.property);
    for (const row of bindings.utilities) expect(members.has(row.member), row.utility).toBe(true);
  });

  it("lowers single utilities and preserves logical centering and Sheet travel in both directions", async () => {
    expect(adaptRailClasses('"text-left"')).toBe('"text-start"');
    expect(adaptRailClasses('"ml-(--spacing-sm)"')).toBe('"ms-(--spacing-sm)"');
    const centered = adaptRailClasses('"fixed left-1/2 -translate-x-1/2"');
    expect(centered).toContain("start-1/2 ltr:-translate-x-1/2 rtl:translate-x-1/2");
    const sheet = adaptRailClasses('"data-[side=left]:data-entering:-translate-x-(--spacing-2xl) data-[side=right]:data-exiting:translate-x-(--spacing-2xl)"');
    expect(sheet).toContain("data-[side=left]:data-entering:rtl:translate-x-(--spacing-2xl)");
    expect(sheet).toContain("data-[side=right]:data-exiting:rtl:-translate-x-(--spacing-2xl)");
    const motion = adaptRailClasses('"duration-(--ui-duration-fast)"');
    expect(motion).toContain("motion-safe:duration-(--ui-duration-fast)");
    expect(motion).toContain("motion-reduce:duration-0");
    const result = await generateCompiledCss({ stylesDir: join(import.meta.dirname, "../../styles"), candidates: [centered, sheet, motion].flatMap(value => value.slice(1, -1).split(" ")) });
    expect(result.css).toMatch(/inset-inline-start:\s*(?:50%|calc\(1\s*\/\s*2\s*\*\s*100%\))/);
    expect(result.css).toContain("prefers-reduced-motion");
    expect(result.css).toContain("--ui-duration-fast");
  });

  it("compiles sidebar-only ancestry and sibling selectors without orphaned generic group/peer markers", async () => {
    const original = '"group peer group-data-[collapsible=icon]:w-0 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-0"';
    expect(adaptRailClasses(original)).toBe(original);
    const output = adaptRailClasses(original, true);
    expect(output).not.toMatch(/(?:^|[:\s"])(?:group|peer)(?:\s|-data-)/);
    const candidates = output.slice(1, -1).split(" ");
    const ancestor = candidates.find(value => value.includes("collapsible"))!;
    const result = await generateCompiledCss({ stylesDir: join(import.meta.dirname, "../../styles"), candidates });
    const selectors: string[] = [];
    cssTree.walk(cssTree.parse(result.css), node => {
      if (node.type === "Rule" && cssTree.generate(node.prelude).includes("data-collapsible")) selectors.push(cssTree.generate(node.prelude));
    });
    const dom = new JSDOM('<div data-slot="sidebar" data-collapsible="icon"><span></span></div>');
    const child = dom.window.document.querySelector("span")!;
    child.className = ancestor;
    expect(selectors.some(selector => child.matches(selector))).toBe(true);
    child.parentElement!.setAttribute("data-slot", "another-owner");
    expect(selectors.some(selector => child.matches(selector))).toBe(false);
    expect(result.css).toContain("data-variant=inset");
    expect(result.css).toContain("data-state=collapsed");
  });
});
