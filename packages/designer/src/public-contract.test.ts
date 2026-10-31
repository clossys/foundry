import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("source-owner closure public boundary", () => {
  it("compiles the additive record API only through the existing catalog-bundles leaf", () => {
    const filename = join(packageRoot, "source-owner-consumer.check.ts");
    const consumer = `import {prepareSourceOwnerClosure, type SourceOwnerClosureResult, type SourceOwnerRecord} from "@clossys/designer/catalog-bundles";
      const prepare: (input: Parameters<typeof prepareSourceOwnerClosure>[0]) => SourceOwnerClosureResult = prepareSourceOwnerClosure;
      function inspect(result: SourceOwnerClosureResult): readonly SourceOwnerRecord[] { if (result.status === "associated") { const digest: string | undefined = result.sourceHashes[result.consumer]; } return result.records; }
      void prepare; void inspect;`;
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, paths: { "@clossys/designer/catalog-bundles": [join(packageRoot, "src/catalog-bundles.ts")] } };
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    expect(pkg.exports["./catalog-bundles"]).toBeDefined();
    expect(Object.keys(pkg.exports).some(key => key.includes("source-owner"))).toBe(false);
    expect(readFileSync(join(packageRoot, "src/catalog-core/index.ts"), "utf8")).not.toContain("source-owner-closure");
  }, 30_000);
});

describe("compiled evidence blocks public contract", () => {
  it("exports the three components and their host-facing types through the existing barrels", () => {
    for (const entry of ["blocks/index.js", "blocks/server.js", "index.js"]) {
      const filename = join(packageRoot, "evidence-blocks-consumer.check.tsx");
      const consumer = `
        import { TestimonialSet, LogoCloud, PeopleGrid, type TestimonialSetProps, type TestimonialSetItem, type LogoCloudProps, type LogoCloudItem, type PeopleGridProps, type PeopleGridPerson } from ${JSON.stringify(join(packageRoot, "dist", entry))};
        const quote: TestimonialSetItem = {id: "quote", quote: "Clear account.", attributorName: "Author"};
        const quotes: TestimonialSetProps = {items: [quote], ground: "inverse", "aria-labelledby": "quotes"};
        const mark: LogoCloudItem = {id: "mark", name: "Mark", logo: null, href: "/mark"};
        const marks: LogoCloudProps = {items: [mark, mark, mark], tone: "original", ground: "sunken", "aria-label": "Marks"};
        const person: PeopleGridPerson = {id: "person", name: "Person", initials: "P", role: "Reviewer", bio: "Keeps notes clear.", href: "/person"};
        const people: PeopleGridProps = {people: [person, person], columns: 4, media: "photo", headingLevel: 6, ground: "inverse"};
        TestimonialSet(quotes); LogoCloud(marks); PeopleGrid(people);
      `;
      const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX };
      const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
      host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true, ts.ScriptKind.TSX) : original(path, language, error, fresh);
      expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), entry).toEqual([]);
      const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(JSON.stringify([typeof api.TestimonialSet, typeof api.LogoCloud, typeof api.PeopleGrid]));`;
      expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot })), entry).toEqual(["function", "function", "function"]);
    }
  }, 30_000);
});


/** Module specifiers naming React or ReactDOM, read from the syntax tree so a multi-line import or require cannot slip past. */
function reactModuleSpecifiers(source: string): string[] {
  const found: string[] = [];
  const react = /^react(?:-dom)?(?:\/|$)/;
  const record = (node: ts.Node | undefined) => { if (node && ts.isStringLiteralLike(node) && react.test(node.text)) found.push(node.text); };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) record(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) record(node.moduleReference.expression);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) record(node.arguments[0]);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) record(node.argument.literal);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile("source.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
  return found;
}

describe("compiled canvas public contract", () => {
  it("exports CanvasSurface and the headless functions through the client blocks entry", () => {
    const script = `import * as blocks from "@clossys/designer/blocks"; process.stdout.write(JSON.stringify(Object.keys(blocks)));`;
    const keys: string[] = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: packageRoot, encoding: "utf8" }));
    for (const name of ["CanvasSurface", "panBy", "zoomAt", "fitTo", "clamp", "toWorld", "toScreen", "selectSingle", "toggleSelection", "selectRange", "selectMarquee", "clearSelection", "navigate", "minimapModel"]) expect(keys).toContain(name);
    expect(keys).not.toContain("validateCanvasItems");
    expect(reactModuleSpecifiers(readFileSync(join(packageRoot, "src/blocks/canvas/models.ts"), "utf8"))).toEqual([]);
  });

  it("finds React module specifiers in import, export, require and dynamic import forms across lines [mutant: single-line regex]", () => {
    const prohibited: Record<string, string> = {
      "single-line import": 'import { useState } from "react";',
      "multi-line import": 'import {\n  createElement,\n  Fragment,\n} from\n  "react";',
      "multi-line require": 'const dom = require(\n  "react-dom/client"\n);',
      "re-export": 'export {\n  useId,\n} from "react";',
      "dynamic import": 'const lazy = () => import(\n  "react-dom"\n);',
    };
    for (const [name, source] of Object.entries(prohibited)) expect(reactModuleSpecifiers(source), name).not.toEqual([]);
    const control = 'import { finite } from "./react-free.js";\nconst note = "never import from \'react\' here";\nexport const requireFinite = (value: number) => finite(value);';
    expect(reactModuleSpecifiers(control)).toEqual([]);
  });

  it("resolves readonly serializable models and controlled surface props from emitted declarations", () => {
    const filename = join(packageRoot, "canvas-consumer.check.ts");
    const source = `
      import { CanvasSurface, panBy, zoomAt, fitTo, clamp, toWorld, toScreen, selectSingle,
        toggleSelection, selectRange, selectMarquee, clearSelection, navigate, minimapModel,
        type CanvasSurfaceProps, type CanvasPoint, type CanvasSize, type CanvasRect, type Viewport,
        type Selection, type CanvasItem, type CanvasDirection, type CanvasMinimapModel
      } from ${JSON.stringify(join(packageRoot, "dist/blocks/index.js"))};
      const point: CanvasPoint = { x: 0, y: 0 };
      const size: CanvasSize = { width: 800, height: 600 };
      const bounds: CanvasRect = { ...point, width: 1000, height: 800 };
      const viewport: Viewport = { ...point, zoom: 1 };
      const selection: Selection = selectSingle("a");
      const items: readonly CanvasItem[] = [{ id: "a", label: "Alpha", rect: bounds }];
      const direction: CanvasDirection = "right";
      const model: CanvasMinimapModel = minimapModel(bounds, viewport, size);
      const next: Viewport = clamp(zoomAt(panBy(viewport, point), toScreen(viewport, toWorld(viewport, point)), 2), 0.1, 8, bounds, size);
      const props: CanvasSurfaceProps = { "aria-label": "Canvas", viewport: next, selection,
        onViewportChange: (value: Viewport) => void JSON.stringify(value),
        onSelectionChange: (value: Selection) => void JSON.stringify(value), worldBounds: bounds,
        items, viewSize: size, minimap: true, zoomControls: true, renderItem: item => item.label };
      CanvasSurface(props); fitTo(bounds, size, 20); toggleSelection(selection, "b");
      selectRange(["a", "b"], "a", "b"); selectMarquee(items, bounds); clearSelection(); navigate(items, "a", direction);
    `;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  }, 30_000);
});

describe("compiled record-list public contract", () => {
  it("exports GridList through components and internal tooling, and ResourceList through blocks and internal tooling", async () => {
    for (const entry of ["components/index.js", "index.js"]) {
      const api = await import(pathToFileURL(join(packageRoot, "dist", entry)).href);
      expect(api.GridList).toBeTypeOf("function");
      expect(api.GridList.Item).toBeTypeOf("function");
      expect(api.GridList.SelectionCheckbox).toBeTypeOf("function");
    }
    for (const entry of ["blocks/index.js", "index.js"]) {
      const api = await import(pathToFileURL(join(packageRoot, "dist", entry)).href);
      expect(api.ResourceList).toBeTypeOf("function");
    }
    const server = await import(pathToFileURL(join(packageRoot, "dist/blocks/server.js")).href);
    expect(server).not.toHaveProperty("ResourceList");
  });

  it("resolves record-list prop types through emitted barrel declarations", () => {
    const filename = join(packageRoot, "record-list-consumer.check.tsx");
    const consumer = ["components/index.js", "index.js"].map((entry, index) => `
      import type {GridListProps as Grid${index}, GridListItemProps as Item${index}, GridListSelectionCheckboxProps as Check${index}} from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const grid${index}: Grid${index}<{id:string}> = {"aria-label":"Records", children:[]};
      const item${index}: Item${index} = {id:"one", textValue:"Planning note", children:"Planning note"};
      const check${index}: Check${index} = {"aria-label":"Choose planning note"};
    `).join("\n") + ["blocks/index.js", "index.js"].map((entry, index) => `
      import type {ResourceListProps as List${index}, ResourceListItem as Record${index}, ResourceListAction as Action${index}} from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const action${index}: Action${index} = {id:"edit",label:"Edit",onAction:()=>{}};
      const record${index}: Record${index} = {id:"one",textValue:"Planning note",title:"Planning note",actions:[action${index}]};
      const list${index}: List${index} = {"aria-label":"Notes",items:[record${index}],emptyState:{title:"No notes"}};
    `).join("\n");
    const options = {strict:true, noEmit:true, skipLibCheck:true, jsx:ts.JsxEmit.ReactJSX, target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext, moduleResolution:ts.ModuleResolutionKind.Bundler};
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true, ts.ScriptKind.TSX) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  }, 30_000);
});

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

describe("compiled task and event public contract", () => {
  it.each(["blocks/index.js", "index.js"])("exports TaskList, EventItem and their public declarations from %s", entry => {
    const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(JSON.stringify([typeof api.TaskList, typeof api.EventItem]));`;
    expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }))).toEqual(["function", "function"]);
    const declaration = readFileSync(join(packageRoot, "dist", entry.replace(/\.js$/, ".d.ts")), "utf8");
    for (const name of ["TaskListProps", "TaskListItem", "TaskStatus", "EventItemProps", "EventActor", "EventChange", "EventRecord", "EventLabels"]) {
      expect(declaration).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe("compiled section list blocks public contract", () => {
  it.each(["blocks/index.js", "index.js"])("exports ActivityFeed, AuditLog, Timeline, UsageSummary and their public declarations from %s", entry => {
    const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(JSON.stringify([typeof api.ActivityFeed, typeof api.AuditLog, typeof api.Timeline, typeof api.UsageSummary]));`;
    expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }))).toEqual(["function", "function", "function", "function"]);
    const declaration = readFileSync(join(packageRoot, "dist", entry.replace(/\.js$/, ".d.ts")), "utf8");
    for (const name of ["ActivityFeedProps", "ActivityFeedGroup", "AuditLogProps", "AuditLogEntry", "AuditLogLabels", "TimelineProps", "TimelineEvent", "TimelineHeadingLevel", "UsageSummaryProps", "UsageSummaryMeter"]) {
      expect(declaration).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe("compiled AccessMatrix and ColumnMapper public contract", () => {
  it("exports both components and exact required props and value types from client barrels only", () => {
    const filename = join(packageRoot, "access-matrix-column-mapper-consumer.check.ts");
    const consumer = ["blocks/index.js", "index.js"].map((entry, i) => `
      import { AccessMatrix as A${i}, ColumnMapper as C${i}, type AccessCellValue as Cell${i}, type AccessRole as Role${i}, type AccessPermission as Permission${i}, type AccessGroup as Group${i}, type AccessMatrixValue as Value${i}, type AccessMatrixChange as Change${i}, type AccessMatrixLabels as Labels${i}, type AccessMatrixProps as Props${i}, type ColumnMapperTarget as Target${i}, type ColumnMapperSource as Source${i}, type ColumnMapping as Mapping${i}, type ColumnMapperIssue as Issue${i}, type ColumnMapperLabels as MapperLabels${i}, type ColumnMapperProps as MapperProps${i} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      type RequiredKeys${i}<T> = { [K in keyof T]-?: {} extends Pick<T,K> ? never : K }[keyof T];
      type Same${i}<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
      const requiredAccess${i}: Same${i}<RequiredKeys${i}<Props${i}>, "aria-label" | "roles" | "groups" | "value" | "labels"> = true;
      const requiredMapper${i}: Same${i}<RequiredKeys${i}<MapperProps${i}>, "targets" | "sourceColumns" | "mapping" | "onMappingChange" | "labels"> = true;
      const kinds${i}: Same${i}<Target${i}["kind"], "text" | "number" | "date" | "enum" | "tags" | "boolean"> = true;
      const cell${i}: Cell${i} = {state:"inherited",reason:"Included with Viewer access to reports."};
      const role${i}: Role${i} = {id:"editor",label:"Editor",isLocked:true,lockedReason:"Host supplied reason"};
      const permission${i}: Permission${i} = {id:"view",label:"View projects"};
      const group${i}: Group${i} = {id:"projects",label:"Projects",permissions:[permission${i}]};
      const value${i}: Value${i} = {editor:{view:cell${i}}};
      const change${i}: Change${i} = {roleId:"editor",permissionIds:["view"],state:"granted"};
      const labels${i}: Labels${i} = {permissionHeader:"Permission",cell:(r,p)=>r+p,groupAll:(r,g)=>r+g,inherited:"Inherited",locked:"Locked",changeSummary:(g,r)=>String(g+r)};
      const props${i}: Props${i} = {"aria-label":"Workspace access",roles:[role${i}],groups:[group${i}],value:value${i},labels:labels${i},onChange:(next,change)=>{const v:Value${i}=next;const c:Change${i}=change;}};
      const target${i}: Target${i} = {id:"email",label:"Email",kind:"text",required:true};
      const source${i}: Source${i} = {id:"email",header:"E-mail address",samples:["ada@example.com"]};
      const mapping${i}: Mapping${i} = {email:null};
      const issue${i}: Issue${i} = {targetId:"email",message:"Choose a column"};
      const mapperLabels${i}: MapperLabels${i} = {legend:"Match columns",notMapped:"Not mapped",required:"Required",requiredMissing:t=>t,duplicate:h=>h,samples:v=>v.join(", "),summary:(m,t,p)=>String(m+t+p)};
      const mapper${i}: MapperProps${i} = {targets:[target${i}],sourceColumns:[source${i}],mapping:mapping${i},onMappingChange:next=>{const m:Mapping${i}=next;},labels:mapperLabels${i},issues:[issue${i}]};
      const accessComponent${i}: (p:Props${i})=>import("react").ReactNode = A${i};
      const mapperComponent${i}: (p:MapperProps${i})=>import("react").ReactNode = C${i};
    `).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
    for (const entry of ["blocks/index.js", "index.js", "blocks/server.js"]) {
      const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(JSON.stringify(["AccessMatrix","ColumnMapper"].filter(name=>typeof api[name]==="function")));`;
      expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }))).toEqual(entry === "blocks/server.js" ? [] : ["AccessMatrix", "ColumnMapper"]);
    }
  });
});

describe("compiled signature chart public contract", () => {
  it.each(["index", "server"])("exports all three charts from the compiled charts/%s entry", async entry => {
    const exports = await import(pathToFileURL(join(packageRoot, `dist/charts/${entry}.js`)).href);
    for (const name of ["AreaChart", "Heatmap", "StatusStrip"]) expect(exports[name]).toBeTypeOf("function");
  });
});

describe("compiled table-model public contract", () => {
  const values = ["TABLE_FILTER_CONFORMANCE", "TableModelError", "aggregate", "filterRows", "groupRows", "parseTableModel", "pivotRows", "pruneFilterColumn", "serializeTableModel", "tableFilterPredicate"];

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
      import { filterRows as filter${index}, groupRows as group${index}, pivotRows as pivot${index}, aggregate as aggregate${index}, serializeTableModel as serialize${index}, parseTableModel as parse${index}, TableModelError as Error${index}, tableFilterPredicate as predicate${index}, pruneFilterColumn as prune${index}, TABLE_FILTER_CONFORMANCE as conformance${index}, type TableFilterGroup as FilterGroup${index}, type TableFilterNode as FilterNode${index}, type TableModel as Model${index}, type TableFilterResult as Filter${index}, type TableGroup as Group${index}, type TablePivotResult as Pivot${index}, type TableAggregates as Aggregates${index}, type TableModelErrorCode as Code${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const model${index}: Model${index} = {version: 1, columns: [{id: "value", kind: "number"}], collation: {locale: "en"}, measures: [{id: "sum", op: "sum", column: "value"}], groupBy: [{column: "value"}], pivot: {rows: [{column: "value"}], columns: []}};
      const rows${index} = [{value: 7}];
      const result${index}: Filter${index}<{value: number}> = filter${index}(rows${index}, model${index});
      const groups${index}: readonly Group${index}<{value: number}>[] = group${index}(rows${index}, model${index});
      const pivoted${index}: Pivot${index} = pivot${index}(rows${index}, model${index});
      const totals${index}: Aggregates${index} = aggregate${index}(rows${index}, parse${index}(serialize${index}(model${index})));
      const code${index}: Code${index} = new Error${index}("invalid-model", "Invalid saved view").code;
      const filterGroup${index}: FilterGroup${index} = {kind:"group", op:"or", items:[]};
      const filterNode${index}: FilterNode${index} = {kind:"group", op:"and", items:[{column:"value",kind:"number",op:"empty"}]};
      const v2${index}: Model${index} = {...model${index}, version:2, filters:[filterNode${index}]};
      const pruned${index}: readonly FilterNode${index}[] = prune${index}(v2${index}.filters ?? [], "value");
      const passes${index}: (row:{value:number})=>boolean = predicate${index}(v2${index});
      const corpusIds${index}: readonly string[] = conformance${index}[0].expectedIds;
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

describe("compiled component guidance public contract", () => {
  it("keeps the three legacy metadata records in the foundational components barrel", () => {
    const entry = join(packageRoot, "dist/components/index.js");
    const script = `import * as components from ${JSON.stringify(entry)}; process.stdout.write(JSON.stringify(Object.keys(components).filter(key => /^COMPONENT_/.test(key)).sort()));`;
    const keys = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }));
    expect(keys).toEqual(["COMPONENT_API_FACTS", "COMPONENT_COMPARISON", "COMPONENT_GUIDANCE"]);
  });
  it("resolves IA navigation and all action aliases through the compiled public catalog entry", () => {
    const entry = "@clossys/designer/catalog";
    const script = `
      import { COMPONENT_DISPLAY_TREE, componentSelection, resolveComponentId } from ${JSON.stringify(entry)};
      const leaves = COMPONENT_DISPLAY_TREE.flatMap(group => group.children.flatMap(family => family.leaves));
      const actions = ["act.native-action", "act.button", "act.icon-button", "act.menu", "act.toolbar", "act.toggle-button", "act.link", "act.breadcrumb", "act.navigation-tree"];
      const alias = componentSelection("act.button"), canonical = componentSelection("components.button");
      process.stdout.write(JSON.stringify({ registered: leaves.includes(resolveComponentId("act.button")), actionCount: actions.length, allActionsRegistered: actions.every(alias => leaves.includes(resolveComponentId(alias))), same: alias.guidance === canonical.guidance, exportName: canonical.facts.exportName }));
    `;
    expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }))).toEqual({ registered: true, actionCount: 9, allActionsRegistered: true, same: true, exportName: "Button" });
  });
  it("types the compiled catalog navigation and selection API through the public catalog subpath", () => {
    const filename = join(packageRoot, "catalog-selection-consumer.check.ts");
    const consumer = `
      import { COMPONENT_DISPLAY_TREE, componentSelection, resolveComponentId, type ComponentDisplayTree } from "@clossys/designer/catalog";
      const tree: ComponentDisplayTree = COMPONENT_DISPLAY_TREE;
      const id: string = resolveComponentId("act.button");
      const selection = componentSelection(id);
      const name: string | undefined = selection?.facts?.exportName;
    `;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  });
  it("pins compiled comparison keys to the finite public API facts", () => {
    const entry = join(packageRoot, "dist/components/index.js");
    const script = `
      import { COMPONENT_COMPARISON, COMPONENT_API_FACTS } from ${JSON.stringify(entry)};
      process.stdout.write(JSON.stringify({
        actual: Object.keys(COMPONENT_COMPARISON).sort(),
        expected: Object.entries(COMPONENT_API_FACTS).filter(([, fact]) => fact.options.length > 0).map(([id]) => id).sort()
      }));
    `;
    const keys = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }));
    expect(keys.actual.length).toBeGreaterThan(0);
    expect(keys.actual).toEqual(keys.expected);
  });

  it("exports the compiled ComponentComparison type through the existing components subpath", () => {
    const filename = join(packageRoot, "component-comparison-consumer.check.ts");
    const consumer = `
      import { COMPONENT_COMPARISON, type ComponentComparison } from ${JSON.stringify(join(packageRoot, "dist/components/index.js"))};
      const comparison: ComponentComparison = COMPONENT_COMPARISON["act.button"];
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
  "./components",
  "./components/server",
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
  "./catalog",
  "./catalog/server",
  "./catalog/node",
  "./catalog/dogfood/node",
  "./studio",
  "./studio/queries",
  "./studio/state",
  "./render-environment",
  "./catalog-bundles",
  "./frames",
  "./studio/route",
  "./studio/route/server",
] as const;
const CSS_SUBPATHS = ["./tokens.css", "./theme.css", "./theme-keys.css", "./utilities.css", "./compiled.css", "./brand-template.css"] as const;
const COMPONENT_DIRS = ["components", "blocks", "charts", "shell", "theme"] as const;

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
    expect(packageJson.exports["./studio/state"]).toEqual({ types: "./dist/studio/WholeStudioProvider.d.ts", import: "./dist/studio/WholeStudioProvider.js" });
    expect(packageJson.exports["."]).toBeUndefined();
    expect(packageJson.exports["./atoms"]).toBeUndefined(); // rename-negative: no legacy client alias
    expect(packageJson.exports["./atoms/server"]).toBeUndefined(); // rename-negative: no legacy server alias
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
    expect(packageJson.dependencies).toEqual({ "class-variance-authority": "0.7.1", "css-tree": "3.2.1", "@clossys/strategist": "0.6.0" });

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
     * defect in `components/` or `blocks/` awaiting its own change. Two rules
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
    // above names only `components/` and `blocks/`. Asserted rather than left
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

describe("compiled SiteHeader single-surface public contract", () => {
  it("exports the exact surface vocabulary and refuses retired fields through every declaration entry", () => {
    const filename = join(packageRoot, "emitted-site-header-consumer.check.ts");
    const source = ["index.js", "shell/index.js", "shell/server.js"].map((entry, index) => `
      import { type SiteHeaderProps as Props${index}, type SiteHeaderSurface as Surface${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      type Same${index}<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
      const exact${index}: Same${index}<Surface${index}, "solid" | "transparent" | "glass"> = true;
      const valid${index}: Props${index} = { brand: "Example", surface: "glass", tone: "inverse" };
      type Retired${index} = "ground" | "placement" | "secondaryAction" | "surfaceLabel" | "mobileLayout";
      const absent${index}: Extract<keyof Props${index}, Retired${index}> extends never ? true : false = true;
    `).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => packageRoot, getCanonicalFileName: path => path, getNewLine: () => "\n" })).toBe("");
  });
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
  it("accepts both edges through the emitted component and block declarations", () => {
    const filename = join(packageRoot, "pane-edge-consumer.check.ts");
    const consumer = `
      import { type ResizeHandleProps } from ${JSON.stringify(join(packageRoot, "dist/components/index.js"))};
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

  it("rejects unsupported edges with native diagnostics through the component and block barrels", () => {
    const filename = join(packageRoot, "pane-edge-negative-consumer.check.ts");
    const source = `
      import { type ResizeHandleProps } from ${JSON.stringify(join(packageRoot, "dist/components/index.js"))};
      import { type ResizablePaneProps } from ${JSON.stringify(join(packageRoot, "dist/blocks/index.js"))};
      const invalidComponent: ResizeHandleProps["edge"] = "middle";
      const invalidPane: ResizablePaneProps["handleEdge"] = "middle";
    `;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    const cases = [{ binding: "invalidComponent", field: "edge" }, { binding: "invalidPane", field: "handleEdge" }];
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

describe("compiled CatalogBrowser public contract", () => {
  const consumerFor = (entry: string, index: number) => `
    import { CatalogBrowser as Browser${index}, type CatalogBrowserProps as Props${index}, type CatalogBrowserKind as Kind${index}, type CatalogBrowserLabels as Labels${index}, type CatalogBrowserSelection as Selection${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
    interface Entry${index} { id: string; label: string; l1: string; l2: string; lifecycle: "draft" | "stable" | "deprecated" | "parked"; tier: "core" | "role" }
    const catalog${index} = { kind: "themes" as const, groups: [{ id: "color", label: "Color", children: [{ id: "ink", label: "Ink" }] }], entries: [{ id: "--ink", label: "Ink", l1: "color", l2: "ink", lifecycle: "draft", tier: "role" }] satisfies Entry${index}[] };
    const kind${index}: Kind${index}<Entry${index}> = { label: "Tokens", preview: (entry, context) => entry.tier + context.kind + String(context.config.tone), controls: () => [{ type: "toggle", id: "tone", label: "Tone", defaultValue: false }] };
    declare const labels${index}: Labels${index};
    const selection${index}: Selection${index} = { catalog: "themes", entryId: null };
    const props${index}: Props${index}<typeof catalog${index}> = { catalogs: [catalog${index}], kinds: { themes: kind${index} }, label: "Catalog", labels: labels${index}, defaultSelection: selection${index} };
    const element${index} = Browser${index}(props${index});
  `;
  it("exports the block and its host-facing types from both existing barrels", () => {
    const filename = join(packageRoot, "catalog-browser-consumer.check.ts");
    const consumer = ["blocks/index.js", "index.js"].map(consumerFor).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    for (const entry of ["blocks/index.js", "index.js"]) {
      const script = `import { CatalogBrowser } from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(typeof CatalogBrowser);`;
      expect(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot })).toBe("function");
    }
  }, 30_000);

  it("requires a binding for every catalog kind with native diagnostics in both barrels", () => {
    const filename = join(packageRoot, "catalog-browser-negative-consumer.check.ts");
    const source = ["blocks/index.js", "index.js"].map((entry, index) => `
      import { type CatalogBrowserProps as Props${index}, type CatalogBrowserLabels as Labels${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      declare const labels${index}: Labels${index};
      const catalog${index} = { kind: "icons" as const, groups: [], entries: [] };
      const invalid${index}: Props${index}<typeof catalog${index}> = { catalogs: [catalog${index}], kinds: {}, label: "Catalog", labels: labels${index} };
    `).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    expect(diagnostics).toHaveLength(2);
    for (const [index, diagnostic] of diagnostics.entries()) {
      expect(diagnostic.code).toBe(2741); expect(diagnostic.file?.fileName).toBe(filename);
      const line = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!).line;
      expect(source.split("\n")[line]).toContain(`const invalid${index}:`);
      expect(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).toContain("Property 'icons' is missing");
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
      import { DataTable as Table${index}, parseDataTableViewModel as parse${index}, serializeDataTableViewModel as serialize${index}, type DataTableViewModel as Model${index}, type DataTableViewModelV1 as V1${index}, type DataTableProps as Props${index}, type DataTableMode as Mode${index}, type DataTableDensity as Density${index}, type DataTableSortRule as Sort${index}, type DataTableMessages as Messages${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      const mode${index}: Mode${index} = "grouped";
      const density${index}: Density${index} = "compact";
      const sort${index}: Sort${index} = {column: "value", direction: "ascending"};
      const legacy${index}: V1${index} = {version:1, table:{version:1, columns:[{id:"value",kind:"number"}],collation:{locale:"en"}}, mode:mode${index}, density:density${index}, sort:[sort${index}], visibleColumns:["value"]};
      const model${index}: Model${index} = {...parse${index}(legacy${index}), columnWidths:{value:120}, pinnedColumns:["value"]};
      const messages${index}: Messages${index} = {viewOptionsLabel: "Settings", groupByMessage: column => "Bucket " + column, pivotColumnMessage: (axis, measure) => axis.kind + measure};
      const props${index}: Props${index}<{value:number}> = {"aria-label":"Values", columns:[{id:"value",header:"Value",cell:row=>row.value}],rows:[{value:7}],rowKey:row=>row.value,model:model${index},messages:messages${index},onModelChange:next=>{ const copy: Model${index} = parse${index}(serialize${index}(next)); },expandedGroupKeys:"all",onExpandedGroupKeysChange:keys=>{ const selected: ReadonlySet<string> = keys; }};
      Table${index}(props${index});
      Table${index}({...props${index},model:legacy${index}});
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
      const invalidVersion${index}: Model${index} = {...model${index},version:1};
      model${index}.columnWidths!.value = 60;
    `).join("\n");
    const diagnostics = compile(negative);
    const cases = [0, 1].flatMap(index => [
      { source: `const invalidMessages${index}:`, code: 2322 },
      { source: `model${index}.messages =`, code: 2339 },
      { source: `const invalid${index}:`, code: 2322 },
      { source: `model${index}.sort.push`, code: 2339 },
      { source: `const invalidVersion${index}:`, code: 2322 },
      { source: `model${index}.columnWidths!.value =`, code: 2542 },
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

it("exports PageBar from the public root and blocks barrels with retained public types", async () => {
  const blocks = await import("./blocks/index.js");
  const root = await import("./index.js");
  expect((blocks as any).PageBar).toBeTypeOf("function");
  expect((root as any).PageBar).toBe((blocks as any).PageBar);
  for (const file of ["src/blocks/index.ts", "src/index.ts"]) {
    const source = readFileSync(join(packageRoot, file), "utf8");
    for (const name of ["PageBarProps", "PageBarPage", "PageBarCrumb", "PageBarAction", "PageBarDestination", "PageBarLabels"]) expect(source).toContain(name);
    expect(source).not.toContain("PageBarWidth");
  }
});

describe("compiled NewsletterBand public contract", () => {
  it("exports the client component from both client barrels and keeps its validator private", () => {
    for (const entry of ["blocks/index.js", "index.js"]) {
      const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(JSON.stringify({component: typeof api.NewsletterBand, private: ["ACTION_PATTERN", "NewsletterStatus", "NewsletterBandProps"].filter(name => name in api)}));`;
      expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }))).toEqual({ component: "function", private: [] });
    }
    const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist/blocks/server.js"))}; process.stdout.write(JSON.stringify("NewsletterBand" in api));`;
    expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot })).toBe("false");
  });

  it("pins the controlled status, copy, post and callback types in both emitted client entries", () => {
    const filename = join(packageRoot, "emitted-newsletter-consumer.check.ts");
    const consumer = ["blocks/index.js", "index.js"].map((entry, index) => `
      import { NewsletterBand as Band${index}, type NewsletterBandProps as Props${index}, type NewsletterStatus as Status${index} } from ${JSON.stringify(join(packageRoot, "dist", entry))};
      type Same${index}<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
      const status${index}: Same${index}<Status${index}, "idle" | "pending" | "sent" | "failed"> = true;
      const props${index}: Props${index} = {emailLabel: "Email", submitLabel: "Send", pendingLabel: "Sending", sentMessage: "Sent", failedMessage: "Failed", action: "/subscribe", method: "post", name: "address", status: "pending", layout: "stacked", ground: "inverse", "aria-label": "Updates", onSubmit: (email, event) => { const value: string = email; const form: HTMLFormElement = event.currentTarget; }};
      Band${index}(props${index});
    `).join("\n");
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const compile = (source: string) => {
      const host = ts.createCompilerHost(options); const original = host.getSourceFile.bind(host);
      host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, source, language, true) : original(path, language, error, fresh);
      return ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    };
    expect(compile(consumer).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const negative = consumer + [0, 1].map(index => `
      const missingCopy${index}: Props${index} = {action: "/subscribe"};
      const invalidMethod${index}: Props${index} = {...props${index}, method: "get"};
      const invalidStatus${index}: Status${index} = "success";
    `).join("\n");
    const diagnostics = compile(negative);
    const cases = [0, 1].flatMap(index => [
      { binding: `missingCopy${index}`, code: 2739 },
      { binding: `invalidMethod${index}`, code: 2322 },
      { binding: `invalidStatus${index}`, code: 2322 },
    ]);
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(cases.map(item => item.code));
    for (const [index, diagnostic] of diagnostics.entries()) {
      expect(diagnostic.file?.fileName).toBe(filename);
      const line = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!).line;
      expect(negative.split("\n")[line]).toContain(`const ${cases[index]!.binding}:`);
    }
  }, 30_000);
});

describe("compiled TableOfContents public contract", () => {
  it("exports the client component from both client barrels and the server variant from the server barrel, with no helper leaks", () => {
    for (const entry of ["blocks/index.js", "index.js"]) {
      const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(JSON.stringify({component: typeof api.TableOfContents, private: ["validateTableOfContents", "renderTableOfContentsList", "renderTableOfContentsSidebar", "TableOfContentsProps", "TableOfContentsItem"].filter(name => name in api)}));`;
      expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }))).toEqual({ component: "function", private: [] });
    }
    const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist/blocks/server.js"))}; process.stdout.write(JSON.stringify({component: typeof api.TableOfContents, private: ["validateTableOfContents", "renderTableOfContentsList"].filter(name => name in api)}));`;
    expect(JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }))).toEqual({ component: "function", private: [] });
  });
});

describe("headless project model public contract", () => {
  it("exposes working functions through the emitted blocks and source-root barrels", () => {
    const blocks = join(packageRoot, "dist/blocks/index.js");
    const root = join(packageRoot, "dist/index.js");
    const script = `
      import * as blocks from ${JSON.stringify(blocks)};
      import * as root from ${JSON.stringify(root)};
      const names = ['scheduleProject','projectRollups','boardColumns','timelineLayout','serializeProject','parseProject','ProjectModelError'];
      const tasks = [{id:'a',title:'A',status:'done',durationDays:2,deps:[]}];
      const schedule = blocks.scheduleProject(tasks,{isWorkingDay:()=>true,addWorkingDays:(d,n)=>d+n});
      process.stdout.write(JSON.stringify({same:names.every(name=>typeof blocks[name]==='function' && blocks[name]===root[name]),end:schedule.end,completion:blocks.projectRollups(schedule)[0].percentComplete,version:blocks.parseProject(blocks.serializeProject(tasks)).version}));
    `;
    expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: packageRoot, encoding: "utf8" }))).toEqual({ same: true, end: 2, completion: 100, version: 1 });
  });
  it("accepts a typed downstream consumer of emitted project declarations", () => {
    const filename = join(packageRoot, "project-model-consumer.check.ts");
    const consumer = `
      import { scheduleProject, projectRollups, boardColumns, timelineLayout, serializeProject, parseProject, ProjectModelError, type Task, type Calendar, type ProjectSchedule, type ProjectRollup, type BoardColumn, type TimelineLayout, type ProjectModel } from ${JSON.stringify(join(packageRoot, "dist/blocks/index.js"))};
      import type { ProjectCalendar } from ${JSON.stringify(join(packageRoot, "dist/index.js"))};
      const calendar: Calendar & ProjectCalendar = { isWorkingDay: () => true, addWorkingDays: (day, count) => day + count };
      const tasks: readonly Task[] = [{id:'a',title:'A',status:'done',deps:[]}];
      const schedule: ProjectSchedule = scheduleProject(tasks, calendar);
      const rollups: readonly ProjectRollup[] = projectRollups(schedule);
      const columns: readonly BoardColumn[] = boardColumns(tasks, {statusOrder:['done']});
      const layout: TimelineLayout = timelineLayout(schedule, {zoom:'month', rowOrder:['a']});
      const saved: ProjectModel = parseProject(serializeProject(tasks));
      const error = new ProjectModelError('unsupported-version', 'version');
      const cycle: readonly string[] = error.cycle;
    `;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  });
});


describe("compiled control glyph bindings", () => {
  it("exports the provider only from the client components entry and keeps StatusMark server-safe", () => {
    const clientScript = `import * as api from ${JSON.stringify(join(packageRoot, "dist/components/index.js"))}; process.stdout.write(JSON.stringify(typeof api.GlyphProvider));`;
    expect(execFileSync(process.execPath, ["--input-type=module", "-e", clientScript], { encoding: "utf8", cwd: packageRoot })).toBe('"function"');
    const serverScript = `import * as api from ${JSON.stringify(join(packageRoot, "dist/components/server.js"))}; const mark = api.StatusMark({ tone: "success", children: "Ready", glyphs: { "assets.icon-success": [["path", { d: "M1 2h3" }]] } }); process.stdout.write(JSON.stringify({ provider: "GlyphProvider" in api, mark: mark.type }));`;
    expect(JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", serverScript], { encoding: "utf8", cwd: packageRoot }))).toEqual({ provider: false, mark: "span" });
  });
});

describe("compiled composite component catalog contract", () => {
  it("exposes one typed consumer composite from catalog and catalog/server", () => {
    for (const entry of ["catalog-core/index.js", "catalog-core/server.js"]) {
      const filename = join(packageRoot, "composite-consumer.check.ts");
      const negativeFixture = readFileSync(join(packageRoot, "src/catalog-core/composite-change-set.check.ts"), "utf8");
      const consumer = negativeFixture.replace('from "./index.js"', `from ${JSON.stringify(join(packageRoot, "dist", entry))}`) + `
        import { check, resolve, emit, applyLibraryChange, libraryHash, materializeSourceFill,
          type CompositeCatalogData, type CompositeLibraryData, type CompositeEngineInput,
          type CompositeResolved, type CompositeCheckResult,
          type CompositeEmitFile, type ComponentObservation, type SourceBundle,
          buildComponentsConsumption, scanComponentReads, type ConsumptionInput, type ConsumptionFinding } from ${JSON.stringify(join(packageRoot, "dist", entry))};
        declare const catalog: CompositeCatalogData;
        declare const library: CompositeLibraryData;
        declare const observation: ComponentObservation;
        declare const bundle: SourceBundle;
        const changes: CompositeChangeSet = { baseHash: libraryHash(library), bundles: [bundle], changes: [
          {portion: "values", change: {op: "author", slot: "themes.foreground", tokens: {default: {$type: "color", $value: "#111111"}}}},
          {portion: "components", change: {op: "adopt", slot: "components.button", source: "example"}},
          {portion: "components", change: {op: "compose", slot: "components.select", rule: "compose:example@1"}}
        ]};
        const next: CompositeLibraryData = applyLibraryChange(catalog, library, changes);
        const input: CompositeEngineInput = {catalog, library: next, componentOptions: {evidence: {observations: {"components.button": observation}, installedRac: {version: "1.21.1", instance: "one"}}}};
        const checked: CompositeCheckResult = check(input);
        const profile: CompositeResolved = resolve(input);
        const files: CompositeEmitFile[] = emit(profile, ["css-brand", "component-index", "components-consumption", "notices"]);
        void materializeSourceFill; void checked; void files;
        declare const staticInput: ConsumptionInput;
        const inventory = buildComponentsConsumption(staticInput);
        const scan = scanComponentReads("", [], "");
        void inventory; void scan;
      `;
      const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
      const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
      host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
      expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), entry).toEqual([]);
      const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))}; process.stdout.write(JSON.stringify(["check","resolve","emit","applyLibraryChange","libraryHash","materializeSourceFill","buildComponentsConsumption","scanComponentReads"].map(name=>typeof api[name])));`;
      expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }))).toEqual(Array(8).fill("function"));
    }
  }, 30_000);
});

describe("compiled generic runtime assembly public contract", () => {
  it("exports platform-neutral ports and producers through the existing catalog entry", async () => {
    const filename = join(packageRoot, "runtime-ports-consumer.check.ts");
    const consumer = `
      import { prepareRuntimeAssembly, runRuntimeAssemblyEvidence, validateRuntimeAssemblyEvidence, checkConsumerRuntimePorts, type ConsumerRuntimePorts, type RuntimeAssemblyInput, type RuntimeMeasurementRunner, type RuntimeEvidenceResult } from ${JSON.stringify(join(packageRoot, "dist/catalog-core/index.js"))};
      declare const ports: ConsumerRuntimePorts<string>;
      declare const input: RuntimeAssemblyInput<string>;
      declare const runner: RuntimeMeasurementRunner<string>;
      const prepared = prepareRuntimeAssembly(input);
      if (prepared.status === "ready") { const node: string = prepared.assembly.render(prepared.assembly.snapshot.cells[0]!); }
      const evidence: Promise<RuntimeEvidenceResult> = runRuntimeAssemblyEvidence(input, runner);
      const content = ports.resolveContent({kind:"copy",ref:"example.title"});
    `;
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist/catalog-core/index.js"))}; process.stdout.write(JSON.stringify([typeof api.prepareRuntimeAssembly,typeof api.runRuntimeAssemblyEvidence,typeof api.validateRuntimeAssemblyEvidence,typeof api.checkConsumerRuntimePorts]));`;
    expect(JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot }))).toEqual(["function", "function", "function", "function"]);
    // Run bundler tooling in native Node; the surrounding suite uses a DOM realm.
    const browserScript = `import { build } from "esbuild"; const bundle = await build({ entryPoints: [${JSON.stringify(join(packageRoot, "src/catalog-core/index.ts"))}], bundle: true, write: false, platform: "browser", format: "esm", metafile: true, logLevel: "silent" }); process.stdout.write(JSON.stringify({ inputs: Object.keys(bundle.metafile.inputs), imports: Object.values(bundle.metafile.outputs).flatMap(output => output.imports) }));`;
    const browser = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", browserScript], { encoding: "utf8", cwd: packageRoot }));
    expect(browser.inputs.some((path: string) => /(?:^|\/)(?:react|react-dom|publisher)(?:\/|$)/.test(path))).toBe(false);
    expect(browser.imports).toEqual([]);
  }, 30_000);
});

describe("compiled usage graph public contract", () => {
  it("exports the usage graph API additively through catalog and catalog/server", () => {
    for (const entry of ["catalog-core/index.js", "catalog-core/server.js"]) {
      const filename = join(packageRoot, "usage-graph-consumer.check.ts");
      const consumer = `
        import { buildUsageGraph, uses, usedBy, closure, graphFindings, type UsageGraph, type UsageGraphInputs, type UsageEdge, type UsageNode, type UsageGraphFinding } from ${JSON.stringify(join(packageRoot, "dist", entry))};
        const input: UsageGraphInputs = { inventory: { themes: ["themes.color"], components: ["components.button"] }, selection: { "components.button": "example/components.button" },
          components: { fills: [{ id: "example/components.button", slot: "components.button", declaredReads: { themes: ["themes.color"], assets: [] } }] } };
        const graph: UsageGraph = buildUsageGraph(input);
        const out: readonly UsageEdge[] = uses(graph, "components.button"), into: readonly UsageEdge[] = usedBy(graph, "themes.color");
        const reach: readonly string[] = closure(graph, "themes.color", "usedBy");
        const findings: readonly UsageGraphFinding[] = graphFindings(graph);
        const node: UsageNode | undefined = graph.nodes[0];
        void out; void into; void reach; void findings; void node;
      `;
      const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
      const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
      host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
      expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), entry).toEqual([]);
      const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))};
        const graph = api.buildUsageGraph({ inventory: { themes: ["themes.color"], components: ["components.button"] }, selection: { "components.button": "example/components.button" }, components: { fills: [{ id: "example/components.button", slot: "components.button", declaredReads: { themes: ["themes.color"], assets: [] } }] } });
        process.stdout.write(JSON.stringify({ types: ["buildUsageGraph","uses","usedBy","closure","graphFindings"].map(name => typeof api[name]), usedBy: api.usedBy(graph, "themes.color").map(edge => edge.from), closure: api.closure(graph, "themes.color", "usedBy") }));`;
      expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot })), entry).toEqual({ types: Array(5).fill("function"), usedBy: ["components.button"], closure: ["components.button"] });
    }
  }, 30_000);
});

describe("compiled wiring public contract", () => {
  it("exports the static wiring checks additively through catalog and catalog/server", () => {
    for (const entry of ["catalog-core/index.js", "catalog-core/server.js"]) {
      const filename = join(packageRoot, "wiring-consumer.check.ts");
      const consumer = `
        import { checkWiring, readWiringExceptions, wiringScope, foundryWiringExceptions, WIRING_REASON_CODES, WIRING_HEADLESS_MODULES, type WiringInput, type WiringResult, type WiringFinding, type WiringException, type WiringCode, type WiringReasonCode } from ${JSON.stringify(join(packageRoot, "dist", entry))};
        const input: WiringInput = { sources: [{ path: "frames/a.tsx", content: "export const A = 1;", layer: "frames" }], themes: [], exceptions: foundryWiringExceptions(), now: "2026-10-26" };
        const result: WiringResult = checkWiring(input);
        const findings: readonly WiringFinding[] = result.findings, code: WiringCode | undefined = findings[0]?.code;
        const rows: readonly WiringException[] = readWiringExceptions([], [], "2026-10-26").exceptions.map(row => row.row);
        const reason: WiringReasonCode = WIRING_REASON_CODES[0], scope: "components" | "above" = wiringScope("frames/a.tsx", []);
        const engines: readonly string[] = WIRING_HEADLESS_MODULES;
        void code; void rows; void reason; void scope; void engines;
      `;
      const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
      const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
      host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
      expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), entry).toEqual([]);
      const script = `import * as api from ${JSON.stringify(join(packageRoot, "dist", entry))};
        const result = api.checkWiring({ sources: [{ path: "frames/a.tsx", content: "import { Button } from \\"react-aria-components\\";", layer: "frames" }], themes: [], exceptions: api.foundryWiringExceptions(), now: "2026-10-26" });
        process.stdout.write(JSON.stringify({ types: ["checkWiring","readWiringExceptions","wiringScope","foundryWiringExceptions"].map(name => typeof api[name]), codes: result.findings.map(row => row.code), reasons: api.WIRING_REASON_CODES }));`;
      expect(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", cwd: packageRoot })), entry).toEqual({ types: Array(4).fill("function"), codes: ["WL3"], reasons: ["layout-geometry", "surface-ground", "document-head", "motion-orchestration"] });
    }
  }, 30_000);
});
