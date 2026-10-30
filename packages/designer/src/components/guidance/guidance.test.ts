import { describe, expect, it } from "vitest";
import componentIA from "../../catalog/ia/components.json" with { type: "json" };
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import * as components from "../index.js";
import * as catalog from "../../catalog-core/index.js";
import { TOKENS } from "../../tokens/tokens.js";
import { RENDER_ENVIRONMENT } from "../../render-environment.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
// Start through the existing namespace: absent additions fail assertions in RED.
const additions = components as unknown as {
  COMPONENT_GUIDANCE?: Record<string, any>;
  COMPONENT_API_FACTS?: Record<string, any>;
};
const guidance = () => additions.COMPONENT_GUIDANCE ?? {};
const facts = () => additions.COMPONENT_API_FACTS ?? {};
const groups = () => catalog.COMPONENT_DISPLAY_TREE;
const exportedComponents = (layer: string) => {
  const path = join(root, `src/${layer}/index.ts`);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true);
  return source.statements.flatMap(statement => {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) return [];
    return statement.exportClause.elements.filter(item => !item.isTypeOnly && /^[A-Z][a-zA-Z]+$/.test(item.name.text) && item.name.text !== "ChartFrame").map(item => item.name.text);
  });
};


const literal = (node: ts.Expression): string | number | boolean | undefined => {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
};
function initializers(source: ts.SourceFile, prop: string): (string | number | boolean)[] {
  const values: (string | number | boolean)[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText(source).replaceAll('"', "") === prop && node.initializer) {
      const value = literal(node.initializer);
      if (value !== undefined) values.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

function matches(condition: any, values: Record<string, unknown>): boolean {
  if (condition.any) return condition.any.some((part: any) => matches(part, values));
  if (condition.all) return condition.all.every((part: any) => matches(part, values));
  if ("present" in condition) return (values[condition.prop] !== undefined) === condition.present;
  return condition.values.includes(values[condition.prop]);
}
function effective(rule: any, values: Record<string, unknown>): boolean {
  if (!rule.effectiveWhen) throw new Error("An applicability rule must declare its condition.");
  return matches(rule.effectiveWhen, values);
}

describe("shared component guidance", () => {
  it("keeps runtime data import-free while the existing components barrel remains client-only", () => {
    const path = join(root, "src/components/guidance/internal/data.ts");
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true);
    const imports: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || node.kind === ts.SyntaxKind.ImportKeyword) imports.push(node.getText(source));
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(imports).toEqual([]);
    expect(RENDER_ENVIRONMENT["./components"]).toBe("client-only");
  });
  it("covers real exported component and chart leaves bidirectionally with stable IDs", () => {
    expect(additions.COMPONENT_GUIDANCE).toBeDefined();
    expect(additions.COMPONENT_API_FACTS).toBeDefined();
    const components = [...exportedComponents("components"), ...exportedComponents("charts")].sort();
    expect(components).toHaveLength(46);
    expect(Object.values(facts()).map(fact => fact.exportName).sort()).toEqual(components);
    expect(Object.keys(guidance()).sort()).toEqual(Object.keys(facts()).sort());
    const legacy = { ResizeHandle: "enter", Button: "act", IconButton: "act", Link: "act", Breadcrumb: "act", Menu: "act", TextField: "enter", Textarea: "enter", SearchField: "enter", DateField: "enter", Select: "enter", ComboBox: "enter", Checkbox: "enter", Switch: "enter", RadioGroup: "enter", FileTrigger: "enter", Field: "enter", Badge: "inform", Banner: "inform", Chip: "inform", StatusMark: "inform", Meter: "inform", ProgressBar: "inform", Spinner: "inform", Skeleton: "inform", Card: "group", Table: "group", GridList: "group", Separator: "group", Avatar: "depict", Icon: "depict", Dialog: "reveal", Popover: "reveal", Tooltip: "reveal", Disclosure: "reveal", Tabs: "reveal" };
    for (const [id, fact] of Object.entries(facts())) {
      const prefix = legacy[fact.exportName as keyof typeof legacy] ?? "depict";
      expect(id).toBe(`${prefix}.${fact.exportName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`);
    }
  });

  it("uses canonical IA navigation alongside pinned legacy selection metadata", () => {
    expect(groups()).toEqual(componentIA.nodes);
    const leaves = groups().flatMap(group => group.children.flatMap((family: any) => family.leaves));
    expect(new Set(leaves).size).toBe(leaves.length);
    expect(catalog.componentSelection("components.button")?.facts).toBe(facts()["act.button"]);
    expect(catalog.componentSelection("act.icon-button")?.facts).toBe(facts()["act.icon-button"]);
  });

  it("gives each component meaningful stable semantics separate from web implementation", () => {
    expect(Object.keys(guidance())).toHaveLength(46);
    for (const field of ["purpose", "useWhen", "avoidWhen", "alternatives", "content", "anatomy", "composition", "accessibility"]) {
      const values = Object.values(guidance()).map(entry => entry[field]);
      expect(values.every(value => typeof value === "string" && value.trim().length > 24), field).toBe(true);
      expect(new Set(values).size, field).toBe(46);
    }
    for (const entry of Object.values(guidance())) {
      expect(entry).not.toHaveProperty("props");
      expect(entry).not.toHaveProperty("default");
      expect(entry.demonstration.state).toBe("unassessed");
      expect(entry.demonstration.reason).toMatch(/consumer/i);
    }
  });

  it("records implementation evidence or explicit assessment absence for each medium", () => {
    expect(Object.keys(guidance())).toHaveLength(46);
    for (const [id, entry] of Object.entries(guidance())) {
      expect(Object.keys(entry.media)).toEqual(["web", "email", "print", "video"]);
      for (const [medium, mediumEntry] of Object.entries(entry.media) as [string, any][]) {
        expect(["implemented", "planned", "unsupported", "not-applicable", "unassessed"]).toContain(mediumEntry.state);
        expect(mediumEntry.reason.trim().length, `${id}/${medium}`).toBeGreaterThan(20);
        expect(mediumEntry.evidence.length, `${id}/${medium}`).toBeGreaterThan(0);
        expect(mediumEntry.evidence.every((item: string) => item.trim().length > 15)).toBe(true);
        if (medium === "web") {
          expect(mediumEntry.state).toBe("implemented");
          expect(mediumEntry.evidence).toContain(facts()[id].source);
          expect(mediumEntry.implementation.exportName).toBe(facts()[id].exportName);
        } else {
          expect(mediumEntry.state).toBe("unassessed");
          expect(mediumEntry.implementation).toBeUndefined();
          expect(mediumEntry.evidence.join(" ")).toMatch(/no non-web implementation evidence/);
        }
      }
    }
  });

  it("checks represented option names and complete finite value sets against real TypeScript props", () => {
    expect(Object.keys(facts())).toHaveLength(46);
    const paths = Object.values(facts()).map(fact => join(root, fact.source));
    const filename = join(root, "component-guidance-consumer.check.ts");
    const consumer = `
      import type {IconProps, IconNode, ChipProps} from ${JSON.stringify(join(root, "src/components/index.js"))};
      declare const glyph: IconNode;
      const decorative: IconProps = {glyph, decorative: true};
      const labelled: IconProps = {glyph, label: "Search"};
      const innerMarkup: IconProps = {children: "Markup", label: "Symbol"};
      const removable: ChipProps = {children: "Filter", onRemove: () => {}, removeLabel: "Remove Filter"};
      const staticChip: ChipProps = {children: "Filter"};
      const unnamed: IconProps = {glyph};
      const conflictingName: IconProps = {glyph, decorative: true, label: "Search"};
      const conflictingContent: IconProps = {glyph, children: "Markup", decorative: true};
      const missingContent: IconProps = {label: "Search"};
      const unnamedRemoval: ChipProps = {children: "Filter", onRemove: () => {}};
    `;
    const compilerOptions = { strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = ts.createCompilerHost(compilerOptions);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, consumer, language, true) : original(path, language, error, fresh);
    const program = ts.createProgram([...paths, filename], compilerOptions, host);
    const checker = program.getTypeChecker();
    const consumerSource = program.getSourceFile(filename)!;
    const diagnostics = program.getSemanticDiagnostics(consumerSource);
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([2322, 2322, 2322, 2322, 2322]);
    expect(diagnostics.map(diagnostic => consumerSource.text.slice(diagnostic.start!, diagnostic.start! + diagnostic.length!))).toEqual(["unnamed", "conflictingName", "conflictingContent", "missingContent", "unnamedRemoval"]);
    for (const [id, fact] of Object.entries(facts())) {
      const source = program.getSourceFile(join(root, fact.source))!;
      const symbol = checker.getSymbolAtLocation(source)!;
      const props = checker.getExportsOfModule(symbol).find(item => item.name === `${fact.exportName}Props`)!;
      expect(props, id).toBeDefined();
      const type = checker.getDeclaredTypeOfSymbol(props);
      const forwardingSources = new Set([source.fileName]);
      for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith(".")) {
          const resolved = ts.resolveModuleName(statement.moduleSpecifier.text, source.fileName, program.getCompilerOptions(), ts.sys).resolvedModule;
          if (resolved) forwardingSources.add(resolved.resolvedFileName);
        }
      }
      for (const rule of guidance()[id].media.web.implementation.constraints) {
        for (const prop of rule.props) expect(checker.getPropertyOfType(type, prop), `${id} constraint ${prop}`).toBeDefined();
        expect(readFileSync(join(root, rule.evidence.source), "utf8")).toContain(rule.evidence.evidence);
      }
      const options = guidance()[id].media.web.implementation.options;
      expect(options.map((option: any) => option.prop).sort()).toEqual(fact.options.map((option: any) => option.prop).sort());
      for (const option of fact.options) {
        const property = checker.getPropertyOfType(type, option.prop);
        expect(property, `${id}.${option.prop}`).toBeDefined();
        const actual = checker.getTypeOfSymbolAtLocation(property!, source);
        const members = actual.isUnion() ? actual.types : [actual];
        const values = members.filter(member => !(member.flags & ts.TypeFlags.Undefined)).map(member => {
          if (member.isStringLiteral() || member.isNumberLiteral()) return member.value;
          if (member.flags & ts.TypeFlags.BooleanLiteral) return (member as any).intrinsicName === "true";
          throw new Error(`${id}.${option.prop}: represented options must have finite scalar values, received ${checker.typeToString(member)}`);
        });
        expect([...option.values].sort(), `${id}.${option.prop}`).toEqual(values.sort());
        expect(options.find((item: any) => item.prop === option.prop).values.map((item: any) => item.value).sort()).toEqual(values.sort());
        expect(option.forwarding.evidence.trim().length, `${id}.${option.prop} source evidence`).toBeGreaterThan(0);
        const body = readFileSync(join(root, option.forwarding.source), "utf8");
        expect(body, `${id}.${option.prop} forwarding`).toContain(option.forwarding.evidence);
        if (option.default.kind === "value") {
          expect(option.values).toContain(option.default.value);
          expect(readFileSync(join(root, option.default.source), "utf8")).toContain(option.default.evidence);
          const defaultSource = program.getSourceFile(join(root, option.default.source))!;
          expect(initializers(defaultSource, option.prop), `${id}.${option.prop} actual initializer`).toEqual([option.default.value]);
        } else {
          expect(["required", "omitted", "peer", "conditional"]).toContain(option.default.kind);
          expect(initializers(source, option.prop), `${id}.${option.prop} must not invent a default`).toEqual([]);
          if (option.default.kind === "required") expect(property!.flags & ts.SymbolFlags.Optional, `${id}.${option.prop} is required`).toBe(0);
        }
        const forwardingSource = program.getSourceFile(join(root, option.forwarding.source))!;
        expect(forwardingSources.has(forwardingSource.fileName), `${id}.${option.prop} forwarding must belong to this component or an imported helper`).toBe(true);
        let directlyConsumed = false, restForwarded = false, bound = false;
        const visit = (node: ts.Node) => {
          if (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText(forwardingSource) === option.prop) bound = true;
          if (ts.isIdentifier(node) && node.text === option.prop && !ts.isBindingElement(node.parent) && !ts.isPropertySignature(node.parent) && !ts.isPropertyAccessExpression(node.parent)) directlyConsumed = true;
          if (ts.isJsxSpreadAttribute(node) && node.expression.getText(forwardingSource) === "rest") restForwarded = true;
          ts.forEachChild(node, visit);
        };
        visit(forwardingSource);
        expect(directlyConsumed || (!bound && restForwarded), `${id}.${option.prop} must be consumed or forwarded`).toBe(true);
      }
    }
  });

  it("links token dependencies to consumed source evidence with explicit coverage", () => {
    expect(Object.keys(facts())).toHaveLength(46);
    for (const [id, fact] of Object.entries(facts())) {
      expect(["partial", "none-owned"]).toContain(fact.tokens.coverage);
      expect(fact.tokens.reason.length).toBeGreaterThan(20);
      for (const token of fact.tokens.dependencies) {
        expect(["direct", "transitive"]).toContain(token.kind);
        expect(readFileSync(join(root, token.source), "utf8"), id).toContain(token.evidence);
        expect(token.property).toMatch(/^--/);
        expect(Object.hasOwn(TOKENS, token.property), `${id} uses a real token identity`).toBe(true);
        const tokenSource = readFileSync(join(root, token.source), "utf8");
        expect(token.evidence, `${id}: evidence must name the same token`).toContain(token.property);
        if (token.property === "--color-chart-categorical-1") {
          expect(tokenSource).toContain("const slot = index + 1;");
          expect(tokenSource).toContain('TOKENS["--color-chart-categorical-1"]');
        } else {
          expect(tokenSource).toContain(token.property);
        }
        if (token.kind === "transitive") {
          expect(token.via.length).toBeGreaterThan(0);
          for (const edge of token.via) expect(readFileSync(join(root, edge.source), "utf8")).toContain(edge.evidence);
        }
      }
      if (fact.tokens.coverage === "partial") expect(fact.tokens.dependencies.length, id).toBeGreaterThan(0);
    }
  });

  it("distinguishes ineffective accepted combinations from type and runtime-invalid input", () => {
    const rules = (id: string) => guidance()[id].media.web.implementation.constraints;
    const find = (id: string, prop: string) => rules(id).find((rule: any) => rule.props[0] === prop);
    expect(find("act.button", "ground").enforcement).toBe("ignored");
    for (const variant of ["primary", "secondary", "ghost", "danger", "outline"]) expect(effective(find("act.button", "ground"), { variant })).toBe(false);
    for (const variant of ["tonal", "quiet"]) expect(effective(find("act.button", "ground"), { variant })).toBe(true);
    expect(effective(find("act.button", "trailingIcon"), { variant: "quiet" })).toBe(true);
    expect(effective(find("act.button", "trailingIcon"), { variant: "tonal" })).toBe(false);
    expect(effective(find("group.card", "ground"), { variant: "raised" })).toBe(false);
    for (const variant of ["plate", "outline"]) expect(effective(find("group.card", "ground"), { variant })).toBe(true);
    expect(effective(find("inform.meter", "direction"), {})).toBe(false);
    expect(effective(find("inform.meter", "direction"), { limit: 0 })).toBe(true);
    expect(effective(find("act.link", "variant"), {})).toBe(true);
    expect(effective(find("act.link", "variant"), { buttonVariant: "quiet" })).toBe(false);
    expect(effective(find("act.link", "variant"), { buttonSize: "sm" })).toBe(false);
    expect(find("inform.meter", "previous")).toMatchObject({ kind: "paired", props: ["previous", "previousText"], enforcement: "runtime" });
    expect(find("inform.chip", "onRemove")).toMatchObject({ kind: "requires", props: ["onRemove", "removeLabel"], enforcement: "type" });
    expect(find("depict.icon", "decorative")).toMatchObject({ kind: "exclusive", props: ["decorative", "label"], enforcement: "type" });
    expect(find("depict.icon", "glyph")).toMatchObject({ kind: "exclusive", props: ["glyph", "children"], enforcement: "type" });
    expect(find("depict.icon", "glyph").presence).toBe("exactly-one");
    expect(matches(find("depict.icon", "decorative").when, { decorative: true })).toBe(true);
    expect(find("depict.icon", "decorative").excludes).toEqual(["label"]);
    expect(matches(find("depict.icon", "label").when, {})).toBe(true);
    expect(matches(find("depict.icon", "label").when, { decorative: false })).toBe(true);
    expect(matches(find("depict.icon", "label").when, { decorative: true })).toBe(false);
    expect(find("depict.icon", "label").requires).toEqual(["label"]);
    for (const [id, prop] of [["inform.banner", "variant"], ["inform.status-mark", "tone"]]) expect(find(id, prop).enforcement).toBe("derived");
    for (const id of ["reveal.tabs", "enter.radio-group"]) expect(guidance()[id].media.web.implementation.options.find((option: any) => option.prop === "orientation").support.state).toBe("implemented");
    const meter = { value: 5, scaleMax: 10, tone: "neutral" as const, valueText: "5" };
    expect(() => components.Meter({ ...meter, direction: "min" })).not.toThrow();
    expect(() => components.Meter({ ...meter, previous: 2 })).toThrow(/together/);
    expect(() => components.Meter({ ...meter, previousText: "Previously 2" })).toThrow(/together/);
    expect(() => components.Meter({ ...meter, previous: 11, previousText: "Previously 11" })).toThrow(/within the scale/);
    expect(() => components.Meter({ ...meter, previous: 2, previousText: "Previously 2" })).not.toThrow();
  });

  it("keeps literal pipe evidence in ordinary Markdown code spans", () => {
    const text = readFileSync(join(root, "skill/components-guide.md"), "utf8");
    const evidence = guidance()["act.link"].media.web.implementation.constraints[0].evidence.evidence;
    expect(evidence).toContain(" || ");
    expect(text).toContain("`" + evidence + "`");
    expect(text).not.toContain("&#124;");
  });

  it("escapes GFM table pipes while retaining long code fences", () => {
    const moduleUrl = pathToFileURL(join(root, "../../scripts/generate-component-docs.mjs")).href;
    const inputs = ["left|right", "return `value|\ntail"];
    const script = 'const { tableCode } = await import(process.argv[1]); const inputs = JSON.parse(process.argv[2]); process.stdout.write(JSON.stringify({ kind: typeof tableCode, values: typeof tableCode === "function" ? inputs.map(tableCode) : [] }));';
    const output = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", script, moduleUrl, JSON.stringify(inputs)], { encoding: "utf8" }));
    expect(output.kind).toBe("function");
    expect(output.values).toEqual(["`left\\|right`", "``return `value\\| tail``"]);
  });

  it("covers each leaf once in the generated guide", () => {
    const text = readFileSync(join(root, "skill/components-guide.md"), "utf8");
    const ids = [...text.matchAll(/^##### `([^`]+)`/gm)].map(match => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.keys(guidance()).sort());
    const categoricalEvidence = facts()["depict.sparkline"].tokens.dependencies[0].evidence;
    expect(categoricalEvidence).toContain("--color-chart-categorical-1");
    expect(text).toContain("`" + categoricalEvidence + "`");
  });
});

// This test-only evaluator implements the documented skip policy. Other rules
// remain authoring guidance, not reasons to exclude a comparison cell.
function comparisonViolations(rules: readonly any[], values: Record<string, unknown>) {
  const present = (prop: string) => values[prop] !== undefined;
  return rules.filter(rule => {
    if (!["requires", "exclusive", "paired"].includes(rule.kind)) return false;
    if (rule.when && !matches(rule.when, values)) return false;
    if (rule.kind === "paired") {
      const count = rule.props.filter(present).length;
      return count > 0 && count < rule.props.length;
    }
    if (rule.kind === "requires") return rule.requires.some((prop: string) => !present(prop));
    if (rule.kind === "exclusive") {
      if (rule.presence === "exactly-one") return rule.props.filter(present).length !== 1;
      return rule.excludes.some(present);
    }
    return false;
  });
}

function comparisonCells(comparison: any): Record<string, unknown>[] {
  return comparison.columns.values.flatMap((column: unknown) => {
    const cell = { [comparison.columns.option]: column };
    return comparison.rows
      ? comparison.rows.values.map((row: unknown) => ({ ...cell, [comparison.rows.option]: row }))
      : [cell];
  });
}

// Deliberate preference pins: changing a valid finite option still changes this contract.
const comparisonGolden: Record<string, {
  columns: { option: string; values: (string | number | boolean)[] };
  rows?: { option: string; values: (string | number | boolean)[] };
  maxCells: number;
  retainedCells: number;
}> = {
  "act.button": {
    columns: {"option": "variant", "values": ["primary", "secondary", "ghost", "danger", "outline", "tonal", "quiet"]},
    rows: {"option": "size", "values": ["sm", "md", "lg"]},
    maxCells: 21,
    retainedCells: 21,
  },
  "act.icon-button": {
    columns: {"option": "shape", "values": ["circle", "square"]},
    rows: {"option": "size", "values": ["sm", "md"]},
    maxCells: 4,
    retainedCells: 4,
  },
  "act.link": {
    columns: {"option": "variant", "values": ["default", "muted", "standalone"]},
    maxCells: 3,
    retainedCells: 3,
  },
  "act.menu": {
    columns: {"option": "triggerAction", "values": ["press", "longPress", "contextMenu"]},
    maxCells: 3,
    retainedCells: 3,
  },
  "enter.text-field": {
    columns: {"option": "isInvalid", "values": [false, true]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.textarea": {
    columns: {"option": "isInvalid", "values": [false, true]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.search-field": {
    columns: {"option": "isInvalid", "values": [false, true]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.date-field": {
    columns: {"option": "isInvalid", "values": [false, true]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.select": {
    columns: {"option": "isInvalid", "values": [false, true]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.combo-box": {
    columns: {"option": "isInvalid", "values": [false, true]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.checkbox": {
    columns: {"option": "isSelected", "values": [false, true]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.switch": {
    columns: {"option": "isSelected", "values": [false, true]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.radio-group": {
    columns: {"option": "orientation", "values": ["horizontal", "vertical"]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.file-trigger": {
    columns: {"option": "allowsMultiple", "values": [false, true]},
    rows: {"option": "defaultCamera", "values": ["user", "environment"]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.field": {
    columns: {"option": "isRequired", "values": [false, true]},
    rows: {"option": "isInvalid", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "enter.resize-handle": {
    columns: {"option": "orientation", "values": ["vertical", "horizontal"]},
    rows: {"option": "dir", "values": ["ltr", "rtl"]},
    maxCells: 4,
    retainedCells: 4,
  },
  "inform.badge": {
    columns: {"option": "variant", "values": ["default", "secondary", "destructive", "outline", "ghost", "link"]},
    maxCells: 6,
    retainedCells: 6,
  },
  "inform.banner": {
    columns: {"option": "variant", "values": ["info", "success", "warning", "danger"]},
    maxCells: 4,
    retainedCells: 4,
  },
  "inform.chip": {
    columns: {"option": "isDisabled", "values": [false, true]},
    maxCells: 2,
    retainedCells: 2,
  },
  "inform.status-mark": {
    columns: {"option": "tone", "values": ["success", "warning", "danger", "info", "neutral"]},
    maxCells: 5,
    retainedCells: 5,
  },
  "inform.meter": {
    columns: {"option": "tone", "values": ["success", "warning", "danger", "info", "neutral", "accent"]},
    rows: {"option": "emphasis", "values": ["default", "figure"]},
    maxCells: 12,
    retainedCells: 12,
  },
  "inform.progress-bar": {
    columns: {"option": "isIndeterminate", "values": [false, true]},
    maxCells: 2,
    retainedCells: 2,
  },
  "inform.spinner": {
    columns: {"option": "size", "values": ["sm", "md", "lg"]},
    maxCells: 3,
    retainedCells: 3,
  },
  "inform.skeleton": {
    columns: {"option": "shape", "values": ["text", "block", "circle"]},
    maxCells: 3,
    retainedCells: 3,
  },
  "group.card": {
    columns: {"option": "variant", "values": ["raised", "plate", "outline"]},
    maxCells: 3,
    retainedCells: 3,
  },
  "group.table": {
    columns: {"option": "selectionMode", "values": ["none", "single", "multiple"]},
    maxCells: 3,
    retainedCells: 3,
  },
  "group.separator": {
    columns: {"option": "orientation", "values": ["horizontal", "vertical"]},
    rows: {"option": "decorative", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "depict.avatar": {
    columns: {"option": "size", "values": ["sm", "md", "lg"]},
    maxCells: 3,
    retainedCells: 3,
  },
  "depict.icon": {
    columns: {"option": "size", "values": ["sm", "md", "lg"]},
    maxCells: 3,
    retainedCells: 3,
  },
  "depict.logomark": {
    columns: {"option": "plate", "values": ["shared", "self"]},
    rows: {"option": "size", "values": ["sm", "md", "lg"]},
    maxCells: 6,
    retainedCells: 6,
  },
  "reveal.dialog": {
    columns: {"option": "size", "values": ["sm", "md", "lg"]},
    rows: {"option": "isDismissable", "values": [false, true]},
    maxCells: 6,
    retainedCells: 6,
  },
  "reveal.tooltip": {
    columns: {"option": "triggerAction", "values": ["hover", "focus"]},
    maxCells: 2,
    retainedCells: 2,
  },
  "reveal.tabs": {
    columns: {"option": "orientation", "values": ["horizontal", "vertical"]},
    rows: {"option": "isDisabled", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "depict.bar-chart": {
    columns: {"option": "fit", "values": ["fixed", "fluid"]},
    rows: {"option": "marks", "values": ["interactive", "static"]},
    maxCells: 4,
    retainedCells: 4,
  },
  "depict.waterfall-chart": {
    columns: {"option": "fit", "values": ["fixed", "fluid"]},
    maxCells: 2,
    retainedCells: 2,
  },
  "depict.range-chart": {
    columns: {"option": "fit", "values": ["fixed", "fluid"]},
    maxCells: 2,
    retainedCells: 2,
  },
  "depict.scatter-chart": {
    columns: {"option": "fit", "values": ["fixed", "fluid"]},
    maxCells: 2,
    retainedCells: 2,
  },
  "depict.area-chart": {
    columns: {"option": "normalized", "values": [false, true]},
    rows: {"option": "smooth", "values": [false, true]},
    maxCells: 4,
    retainedCells: 4,
  },
  "depict.heatmap": {
    columns: {"option": "categorical", "values": [false, true]},
    maxCells: 2,
    retainedCells: 2,
  },
};

describe("finite component comparisons", () => {
  const comparisons = () => (components as unknown as { COMPONENT_COMPARISON?: Record<string, any> }).COMPONENT_COMPARISON;

  it("declares a nonempty comparison exactly for leaves with finite options", () => {
    expect(comparisons()).toBeDefined();
    const finiteIds = Object.entries(facts()).filter(([, fact]) => fact.options.length > 0).map(([id]) => id);
    expect(Object.keys(comparisons()!).sort()).toEqual(finiteIds.sort());
    for (const [id, comparison] of Object.entries(comparisons()!)) {
      expect(comparison.columns, id).toBeDefined();
      expect(comparison.columns.values.length, id).toBeGreaterThan(0);
    }
  });

  it("pins every preferred axis, ordered value, exact budget and retained count", () => {
    expect(Object.keys(comparisons()!).sort()).toEqual(Object.keys(comparisonGolden).sort());
    for (const [id, expected] of Object.entries(comparisonGolden)) {
      const comparison = comparisons()![id];
      expect(comparison.columns, id).toEqual(expected.columns);
      expect(comparison.rows, id).toEqual(expected.rows);
      expect(comparison.maxCells, id).toBe(expected.maxCells);
      // Supply Icon's non-axis content/name; other forbidding rules are inactive
      // when their optional authored inputs are absent in this finite-axis fixture.
      const authored = id === "depict.icon" ? { glyph: [], label: "Search" } : {};
      const retained = comparisonCells(comparison).filter(cell =>
        comparisonViolations(comparison.constraints, { ...cell, ...authored }).length === 0);
      expect(retained.length, id).toBe(expected.retainedCells);
      for (const axis of [comparison.columns, ...(comparison.rows ? [comparison.rows] : [])]) {
        const option = facts()[id].options.find((candidate: any) => candidate.prop === axis.option);
        if (option.default.kind === "value") {
          expect(axis.values, `${id}.${axis.option} default`).toContain(option.default.value);
          expect(retained.some(cell => cell[axis.option] === option.default.value), id).toBe(true);
        }
      }
    }
  });

  it("retains Card's raised default and Link's three text appearances", () => {
    const card = comparisons()!["group.card"];
    expect(comparisonCells(card)).toEqual([{ variant: "raised" }, { variant: "plate" }, { variant: "outline" }]);
    expect(comparisonCells(comparisons()!["act.link"])).toEqual([
      { variant: "default" }, { variant: "muted" }, { variant: "standalone" },
    ]);
    expect(comparisonViolations(card.constraints, { variant: "raised", ground: "base" })).toEqual([]);
  });

  it("never excludes cells for applicability, derivation or data guidance", () => {
    const fixtures = [
      ["act.button", { variant: "primary", ground: "base", trailingIcon: null }],
      ["act.link", { variant: "muted", buttonVariant: "primary" }],
      ["group.card", { variant: "raised", ground: "base" }],
      ["inform.meter", { direction: "higher-is-better" }],
      ["inform.banner", { variant: "danger" }],
      ["inform.status-mark", { tone: "warning" }],
      ["enter.resize-handle", { value: Number.NaN }],
    ] as const;
    for (const [id, values] of fixtures) {
      expect(comparisonViolations(comparisons()![id].constraints, values), id).toEqual([]);
    }
    // A retained cell still requires valid authored inputs; data validation is
    // distinct from this policy and is not provided by comparison metadata.
  });

  it("documents the same forbidding-only policy on every consumer surface", () => {
    for (const file of ["README.md", "skill/SKILL.md", "skill/components-guide.md"]) {
      const text = readFileSync(join(root, file), "utf8");
      expect(text, file).toContain('`constraintPolicy: "skip-violations"`');
      expect(text, file).toContain("only `requires`, `exclusive` and `paired`");
      expect(text, file).toContain("never skip");
    }
  });

  it("uses only existing finite axes and values with a bounded cell budget", () => {
    expect(comparisons()).toBeDefined();
    for (const [id, comparison] of Object.entries(comparisons()!)) {
      const axes = [comparison.columns, ...(comparison.rows ? [comparison.rows] : [])];
      expect(new Set(axes.map(axis => axis.option)).size, id).toBe(axes.length);
      for (const axis of axes) {
        const option = facts()[id].options.find((candidate: any) => candidate.prop === axis.option);
        expect(option, `${id}.${axis.option} must be a source-checked finite option`).toBeDefined();
        expect(axis.values).not.toBe(option.values);
        expect(Object.isFrozen(option.values), id).toBe(false);
        expect(axis.values.length, id).toBeGreaterThan(0);
        expect(new Set(axis.values).size, id).toBe(axis.values.length);
        for (const value of axis.values) {
          expect(["string", "number", "boolean"]).toContain(typeof value);
          expect(option.values, `${id}.${axis.option}`).toContain(value);
          if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
        }
      }
      expect(Number.isInteger(comparison.maxCells), id).toBe(true);
      expect(comparison.maxCells, id).toBeLessThanOrEqual(24);
      expect(comparison.maxCells, id).toBe(comparisonCells(comparison).length);
    }
  });

  it("retains original constraint references without freezing existing metadata", () => {
    expect(comparisons()).toBeDefined();
    expect(Object.isFrozen(comparisons())).toBe(true);
    for (const [id, comparison] of Object.entries(comparisons()!)) {
      const rules = guidance()[id].media.web.implementation.constraints;
      expect(comparison.constraints, id).toBe(rules);
      expect(comparison.constraintPolicy, id).toBe("skip-violations");
      expect(Object.isFrozen(comparison), id).toBe(true);
      for (const axis of [comparison.columns, ...(comparison.rows ? [comparison.rows] : [])]) {
        expect(Object.isFrozen(axis), id).toBe(true);
        expect(Object.isFrozen(axis.values), id).toBe(true);
      }
      expect(Object.isFrozen(rules), id).toBe(false);
      for (const rule of rules) expect(Object.isFrozen(rule), id).toBe(false);
    }
  });

  it("flags concrete non-axis Icon, Chip and Meter violations from retained rules", () => {
    expect(comparisons()).toBeDefined();
    const fixtures: { id: string; valid: Record<string, unknown>[]; invalid: { values: Record<string, unknown>; kinds: string[] }[] }[] = [
      {
        id: "depict.icon",
        valid: [{ glyph: [], decorative: true }, { glyph: [], label: "Search" }, { children: "Markup", label: "Symbol" }],
        invalid: [
          { values: { glyph: [], decorative: true, label: "Search" }, kinds: ["exclusive"] },
          { values: { glyph: [], children: "Markup", decorative: true }, kinds: ["exclusive"] },
          { values: { decorative: true }, kinds: ["exclusive"] },
          { values: { glyph: [], decorative: false }, kinds: ["requires"] },
          { values: { glyph: [] }, kinds: ["requires"] },
        ],
      },
      {
        id: "inform.chip",
        valid: [{ children: "Filter" }, { children: "Filter", onRemove: () => {}, removeLabel: "Remove Filter" }],
        invalid: [{ values: { children: "Filter", onRemove: () => {} }, kinds: ["requires"] }],
      },
      {
        id: "inform.meter",
        valid: [
          { value: 5, scaleMax: 10, valueText: "5" },
          { value: 5, scaleMax: 10, valueText: "5", previous: 0, previousText: "Previously zero" },
        ],
        invalid: [
          { values: { value: 5, scaleMax: 10, valueText: "5", previous: 0 }, kinds: ["paired"] },
          { values: { value: 5, scaleMax: 10, valueText: "5", previousText: "Previously zero" }, kinds: ["paired"] },
        ],
      },
    ];
    for (const { id, valid, invalid } of fixtures) {
      const comparison = comparisons()![id];
      const rules = guidance()[id].media.web.implementation.constraints;
      for (const cell of comparisonCells(comparison)) {
        for (const authored of valid) {
          expect(comparisonViolations(comparison.constraints, { ...cell, ...authored }), id).toEqual([]);
        }
        for (const { values, kinds } of invalid) {
          const flagged = comparisonViolations(comparison.constraints, { ...cell, ...values });
          expect(flagged.map(rule => rule.kind), `${id} ${JSON.stringify(values)}`).toEqual(kinds);
          for (const rule of flagged) expect(rules).toContain(rule);
          expect(comparison.constraintPolicy).toBe("skip-violations");
        }
      }
    }
  });
});
