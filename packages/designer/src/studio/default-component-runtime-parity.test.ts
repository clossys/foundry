/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { expect, it } from "vitest";
import { emitComponents } from "../catalog-core/emit-components.js";
import type { ResolvedComponents } from "../catalog-core/resolve-components.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { glyphs } from "../components/preview-runtime/adapters/glyphs.js";
import profile from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };

/** Approved finish adaptations; all other emitted implementation bytes remain exact. */
function previewSource(content: string, path: string): string {
  const logical: Record<string,string> = { "left-":"start-", "right-":"end-", "ml-":"ms-", "mr-":"me-", "pl-":"ps-", "pr-":"pe-", "border-l-":"border-s-", "border-r-":"border-e-", "rounded-l-":"rounded-s-", "rounded-r-":"rounded-e-", "text-left":"text-start", "text-right":"text-end" };
  let source = content.replace(/(?<![\w-])(?:-?(?:left|right)-|[mp][lr]-|border-[lr]-|rounded-[lr]-|text-(?:left|right)(?![\w-]))/g, token => {
    const negative=token.startsWith("-");
    return (negative ? "-" : "") + logical[negative ? token.slice(1) : token];
  }).replaceAll("max-w-xs","max-w-[20rem]").replaceAll("max-w-sm","max-w-[24rem]");
  if (path.endsWith("/dialog.tsx") || path.endsWith("/radio-group.tsx")) source = source.replaceAll("-translate-x-1/2 ","-translate-x-1/2 rtl:translate-x-1/2 ");
  return source;
}

it("ships the canonical graph with only approved ESM, logical-class and width adaptations", () => {
  const root = resolve(import.meta.dirname, "..");
  const target = resolve(root, "components/preview-runtime");
  const emitted = emitComponents(profile as ResolvedComponents, ["component-index"], { glyphModule: { path: "adapters/glyphs.ts", glyphs } });
  const files = new Map(emitted.map(file => [file.path, file]));
  const retained = new Set<string>();
  const visit = (path: string) => {
    if (retained.has(path)) return;
    retained.add(path);
    for (const match of files.get(path)!.content.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
      const base = posix.normalize(posix.join(posix.dirname(path), match[1]!));
      const dependency = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(key => files.has(key));
      expect(dependency, `${path} -> ${base}`).toBeDefined();
      visit(dependency!);
    }
  };
  for (const component of Object.values(profile.components)) if (component.impl.kind === "source") visit(component.impl.entry!);
  retained.add("adapters/glyphs.ts");
  for (const file of emitted) if (file.path.startsWith("notices/")) retained.add(file.path);
  for (const file of emitted) {
    if (!retained.has(file.path)) {
      // A46 forbids file deletion: source-only pruning leaves non-executing private modules.
      expect(readFileSync(`${target}/${file.path}`, "utf8"), file.path).toBe("// Consumer-only adapter omitted from the private preview dependency closure.\nexport {};\n");
      continue;
    }
    const path = `${target}/${file.path}`;
    const content = /\.[cm]?tsx?$/.test(file.path) ? file.content.replace(/((?:from\s*|import\s*)["'])([^"']+)(["'])/g, (_all, before: string, original: string, after: string) => {
      let specifier = original;
      if (specifier.startsWith("@clossys/designer/")) {
        specifier = posix.relative(posix.dirname(path), `${root}/${specifier.slice("@clossys/designer/".length)}/index.js`);
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
      } else if (specifier.startsWith(".") && !/\.(?:js|json|mjs)$/.test(specifier)) specifier += ".js";
      return before + specifier + after;
    }) : file.content;
    expect(readFileSync(path, "utf8"), file.path).toBe(previewSource(content,file.path));
  }
  const bundles = loadCatalogBundles();
  for (const component of Object.values(profile.components)) {
    if (component.origin.kind !== "adopted" || component.impl.kind !== "source") continue;
    const candidate = bundles.componentFills.flatMap(doc => Object.values(doc.components)).find(row => row.slot === component.slot && row.source === component.origin.source)!;
    expect(candidate.pin, component.slot).toEqual(component.origin.pin);
    expect(candidate.outputSha256, component.slot).toEqual(component.descriptor.outputSha256);
  }
});

it("uses logical classes throughout the compiled preview closure", async () => {
  const { readdirSync } = await import("node:fs");
  const root = resolve(import.meta.dirname, "../components/preview-runtime");
  const files = readdirSync(root, { recursive: true }).filter(path => path.endsWith(".tsx"));
  const physical = /(?<![\w-])(?:-?(?:left|right)-|[mp][lr]-|border-[lr]-|rounded-[lr]-|text-(?:left|right)(?![\w-]))/g;
  const findings = files.flatMap(path => [...readFileSync(resolve(root,path), "utf8").matchAll(physical)].map(match => `${path}: ${match[0]}`));
  expect(findings).toEqual([]);
});

it("preserves the exact upstream container widths without spacing-token collisions", () => {
  const root = resolve(import.meta.dirname, "../components/preview-runtime/components");
  expect(readFileSync(resolve(root,"tooltip/tooltip.tsx"),"utf8")).toContain("max-w-[20rem]");
  expect(readFileSync(resolve(root,"dialog/dialog.tsx"),"utf8")).toContain("sm:max-w-[24rem]");
});

it("keeps explicitly centred overlays and radio indicators centred in RTL", () => {
  for (const path of ["dialog/dialog.tsx", "radio-group/radio-group.tsx"]) {
    const source=readFileSync(resolve(import.meta.dirname,"../components/preview-runtime/components",path),"utf8");
    expect(source).toContain("start-1/2");
    expect(source).toContain("rtl:translate-x-1/2");
  }
});
