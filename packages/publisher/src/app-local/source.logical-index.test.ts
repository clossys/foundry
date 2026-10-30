import { expect, it } from "vitest";
import { collectSourceClosure } from "../../../designer/src/components/source-closure.js";
import { importFoundryComponents, loadComponentRegistry } from "../../../designer/src/catalog-core/index.js";
import { applyComponentLibraryChange } from "../../../designer/src/catalog-core/changeset-components.js";
import { componentLibraryHash } from "../../../designer/src/catalog-core/resolve-components.js";
import type { CompositeLibraryData } from "../../../designer/src/catalog-core/types.js";
import { analyzeAppLocalSource, appLocalSourceResolver, printAppLocalSource } from "./source.js";

function selectedIcon(): CompositeLibraryData {
  const library: CompositeLibraryData = { source: { id: "logical-index-consumer", kind: "consumer", author: "consumer", license: "MIT" }, values: { fills: [] }, components: { fills: [], files: [] } };
  const components = { source: library.source, adoptedAt: "2026-10-29", ...library.components };
  library.components = applyComponentLibraryChange({ slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills }, components, {
    baseHash: componentLibraryHash(components), changes: [{ op: "adopt", slot: "components.icon", source: "foundry" }],
  });
  return library;
}

it("does not let a relative logical index select an unselected component", () => {
  const resolve = appLocalSourceResolver(selectedIcon(), process.cwd(), {});
  expect(() => resolve({ specifier: "../button/index", importer: { path: "components/sheet/sheet.tsx", content: "" }, names: ["Button"], files: new Map() })).toThrow(/selected/i);
});

it("does not turn private paths or undeclared names into selected component exports", () => {
  const resolve = appLocalSourceResolver(selectedIcon(), process.cwd(), {});
  const importer = { path: "components/sheet/sheet.tsx", content: "" };
  expect(() => resolve({ specifier: "../icon/private", importer, names: ["Icon"], files: new Map() })).toThrow(/missing source/i);
  expect(() => resolve({ specifier: "../icon/index", importer, names: ["UndeclaredGlyph"], files: new Map() })).toThrow(/export/i);
});

it.each(['import "./components/icon/index";', 'export * as icons from "./components/icon/index";'])("keeps logical-index side-effect and namespace closure limited to the selected leaf: %s", content => {
  const library = selectedIcon(), before = structuredClone(library);
  const closure = collectSourceClosure({ library, additionalEntries: [{ path: "probe.ts", content }], analyze: analyzeAppLocalSource, resolve: appLocalSourceResolver(library, process.cwd(), {}), transformSource: printAppLocalSource });
  expect(closure.files.some(file => /\/Icon(?:-[a-f0-9]+)?\.tsx$/.test(file.path))).toBe(true);
  expect(closure.files.some(file => /\/(?:Button|Dialog|Menu|Table)(?:-[a-f0-9]+)?\.tsx$/.test(file.path))).toBe(false);
  expect(library).toEqual(before);
});
