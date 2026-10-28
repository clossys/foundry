/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { expect, it } from "vitest";
import { emitComponents } from "../catalog-core/emit-components.js";
import type { ResolvedComponents } from "../catalog-core/resolve-components.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { glyphs } from "../components/preview-runtime/adapters/glyphs.js";
import profile from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };

it("ships exactly the existing emitter's approved default graph with only local ESM relocation", () => {
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
    expect(readFileSync(path, "utf8"), file.path).toBe(content);
  }
  const bundles = loadCatalogBundles();
  for (const component of Object.values(profile.components)) {
    if (component.origin.kind !== "adopted" || component.impl.kind !== "source") continue;
    const candidate = bundles.componentFills.flatMap(doc => Object.values(doc.components)).find(row => row.slot === component.slot && row.source === component.origin.source)!;
    expect(candidate.pin, component.slot).toEqual(component.origin.pin);
    expect(candidate.outputSha256, component.slot).toEqual(component.descriptor.outputSha256);
  }
});
