import { expect, it } from "vitest";
import { collectSourceClosure } from "../../../designer/src/components/source-closure.js";
import { importFoundryComponents, loadComponentRegistry } from "../../../designer/src/catalog-core/index.js";
import { applyComponentLibraryChange } from "../../../designer/src/catalog-core/changeset-components.js";
import { componentLibraryHash } from "../../../designer/src/catalog-core/resolve-components.js";
import type { CompositeLibraryData } from "../../../designer/src/catalog-core/types.js";
import { analyzeAppLocalSource, appLocalSourceResolver, printAppLocalSource } from "./source.js";

const empty = (): CompositeLibraryData => ({
  source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" },
  values: { fills: [] }, components: { fills: [], files: [] },
});

function selectedButton(): CompositeLibraryData {
  const library = empty();
  const catalog = { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills };
  const components = { source: library.source, adoptedAt: "2026-10-29", ...library.components };
  library.components = applyComponentLibraryChange(catalog, components, {
    baseHash: componentLibraryHash(components), changes: [
      { op: "adopt", slot: "components.button", source: "foundry" },
      { op: "adopt", slot: "components.icon", source: "foundry" },
    ],
  });
  return library;
}

function collectRanges(ranges: readonly string[]) {
  return collectSourceClosure({
    library: empty(),
    additionalEntries: [{ path: "entry.ts", content: ranges.map((_, index) => `import "range-${index}";`).join("\n") }],
    analyze: analyzeAppLocalSource,
    resolve: request => ({ kind: "dependency", name: "example-runtime", version: ranges[Number(request.specifier.slice("range-".length))]! }),
  });
}

function collectSelected(library: CompositeLibraryData, name: string, appRange: string, directAppImport = true) {
  return collectSourceClosure({
    library,
    additionalEntries: [{ path: "entry.ts", content: `${directAppImport ? `import ${JSON.stringify(name)};` : ""} export { Button } from "@clossys/designer/components";` }],
    analyze: analyzeAppLocalSource,
    resolve: appLocalSourceResolver(library, process.cwd(), { react: ">=18", [name]: appRange }),
    transformSource: printAppLocalSource,
  });
}

it.each([
  ["exact", ["1.2.3", "1.2.3"], "1.2.3"],
  ["caret", ["^1.2.3", "1.8.0"], "1.8.0"],
  ["tilde", ["~1.2.3", "1.2.9"], "1.2.9"],
  ["comparators", [">=1.2.3 <2.0.0", "1.8.0"], "1.8.0"],
  ["OR", ["^1.0.0 || ^3.0.0", "3.4.5"], "3.4.5"],
  ["overlapping ranges", ["^1.2.0", "~1.8.0"], "~1.8.0"],
  ["zero-major caret", ["^0.2.3", "0.2.9"], "0.2.9"],
  ["zero-minor caret", ["^0.0.3", "0.0.3"], "0.0.3"],
  ["partial comparator", [">=18", "19.3.0"], "19.3.0"],
  ["explicit prerelease", [">=1.2.3-alpha.1 <1.2.3", "1.2.3-alpha.4"], "1.2.3-alpha.4"],
  ["release common to differently prerelease-gated ranges", [">=19.0.0-rc.1", "<20.0.0", "19.0.0"], "19.0.0"],
  ["wildcard", ["1.2.x", "1.2.9"], "1.2.9"],
  ["partial caret", ["^1.2", "1.8.0"], "1.8.0"],
  ["hyphen", ["1.2.0 - 1.8.0", "1.5.0"], "1.5.0"],
  ["build metadata", ["^1.2.0", "1.2.3+build.7"], "1.2.3+build.7"],
  ["numeric prerelease ordering", [">=1.2.3-alpha.2 <1.2.3-alpha.10", "1.2.3-alpha.9"], "1.2.3-alpha.9"],
  ["strict prerelease interval", [">1.2.3-alpha.1 <1.2.3-alpha.2", "1.2.3-alpha.1.0"], "1.2.3-alpha.1.0"],
] as const)("collects dependency constraints with a common semver version: %s", (_label, ranges, expected) => {
  for (const order of [ranges, [...ranges].reverse()]) {
    expect(collectRanges(order).dependencies["example-runtime"]).toBe(expected);
  }
});

it("emits the intersection when two compatible ranges contain neither other", () => {
  const ranges = [">=1.2.0 <1.5.0", ">=1.4.0 <2.0.0"];
  for (const order of [ranges, [...ranges].reverse()]) {
    const emitted = collectRanges(order).dependencies["example-runtime"]!;
    expect(emitted).toBe(">=1.4.0 <1.5.0");
  }
});

it.each([
  ["incompatible major", ["^1.2.3", "2.0.0"]],
  ["disjoint minor", ["~1.2.3", "1.3.0"]],
  ["zero-major boundary", ["^0.2.3", "0.3.0"]],
  ["zero-minor boundary", ["^0.0.3", "0.0.4"]],
  ["exclusive comparator", [">1.2.3 <1.2.5", "1.2.3"]],
  ["OR branches", ["^1.0.0 || ^3.0.0", "2.5.0"]],
  ["implicit prerelease", ["^1.2.3", "1.3.0-beta.1"]],
  ["different prerelease tuple", ["^1.2.3-alpha.1", "1.3.0-alpha.1"]],
  ["strict prerelease boundary", [">1.2.3-alpha.1 <1.2.3-alpha.2", "1.2.3-alpha.1"]],
  ["prerelease permission must hold for every original range", [">=19.0.0-rc.1", "<20.0.0", "19.0.0-rc.2"]],
  ["pairwise overlap without one common version", ["1.0.0 || 2.0.0", "2.0.0 || 3.0.0", "1.0.0 || 3.0.0"]],
] as const)("refuses dependency constraints without a common semver version: %s", (_label, ranges) => {
  expect(() => collectRanges(ranges)).toThrow(/range|dependency|version/i);
});

it.each(["latest", "unknown", "1.2.invalid", "^01.2.3", "^1.2.3 || nonsense", "workspace:*", "file:../runtime"])(
  "fails closed on an invalid or unsupported dependency range: %s", range => {
    expect(() => collectRanges([range])).toThrow(/range|dependency|version/i);
    expect(() => collectRanges([range, range])).toThrow(/range|dependency|version/i);
  },
);

it.each([
  ["react", "19.3.0"],
  ["react-aria-components", "1.21.1"],
  ["tailwind-merge", "3.7.0"],
  ["tailwind-merge", "^3.7.0"],
])("collects real selected sources with compatible app and package ranges for %s at %s", (name, version) => {
  const library = selectedButton(), before = structuredClone(library);
  for (const directAppImport of [true, false]) {
    const result = collectSelected(library, name, version, directAppImport);
    expect(result.dependencies[name]).toBe(version);
    expect(result.files.some(file => /\/Button(?:-[a-f0-9]+)?\.tsx$/.test(file.path))).toBe(true);
    expect(result.files.some(file => /\/Icon(?:-[a-f0-9]+)?\.tsx$/.test(file.path))).toBe(true);
    expect(result.files.some(file => /\/(?:Dialog|Menu|Table)(?:-[a-f0-9]+)?\.tsx$/.test(file.path))).toBe(false);
  }
  expect(library).toEqual(before);
});

it.each([
  ["react", "17.0.2"],
  ["react-aria-components", "2.0.0"],
  ["tailwind-merge", "2.6.0"],
])("refuses incompatible app and real selected package requirements for %s", (name, version) => {
  for (const directAppImport of [true, false]) {
    expect(() => collectSelected(selectedButton(), name, version, directAppImport)).toThrow(/range|dependency|version/i);
  }
});

it("keeps selected-library and adopted-descriptor guards before range matching", () => {
  const unselected = selectedButton();
  unselected.components.fills = unselected.components.fills.filter(document => !document.components.icon);
  expect(() => collectSelected(unselected, "react", "19.3.0")).toThrow(/selected/i);
  const changed = selectedButton();
  changed.components.fills.find(document => document.components.button)!.components.button!.root = "ChangedButton";
  expect(() => collectSelected(changed, "react", "19.3.0")).toThrow(/descriptor|hash/i);
});
