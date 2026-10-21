import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("compiled UsageMeter public contract", () => {
  it.each(["index.js", "blocks/index.js", "blocks/server.js"])("exports UsageMeter and its declared props from %s", entry => {
    const script = `import {UsageMeter} from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(typeof UsageMeter);`;
    expect(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" })).toBe("function");
    const filename = join(packageRoot, "usage-meter-consumer.check.ts");
    const consumer = `import {UsageMeter, type UsageMeterProps, type UsageMeterThreshold} from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const threshold: UsageMeterThreshold = {at: 0.8, tone: "warning", message: "Check usage"};
      const props: UsageMeterProps = {label: "API requests", used: 8, limit: 10, usedText: "8 requests", limitText: "of 10", periodText: "This period", thresholds: [threshold], size: "compact"};
      UsageMeter(props);`;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  });
});

describe("compiled signature chart public contract", () => {
  it.each(["index", "server"])("exports all three charts from the compiled charts/%s entry", async entry => {
    const exports = await import(pathToFileURL(join(packageRoot, `dist/charts/${entry}.js`)).href);
    for (const name of ["AreaChart", "Heatmap", "StatusStrip"]) expect(exports[name]).toBeTypeOf("function");
  });
});

describe("compiled table-model public contract", () => {
  const values = ["TableModelError", "aggregate", "filterRows", "groupRows", "parseTableModel", "pivotRows", "serializeTableModel"];

  it("exports the headless engine from the existing blocks and internal barrels", () => {
    for (const entry of ["blocks/index.js", "index.js"]) {
      const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(JSON.stringify(Object.keys(api).filter(name => ${JSON.stringify(values)}.includes(name)).sort()));`;
      const exported = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }));
      expect(exported).toEqual(values);
    }
  });

  it("keeps the emitted engine import graph within its pure local module directory", () => {
    const root = join(packageRoot, "dist/blocks/table-model");
    const visit = (file: string, seen = new Set<string>()) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\b(?:process|document|window|fetch|XMLHttpRequest)\b|\bimport\s*\(/);
      for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        expect(match[1]).toMatch(/^\.\/[^/]+\.js$/);
        visit(join(root, match[1]!), seen);
      }
    };
    visit(join(root, "index.js"));
    const script = `import { aggregate } from ${JSON.stringify(join(root, "index.js"))}; process.stdout.write(JSON.stringify(aggregate([{value: 7}], {version: 1, columns: [{id: "value", kind: "number"}], collation: {locale: "en"}, measures: [{id: "sum", op: "sum", column: "value"}]})));`;
    expect(JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8" }))).toEqual({ sum: 7 });
  });

  it("resolves saved-view and output types from real emitted declarations", () => {
    const filename = join(packageRoot, "emitted-table-model-consumer.check.ts");
    const consumer = ["blocks/index.js", "index.js"].map((entry, index) => `
      import { filterRows as filter${index}, groupRows as group${index}, pivotRows as pivot${index}, aggregate as aggregate${index}, serializeTableModel as serialize${index}, parseTableModel as parse${index}, TableModelError as Error${index}, type TableModel as Model${index}, type TableFilterResult as Filter${index}, type TableGroup as Group${index}, type TablePivotResult as Pivot${index}, type TableAggregates as Aggregates${index}, type TableModelErrorCode as Code${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const model${index}: Model${index} = {version: 1, columns: [{id: "value", kind: "number"}], collation: {locale: "en"}, measures: [{id: "sum", op: "sum", column: "value"}], groupBy: [{column: "value"}], pivot: {rows: [{column: "value"}], columns: []}};
      const rows${index} = [{value: 7}];
      const result${index}: Filter${index}<{value: number}> = filter${index}(rows${index}, model${index});
      const groups${index}: readonly Group${index}<{value: number}>[] = group${index}(rows${index}, model${index});
      const pivoted${index}: Pivot${index} = pivot${index}(rows${index}, model${index});
      const totals${index}: Aggregates${index} = aggregate${index}(rows${index}, parse${index}(serialize${index}(model${index})));
      const code${index}: Code${index} = new Error${index}("invalid-model", "Invalid saved view").code;
    `).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  }, 30_000);
});

describe("graph-model public contract", () => {
  it("registers the pure graph runtime exports in the blocks entry", async () => {
    const model = await import("./blocks/graph-model/index.js");
    const blocks = await import("./blocks/index.js");
    const names = Object.keys(model);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(blocks[name as keyof typeof blocks], name).toBe(model[name as keyof typeof model]);
  });
});

describe("compiled atom guidance public contract", () => {
  it("intentionally exports the four atom metadata records from the existing client atoms barrel", () => {
    const entry = join(packageRoot, "dist/atoms/index.js");
    const script = `import * as atoms from ${JSON.stringify(entry)}; process.stdout.write(JSON.stringify(Object.keys(atoms).filter(key => /^ATOM_/.test(key)).sort()));`;
    const keys = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }));
    expect(keys).toEqual(["ATOM_API_FACTS", "ATOM_COMPARISON", "ATOM_DISPLAY_GROUPS", "ATOM_GUIDANCE"]);
  });
  it("pins compiled comparison keys to the finite public API facts", () => {
    const entry = join(packageRoot, "dist/atoms/index.js");
    const script = `
      import { ATOM_COMPARISON, ATOM_API_FACTS } from ${JSON.stringify(entry)};
      process.stdout.write(JSON.stringify({
        actual: Object.keys(ATOM_COMPARISON).sort(),
        expected: Object.entries(ATOM_API_FACTS).filter(([, fact]) => fact.options.length > 0).map(([id]) => id).sort()
      }));
    `;
    const keys = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }));
    expect(keys.actual.length).toBeGreaterThan(0);
    expect(keys.actual).toEqual(keys.expected);
  });

  it("exports the compiled AtomComparison type through the existing atoms subpath", () => {
    const filename = join(packageRoot, "atom-comparison-consumer.check.ts");
    const consumer = `
      import { ATOM_COMPARISON, type AtomComparison } from ${JSON.stringify(join(packageRoot, "dist/atoms/index.js"))};
      const comparison: AtomComparison = ATOM_COMPARISON["act.button"];
      const column: string = comparison.columns.option;
      const policy: "skip-violations" = comparison.constraintPolicy;
      const cap: number = comparison.maxCells;
    `;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename
      ? ts.createSourceFile(path, consumer, language, true)
      : original(path, language, error, fresh);
    const program = ts.createProgram([filename], options, host);
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  });
});
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

const JS_SUBPATHS = [
  "./tokens",
  "./tokens/server",
  "./tokens/preview",
  "./atoms",
  "./atoms/server",
  "./icons",
  "./charts",
  "./charts/server",
  "./blocks",
  "./blocks/server",
  "./shell",
  "./shell/server",
  "./theme",
  "./theme/server",
  "./gate",
  "./render-environment",
] as const;
const CSS_SUBPATHS = ["./tokens.css", "./theme.css", "./theme-keys.css", "./utilities.css", "./compiled.css", "./brand-template.css"] as const;
const COMPONENT_DIRS = ["atoms", "blocks", "charts", "shell", "theme"] as const;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(?:ts|tsx)$/.test(entry) && !entry.includes(".test.")) out.push(path);
  }
  return out;
}

describe("public UI contract", () => {
  it("exports only intentional token, visual, and gate subpaths — never a root barrel or views", () => {
    expect(Object.keys(packageJson.exports)).toEqual([
      ...JS_SUBPATHS.slice(0, 3),
      ...CSS_SUBPATHS,
      ...JS_SUBPATHS.slice(3),
    ]);
    expect(packageJson.exports["."]).toBeUndefined();
    expect(packageJson.exports["./views"]).toBeUndefined();

    for (const subpath of JS_SUBPATHS) {
      const entry = packageJson.exports[subpath] as { types?: string; import?: string };
      expect(entry.types, `${subpath} needs public types`).toMatch(/^\.\/dist\/.+\.d\.ts$/);
      expect(entry.import, `${subpath} needs an ESM entry`).toMatch(/^\.\/dist\/.+\.js$/);
    }

    for (const subpath of CSS_SUBPATHS) {
      const entry = packageJson.exports[subpath];
      expect(entry, `${subpath} needs a CSS entry`).toMatch(/^\.\/styles\/.+\.css$/);
      expect(existsSync(join(packageRoot, entry as string))).toBe(true);
    }
  });

  it("keeps token-only use free of component runtime installation", () => {
    expect(packageJson.dependencies).toBeUndefined();

    for (const dependency of ["@internationalized/date", "react", "react-dom", "react-aria-components", "tailwind-merge", "tailwindcss"]) {
      expect(packageJson.peerDependencies[dependency]).toBeDefined();
      expect(packageJson.peerDependenciesMeta[dependency]?.optional).toBe(true);
    }
  });

  it("keeps the CSS contract ordered: primitives, optional Tailwind wiring, then consumer brand overrides", () => {
    const tokens = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");
    const theme = readFileSync(join(packageRoot, "styles", "theme.css"), "utf8");
    const brand = readFileSync(join(packageRoot, "styles", "brand-template.css"), "utf8");

    expect(tokens).toContain(":root {");
    expect(theme).toContain('@import "./tokens.css";');
    expect(theme).toContain('@import "./theme-keys.css";');
    expect(existsSync(join(packageRoot, "styles", "theme-keys.css"))).toBe(true);
    expect(brand).toContain('@import "@clossys/designer/tokens.css";');
    expect(brand).toContain(":root[data-brand-bound]");
    expect(tokens).toContain(':root[data-theme="dark"]');
  });

  it("does not retain page-level views or reverse runtime dependencies on product packages", () => {
    expect(existsSync(join(packageRoot, "src", "views"))).toBe(false);

    const forbidden = /from\s+["']@clossys\/(?:copy|strategy|surface)(?:\/|["'])/;
    const violations = COMPONENT_DIRS.flatMap((dir) =>
      sourceFiles(join(packageRoot, "src", dir))
        .filter((file) => forbidden.test(readFileSync(file, "utf8")))
        .map((file) => file.slice(packageRoot.length + 1)),
    );
    expect(violations).toEqual([]);
  });

  it("honors reduced-motion preferences for every shipped animation or transition", () => {
    // Scanned, not hand-listed: a hand-written file list can't notice a new
    // motion site (see the package README and #907 — this is that
    // mechanism). Every source file under the component layer directories
    // is checked for a Tailwind `animate-*`/`transition-*` class literal;
    // any file that has one must also carry a `motion-reduce:` override.
    const MOTION_CLASS_RE = /\b(?:animate|transition)-[a-zA-Z[\]-]+/;

    const motionFiles = [...COMPONENT_DIRS, "tokens/preview"].flatMap((dir) =>
      sourceFiles(join(packageRoot, "src", dir))
        .filter((file) => MOTION_CLASS_RE.test(readFileSync(file, "utf8")))
        .map((file) => file.slice(packageRoot.length + 1)),
    );

    expect(motionFiles.length).toBeGreaterThan(0);

    for (const file of motionFiles) {
      const source = readFileSync(join(packageRoot, file), "utf8");
      expect(source, `${file} must include a motion-reduce override`).toContain("motion-reduce:");
    }
  });

  it("marks ArticleBody as requiring a SectionFrame parent", () => {
    const source = readFileSync(join(packageRoot, "src/blocks/ArticleBody.tsx"), "utf8");
    expect(source).toContain('data-designer-requires-section-frame');
    expect(source).not.toContain("UI_WIDTH_PROSE_MAX");
  });

  it("positions every component with logical inline utilities, never physical left/right ones", () => {
    // #687 is why this exists. Five shell components positioned themselves
    // with physical direction classes (`border-r`, `border-l`, `left-0`,
    // `right-md`, `focus:left-sm`) and landed on the wrong side under a
    // right-to-left locale. Each was replaced with its logical equivalent
    // in 0.2.6 — but nothing then stopped a sixth from being written, and a
    // per-instance fix without a gate only defers the next instance.
    //
    // Scanned, not hand-listed, for the same reason the reduced-motion test
    // above is (#907): the CHECK is fully derived from the tree, so a new
    // component, or a new physical class in an existing one, cannot escape
    // it by not being on a list someone forgot to update.
    //
    // Block-direction utilities are deliberately NOT matched. `border-t`
    // and `border-b` on `SiteHeader`, `SiteFooter`, `Shell.Header`,
    // `Shell.Footer`, `Tabs` and `Table` are correct exactly as written:
    // block direction does not flip under a right-to-left locale, and
    // rewriting them would be the over-correction #687 explicitly refuses.
    // Nor are axis utilities (`overflow-x-auto`, `inset-x-0`, `px-*`,
    // `mx-*`), which address both inline sides at once and so are already
    // direction-neutral.
    const PHYSICAL_INLINE_RE = new RegExp(
      "(?:^|[\\s\"'`:])(" +
        [
          "(?:scroll-)?[mp][lr]-[a-z0-9[\\]./%-]+", // ml-auto, pr-2xl, scroll-pl-md
          "(?:left|right)-[a-z0-9[\\]./%-]+", // left-0, right-md
          "border-[lr](?![a-z])(?:-[0-9[][a-z0-9[\\]./%-]*)?", // border-l, border-r-2 — never border-line-base
          "text-(?:left|right)(?![a-z-])",
          "float-(?:left|right)(?![a-z-])",
          "clear-(?:left|right)(?![a-z-])",
          "origin-(?:(?:top|bottom)-)?(?:left|right)(?![a-z-])",
          "rounded-(?:[tb]?[lr])(?![a-z])(?:-[a-z0-9[\\]./%-]+)?",
        ].join("|") +
        ")",
      "g",
    );

    /**
     * Instances that exist TODAY, outside #687's declared scope (that issue
     * is five shell components, and says in as many words that it is "not a
     * general RTL audit"). This is a record of known debt, NOT a list of
     * approved exceptions — every entry below is a real right-to-left
     * defect in `atoms/` or `blocks/` awaiting its own change. Two rules
     * keep it from rotting into an approval list: nothing may be ADDED to
     * it (a new instance fails this test), and an entry that no longer
     * matches fails too — so the list can only ever shrink.
     */
    const KNOWN_PHYSICAL_INLINE: string[] = [];

    const found = new Set<string>();
    for (const dir of COMPONENT_DIRS) {
      for (const file of sourceFiles(join(packageRoot, "src", dir))) {
        const relative = file.slice(packageRoot.length + 1);
        for (const match of readFileSync(file, "utf8").matchAll(PHYSICAL_INLINE_RE)) {
          found.add(`${relative} :: ${match[1]}`);
        }
      }
    }

    // #951 cleared the last known-debt entries; an empty scan is the goal.
    // If this regresses to zero matches while debt reappears, `added` below
    // still fails — this assertion only guards the "scan ran" case when debt
    // remains listed in KNOWN_PHYSICAL_INLINE.
    if (KNOWN_PHYSICAL_INLINE.length > 0) {
      expect(found.size).toBeGreaterThan(0);
    }

    const added = [...found].filter((hit) => !KNOWN_PHYSICAL_INLINE.includes(hit)).sort();
    expect(
      added,
      "New physical inline-direction class(es). Use the logical equivalent so the component follows the document writing direction: " +
        "ml-/mr- to ms-/me-, pl-/pr- to ps-/pe-, left-/right- to start-/end-, border-l/border-r to border-s/border-e, " +
        "text-left/text-right to text-start/text-end, rounded-l*/rounded-r* to rounded-s*/rounded-e*.",
    ).toEqual([]);

    const stale = KNOWN_PHYSICAL_INLINE.filter((hit) => !found.has(hit)).sort();
    expect(
      stale,
      "Known-debt entr(ies) no longer in the tree — delete them from KNOWN_PHYSICAL_INLINE so the list keeps shrinking.",
    ).toEqual([]);

    // Shell carries none of this debt: #687's five are fixed and the list
    // above names only `atoms/` and `blocks/`. Asserted rather than left
    // implied, so a shell regression fails HERE with the issue named,
    // instead of as one anonymous line in the `added` diff above.
    expect([...found].filter((hit) => hit.startsWith("src/shell/")), "#687 regression in src/shell/").toEqual([]);
  });
});

// Pure namespace with the consumer art checker; file helpers remain Node-only.
const PURE_TOKEN_VALUES = [
  "AA",
  "AA_LARGE",
  "BACKDROP_BUDGET_CEILING_BYTES",
  "BACKDROP_KINDS",
  "CONTRAST_PAIRS",
  "IDENTITY_MIN_CONTRAST",
  "IDENTITY_VARIANT_ROLES",
  "IdentityKitValidationError",
  "LOCKUP_FONT_OUTLINING",
  "LOCKUP_GAP",
  "LOCKUP_GAP_RATIO",
  "LOCKUP_HEADERS",
  "LOCKUP_MARK_HEIGHT",
  "LOCKUP_WORDMARK_SIZE",
  "LOCKUP_WORDMARK_SIZE_RATIO",
  "MASTER_MARK_ICON_SHELL_STYLE",
  "MasterMarkValidationError",
  "TOKENS",
  "TOKEN_DISPLAY_GROUPS",
  "TOKEN_FAMILIES",
  "TOKEN_GUIDANCE",
  "TOKEN_STYLES_SENTINEL_PROPERTY",
  "TYPE_RECORD_SCHEMA_VERSION",
  "adoptSuppliedMark",
  "assertTokenStylesLoaded",
  "checkBackdropContract",
  "checkBackdropElement",
  "checkBrandFileCoverage",
  "checkClearSpace",
  "checkConsumerArtContract",
  "checkIdentityContrast",
  "checkMinimumSize",
  "checkSingleColourLegibility",
  "checkTokenContrast",
  "checkTypeRecord",
  "checkTypeRecordOverlay",
  "composeLockup",
  "contrastPairsForTheme",
  "contrastRatio",
  "deriveInitials",
  "formatParseFailure",
  "generateIdentityDirections",
  "hexToLinearSRGB",
  "iconMarkSvg",
  "identityKitReport",
  "isPlaceholderAuthoredValue",
  "isValidCssColor",
  "isValidCssFontFamily",
  "judgeIdentityKit",
  "luminanceOf",
  "oklchToLinearSRGB",
  "parseBrandDeclarations",
  "parseOklch",
  "parseTypeRecord",
  "recolorSvg",
  "relativeLuminance",
  "validateIdentityTokenInput",
  "validateMasterMark"
];

describe("compiled public token namespaces", () => {
  function publicKeys(subpath: string): string[] {
    return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `import * as tokens from ${JSON.stringify(subpath)}; process.stdout.write(JSON.stringify(Object.keys(tokens).sort()));`], { cwd: packageRoot, encoding: "utf8" }));
  }

  it("preserves the exact pure namespace and moves only the two Node values", () => {
    expect(PURE_TOKEN_VALUES.length).toBeGreaterThan(0);
    expect(publicKeys("@clossys/designer/tokens")).toEqual(PURE_TOKEN_VALUES);
    expect(publicKeys("@clossys/designer/tokens/server")).toEqual(["assertTailwindMergeVersion", "readBrandCss"]);
  });
});


describe("compiled catalog export cleanup", () => {
  it.each(["CardGrid", "TopicList", "LinkGrid", "Comparison", "LedgerTile"])("deletes the retired %s source entrypoint", name => {
    expect(existsSync(join(packageRoot, "src", "blocks", `${name}.tsx`))).toBe(false);
  });
  it.each(["@clossys/designer/blocks", "@clossys/designer/blocks/server", pathToFileURL(join(packageRoot, "dist", "index.js")).href])("exposes the canonical catalog without retired wrappers through %s", subpath => {
    const script = `import * as blocks from ${JSON.stringify(subpath)}; process.stdout.write(JSON.stringify(Object.keys(blocks)));`;
    const keys: string[] = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: packageRoot, encoding: "utf8", timeout: 10_000 }));
    expect(keys.filter(key => ["Item", "Items", "Matrix"].includes(key)).sort()).toEqual(["Item", "Items", "Matrix"]);
    expect(keys.filter(key => ["CardGrid", "TopicList", "LinkGrid", "Comparison", "LedgerTile"].includes(key))).toEqual([]);
    expect(keys.filter(key => ["ItemRenderer", "ItemsStatic", "renderNavItems", "MatrixRenderer"].includes(key))).toEqual([]);
  }, 15_000);
});

describe("compiled Tree public contract", () => {
  it("pins the Tree exports through both blocks barrels", () => {
    for (const subpath of ["@clossys/designer/blocks", "@clossys/designer/blocks/server"]) {
      const script = `import * as blocks from ${JSON.stringify(subpath)}; process.stdout.write(JSON.stringify(Object.keys(blocks)));`;
      const keys: string[] = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: packageRoot, encoding: "utf8", timeout: 10_000 }));
      expect(keys).toContain("Tree");
      expect(keys.filter(name => ["TreeProps", "TreeNodeData", "assertTree", "TreeRenderer"].includes(name))).toEqual([]);
    }
  }, 15_000);

  it("resolves TreeProps and TreeNodeData from real emitted declarations", () => {
    const filename = join(packageRoot, "emitted-tree-consumer.check.ts");
    const source = ["blocks/index.js", "blocks/server.js"].map((entry, index) => `
      import { Tree as Tree${index}, type TreeProps as Props${index}, type TreeNodeData as Node${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const node${index}: Node${index} = { id: "root", heading: "Root", figure: { value: 42, delta: "+6", trend: "up" }, status: { tone: "info", label: "Open" } };
      const props${index}: Props${index} = { nodes: [node${index}], orientation: "right", ground: "inverse", labelledBy: "heading", className: "caller" };
      Tree${index}(props${index});
    `).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => packageRoot, getCanonicalFileName: path => path, getNewLine: () => "\n" })).toBe("");
  }, 30_000);

  it("rejects unsupported Tree fields and orientation in real emitted declarations", () => {
    const filename = join(packageRoot, "emitted-tree-negative-consumer.check.ts");
    const source = ["blocks/index.js", "blocks/server.js"].map((entry, index) => `
      import { type TreeProps as Props${index}, type TreeNodeData as Node${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const node${index}: Node${index} = { id: "root", heading: "Root" };
      const props${index}: Props${index} = { nodes: [node${index}] };
      const linked${index}: Node${index} = { ...node${index}, href: "/root" };
      const visual${index}: Node${index} = { ...node${index}, visual: "Picture" };
      const featured${index}: Node${index} = { ...node${index}, featured: true };
      const invalid${index}: Props${index} = { ...props${index}, orientation: "up" };
    `).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    const cases = [0, 1].flatMap(index => [
      { binding: `linked${index}`, field: "href", code: 2353 },
      { binding: `visual${index}`, field: "visual", code: 2353 },
      { binding: `featured${index}`, field: "featured", code: 2353 },
      { binding: `invalid${index}`, field: "orientation", code: 2322 },
    ]);
    expect(diagnostics).toHaveLength(8);
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(cases.map(item => item.code));
    expect(diagnostics.map(diagnostic => diagnostic.file?.fileName)).toEqual(cases.map(() => filename));
    for (const [index, diagnostic] of diagnostics.entries()) {
      const item = cases[index]!;
      const line = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!).line;
      const declaration = source.split("\n")[line]!;
      expect(declaration).toContain(`const ${item.binding}:`);
      expect(declaration).toContain(`${item.field}:`);
      expect(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).toContain(item.field === "orientation" ? '"up"' : `'${item.field}'`);
    }
  }, 30_000);
});


describe("compiled pane handle edge contract", () => {
  it("accepts both edges through the emitted atom and block declarations", () => {
    const filename = join(packageRoot, "pane-edge-consumer.check.ts");
    const consumer = `
      import { type ResizeHandleProps } from ${JSON.stringify(join(packageRoot, "dist/atoms/index.js"))};
      import { type ResizablePaneProps } from ${JSON.stringify(join(packageRoot, "dist/blocks/index.js"))};
      const start: ResizeHandleProps["edge"] = "start";
      const end: ResizablePaneProps["handleEdge"] = "end";
    `;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  });

  it("rejects unsupported edges with native diagnostics through the atom and block barrels", () => {
    const filename = join(packageRoot, "pane-edge-negative-consumer.check.ts");
    const source = `
      import { type ResizeHandleProps } from ${JSON.stringify(join(packageRoot, "dist/atoms/index.js"))};
      import { type ResizablePaneProps } from ${JSON.stringify(join(packageRoot, "dist/blocks/index.js"))};
      const invalidAtom: ResizeHandleProps["edge"] = "middle";
      const invalidPane: ResizablePaneProps["handleEdge"] = "middle";
    `;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    const cases = [{ binding: "invalidAtom", field: "edge" }, { binding: "invalidPane", field: "handleEdge" }];
    expect(diagnostics).toHaveLength(2);
    for (const [index, diagnostic] of diagnostics.entries()) {
      const item = cases[index]!;
      expect(diagnostic.code).toBe(2322); expect(diagnostic.file?.fileName).toBe(filename);
      const line = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!).line;
      expect(source.split("\n")[line]).toContain(`const ${item.binding}:`);
      expect(source.split("\n")[line]).toContain(`["${item.field}"]`);
      expect(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).toBe(`Type '"middle"' is not assignable to type '"start" | "end" | undefined'.`);
    }
  });
});


describe("compiled CatalogWorkspace public contract", () => {
  it("exports the composition from both existing barrels with emitted host-facing types", () => {
    for (const entry of ["blocks/index.js", "index.js"]) {
      const filename = join(packageRoot, "catalog-consumer.check.ts");
      const consumer = `
        import { CatalogWorkspace, type CatalogWorkspaceProps, type CatalogWorkspaceItem, type CatalogWorkspaceSize } from ${JSON.stringify(join(packageRoot, "dist", entry))};
        const item: CatalogWorkspaceItem = {id: "host-id", label: "Example", kind: "component", children: []};
        const size: CatalogWorkspaceSize = {min: 160, max: 480, defaultValue: 240};
        const props: CatalogWorkspaceProps = {items: [item], selectedId: null, onSelect: (id: string) => {}, label: "Catalog", labels: {browse: "Browse", preview: "Preview", inspector: "Inspector", resizeBrowse: "Resize browse", resizeInspector: "Resize inspector"}, preview: selected => selected.label, inspector: selected => selected.kind, emptyState: "Select an item", browseSize: size};
        const result = CatalogWorkspace(props);
      `;
      const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
      const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
      host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
      expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
      const script = `import { CatalogWorkspace } from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(typeof CatalogWorkspace);`;
      expect(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot })).toBe("function");
    }
  }, 30_000);

  it("rejects numeric host IDs with native diagnostics at the ID field in both barrels", () => {
    const filename = join(packageRoot, "catalog-negative-consumer.check.ts");
    const source = ["blocks/index.js", "index.js"].map((entry, index) => `
      import { type CatalogWorkspaceItem as Item${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const invalid${index}: Item${index} = {id: 1, label: "Bad", kind: "component"};
    `).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(diagnostics).toHaveLength(2);
    for (const [index, diagnostic] of diagnostics.entries()) {
      expect(diagnostic.code).toBe(2322); expect(diagnostic.file?.fileName).toBe(filename);
      const line = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!).line;
      expect(source.split("\n")[line]).toContain(`const invalid${index}:`);
      expect(source.split("\n")[line]).toContain("id: 1");
      expect(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).toBe("Type 'number' is not assignable to type 'string'.");
    }
  });
});

describe("compiled DataTable saved-view public contract", () => {
  const values = ["DataTable", "DataTableViewModelError", "parseDataTableViewModel", "serializeDataTableViewModel"];
  it("exposes only the intended component and persistence values through both client barrels", () => {
    for (const entry of ["blocks/index.js", "index.js"]) {
      const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))}; const model = {version:1, table:{version:1, columns:[{id:"value",kind:"number"}],collation:{locale:"en"}}, mode:"flat", density:"compact", sort:[], visibleColumns:["value"]}; process.stdout.write(JSON.stringify({keys: Object.keys(api).filter(name => ${JSON.stringify(values)}.includes(name)).sort(), internal: ["ModelTable","FlatGrid","ViewOptions","PivotGrid","editView"].filter(name => name in api), model:api.parseDataTableViewModel(api.serializeDataTableViewModel(model))}));`;
      const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }));
      expect(result.keys).toEqual(values); expect(result.internal).toEqual([]); expect(result.model.density).toBe("compact"); expect(result.model.table.columns).toEqual([{ id: "value", kind: "number" }]);
    }
  });
  it("resolves the model, mode, density, sort and controlled props from emitted declarations", () => {
    const filename = join(packageRoot, "emitted-datatable-consumer.check.ts");
    const consumer = ["blocks/index.js", "index.js"].map((entry, index) => `
      import { DataTable as Table${index}, parseDataTableViewModel as parse${index}, serializeDataTableViewModel as serialize${index}, type DataTableViewModel as Model${index}, type DataTableProps as Props${index}, type DataTableMode as Mode${index}, type DataTableDensity as Density${index}, type DataTableSortRule as Sort${index}, type DataTableMessages as Messages${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const mode${index}: Mode${index} = "grouped";
      const density${index}: Density${index} = "compact";
      const sort${index}: Sort${index} = {column: "value", direction: "ascending"};
      const model${index}: Model${index} = {version:1, table:{version:1, columns:[{id:"value",kind:"number"}],collation:{locale:"en"}}, mode:mode${index}, density:density${index}, sort:[sort${index}], visibleColumns:["value"]};
      const messages${index}: Messages${index} = {viewOptionsLabel: "Settings", groupByMessage: column => "Bucket " + column, pivotColumnMessage: (axis, measure) => axis.kind + measure};
      const props${index}: Props${index}<{value:number}> = {"aria-label":"Values", columns:[{id:"value",header:"Value",cell:row=>row.value}],rows:[{value:7}],rowKey:row=>row.value,model:model${index},messages:messages${index},onModelChange:next=>{ const copy: Model${index} = parse${index}(serialize${index}(next)); },expandedGroupKeys:"all",onExpandedGroupKeysChange:keys=>{ const selected: ReadonlySet<string> = keys; }};
      Table${index}(props${index});
    `).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const compile = (source: string) => {
      const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
      host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
      return ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    };
    expect(compile(consumer).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const negative = consumer + [0, 1].map(index => `
      const invalidMessages${index}: Messages${index} = {viewOptionsLabel: 7};
      model${index}.messages = messages${index};
      const invalid${index}: Density${index} = "tiny";
      model${index}.sort.push(sort${index});
    `).join("\n");
    const diagnostics = compile(negative);
    const cases = [0, 1].flatMap(index => [
      { source: `const invalidMessages${index}:`, code: 2322 },
      { source: `model${index}.messages =`, code: 2339 },
      { source: `const invalid${index}:`, code: 2322 },
      { source: `model${index}.sort.push`, code: 2339 },
    ]);
    expect(diagnostics).toHaveLength(cases.length);
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(cases.map(item => item.code));
    for (const [index, diagnostic] of diagnostics.entries()) {
      expect(diagnostic.file?.fileName).toBe(filename);
      const line = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!).line;
      expect(negative.split("\n")[line]).toContain(cases[index]!.source);
    }
  }, 30_000);
});
