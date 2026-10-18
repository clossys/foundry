import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import * as atoms from "../index.js";
import { TOKENS } from "../../tokens/tokens.js";
import { RENDER_ENVIRONMENT } from "../../render-environment.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
// Start through the existing namespace: absent additions fail assertions in RED.
const additions = atoms as unknown as {
  ATOM_GUIDANCE?: Record<string, any>;
  ATOM_API_FACTS?: Record<string, any>;
  ATOM_DISPLAY_GROUPS?: readonly any[];
};
const guidance = () => additions.ATOM_GUIDANCE ?? {};
const facts = () => additions.ATOM_API_FACTS ?? {};
const groups = () => additions.ATOM_DISPLAY_GROUPS ?? [];
const exportedComponents = (layer: string) => {
  const path = join(root, `src/${layer}/index.ts`);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true);
  return source.statements.flatMap(statement => {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) return [];
    return statement.exportClause.elements.filter(item => !item.isTypeOnly && /^[A-Z][a-zA-Z]+$/.test(item.name.text) && item.name.text !== "ChartFrame").map(item => item.name.text);
  });
};
const expectedPartition = [
  ["Interaction", ["Actions", ["Button", "IconButton", "Menu"]], ["Navigation", ["Link", "Breadcrumb", "Tabs"]], ["Inputs", ["TextField", "Textarea", "SearchField", "DateField", "Select", "ComboBox", "Checkbox", "Switch", "RadioGroup", "FileTrigger", "Field"]]],
  ["Content", ["Data display", ["Badge", "Chip", "Meter", "Table"]], ["Imagery", ["Avatar", "Icon"]], ["Charts", ["BarChart", "LineChart", "Sparkline", "WaterfallChart", "RangeChart", "ScatterChart"]]],
  ["Feedback", ["Messages", ["Banner", "StatusMark"]], ["Progress and loading", ["ProgressBar", "Spinner", "Skeleton"]]],
  ["Containment", ["Structure", ["Card", "Separator", "Disclosure"]], ["Overlays", ["Dialog", "Popover", "Tooltip"]]],
];

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

describe("shared atom guidance", () => {
  it("keeps runtime data import-free while the existing atoms barrel remains client-only", () => {
    const path = join(root, "src/atoms/guidance/internal/data.ts");
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true);
    const imports: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || node.kind === ts.SyntaxKind.ImportKeyword) imports.push(node.getText(source));
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(imports).toEqual([]);
    expect(RENDER_ENVIRONMENT["./atoms"]).toBe("client-only");
  });
  it("covers real exported atom and chart leaves bidirectionally with stable IDs", () => {
    expect(additions.ATOM_GUIDANCE).toBeDefined();
    expect(additions.ATOM_API_FACTS).toBeDefined();
    const components = [...exportedComponents("atoms"), ...exportedComponents("charts")].sort();
    expect(components).toHaveLength(40);
    expect(Object.values(facts()).map(fact => fact.exportName).sort()).toEqual(components);
    expect(Object.keys(guidance()).sort()).toEqual(Object.keys(facts()).sort());
    const legacy = { Button: "act", IconButton: "act", Link: "act", Breadcrumb: "act", Menu: "act", TextField: "enter", Textarea: "enter", SearchField: "enter", DateField: "enter", Select: "enter", ComboBox: "enter", Checkbox: "enter", Switch: "enter", RadioGroup: "enter", FileTrigger: "enter", Field: "enter", Badge: "inform", Banner: "inform", Chip: "inform", StatusMark: "inform", Meter: "inform", ProgressBar: "inform", Spinner: "inform", Skeleton: "inform", Card: "group", Table: "group", Separator: "group", Avatar: "depict", Icon: "depict", Dialog: "reveal", Popover: "reveal", Tooltip: "reveal", Disclosure: "reveal", Tabs: "reveal" };
    for (const [id, fact] of Object.entries(facts())) {
      const prefix = legacy[fact.exportName as keyof typeof legacy] ?? "depict";
      expect(id).toBe(`${prefix}.${fact.exportName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`);
    }
  });

  it("pins four display groups, ten families and forty unique selectable leaves", () => {
    expect(additions.ATOM_DISPLAY_GROUPS).toBeDefined();
    expect(groups().map(group => [group.label, ...group.families.map((family: any) => [family.label, family.atoms.map((id: string) => facts()[id]?.exportName)])])).toEqual(expectedPartition);
    const leaves = groups().flatMap(group => group.families.flatMap((family: any) => family.atoms));
    expect(groups().flatMap(group => group.families)).toHaveLength(10);
    expect(leaves).toHaveLength(40);
    expect(new Set(leaves).size).toBe(40);
    expect([...leaves].sort()).toEqual(Object.keys(guidance()).sort());
    expect(new Set(groups().map(group => group.id)).size).toBe(4);
    const families = groups().flatMap(group => group.families);
    expect(new Set(families.map(family => family.id)).size).toBe(10);
    expect([...groups(), ...families].every(item => /^[a-z]+(?:-[a-z]+)*$/.test(item.id))).toBe(true);
  });

  it("gives each atom meaningful stable semantics separate from web implementation", () => {
    expect(Object.keys(guidance())).toHaveLength(40);
    for (const field of ["purpose", "useWhen", "avoidWhen", "alternatives", "content", "anatomy", "composition", "accessibility"]) {
      const values = Object.values(guidance()).map(entry => entry[field]);
      expect(values.every(value => typeof value === "string" && value.trim().length > 24), field).toBe(true);
      expect(new Set(values).size, field).toBe(40);
    }
    for (const entry of Object.values(guidance())) {
      expect(entry).not.toHaveProperty("props");
      expect(entry).not.toHaveProperty("default");
      expect(entry.demonstration.state).toBe("unassessed");
      expect(entry.demonstration.reason).toMatch(/consumer/i);
    }
  });

  it("records implementation evidence or explicit assessment absence for each medium", () => {
    expect(Object.keys(guidance())).toHaveLength(40);
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
    expect(Object.keys(facts())).toHaveLength(40);
    const paths = Object.values(facts()).map(fact => join(root, fact.source));
    const filename = join(root, "atom-guidance-consumer.check.ts");
    const consumer = `
      import type {IconProps, IconNode, ChipProps} from ${JSON.stringify(join(root, "src/atoms/index.js"))};
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
    expect(Object.keys(facts())).toHaveLength(40);
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
    for (const id of ["reveal.tabs", "enter.radio-group"]) expect(guidance()[id].media.web.implementation.options.find((option: any) => option.prop === "orientation").support.state).toBe("partial");
    const meter = { value: 5, scaleMax: 10, tone: "neutral" as const, valueText: "5" };
    expect(() => atoms.Meter({ ...meter, direction: "min" })).not.toThrow();
    expect(() => atoms.Meter({ ...meter, previous: 2 })).toThrow(/together/);
    expect(() => atoms.Meter({ ...meter, previousText: "Previously 2" })).toThrow(/together/);
    expect(() => atoms.Meter({ ...meter, previous: 11, previousText: "Previously 11" })).toThrow(/within the scale/);
    expect(() => atoms.Meter({ ...meter, previous: 2, previousText: "Previously 2" })).not.toThrow();
  });

  it("keeps literal pipe evidence in ordinary Markdown code spans", () => {
    const text = readFileSync(join(root, "skill/atoms-guide.md"), "utf8");
    const evidence = guidance()["act.link"].media.web.implementation.constraints[0].evidence.evidence;
    expect(evidence).toContain(" || ");
    expect(text).toContain("`" + evidence + "`");
    expect(text).not.toContain("&#124;");
  });

  it("escapes GFM table pipes while retaining long code fences", () => {
    const moduleUrl = pathToFileURL(join(root, "../../scripts/generate-atom-docs.mjs")).href;
    const inputs = ["left|right", "return `value|\ntail"];
    const script = 'const { tableCode } = await import(process.argv[1]); const inputs = JSON.parse(process.argv[2]); process.stdout.write(JSON.stringify({ kind: typeof tableCode, values: typeof tableCode === "function" ? inputs.map(tableCode) : [] }));';
    const output = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", script, moduleUrl, JSON.stringify(inputs)], { encoding: "utf8" }));
    expect(output.kind).toBe("function");
    expect(output.values).toEqual(["`left\\|right`", "``return `value\\| tail``"]);
  });

  it("covers each leaf once in the generated guide", () => {
    const text = readFileSync(join(root, "skill/atoms-guide.md"), "utf8");
    const ids = [...text.matchAll(/^##### `([^`]+)`/gm)].map(match => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.keys(guidance()).sort());
    const categoricalEvidence = facts()["depict.sparkline"].tokens.dependencies[0].evidence;
    expect(categoricalEvidence).toContain("--color-chart-categorical-1");
    expect(text).toContain("`" + categoricalEvidence + "`");
  });
});
