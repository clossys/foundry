// @vitest-environment node
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { secondaryFixture, secondaryInventory, secondaryNames, secondaryProfile, secondarySourceText } from "./__fixtures__/component-engine/secondary-exports.js";
import { synthetic, syntheticSource } from "./__fixtures__/component-engine/synthetic.js";
import { applyComponentLibraryChange, materializeSourceFill } from "./changeset-components.js";
import { assertComponentDescriptor, componentDescriptorHash, componentInputsHash, componentLibraryHash } from "./resolve-components.js";
import { assertComponentImportClosure, emitComponents } from "./emit-components.js";
import { stableStringify } from "./stable.js";
import { validateInstalledComponentRule } from "./component-rule-validation.js";
import { componentSecondaryExports } from "./component-secondary-exports.js";
import { compositeLibraryHash } from "./library-components.js";
import { readFileSync } from "node:fs";
import { toggleExecutableSource } from "../importers/toggle-executable-profile.js";
import { rewriteShadcnAria } from "../importers/rewrite.js";
import { normalizeSelectedSource } from "../importers/normalize-selected-source.js";
import { selectedRuntime } from "../importers/__fixtures__/selected-runtime.js";

const leaf = (files: readonly { path: string; content: string }[]) => files.find(file => file.path === "components/button/index.ts")!.content;
const publicNames = (source: string) => {
  const ast = ts.createSourceFile("leaf.ts", source, ts.ScriptTarget.Latest, true);
  return ast.statements.flatMap(statement => {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) return statement.exportClause.elements.map(item => item.name.text);
    if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return statement.declarationList.declarations.map(item => item.name.getText(ast));
    return [];
  }).sort();
};
function typecheckCaller(files: readonly { path: string; content: string }[], caller: string) {
  const root = new URL("./__secondary_codegen__/", import.meta.url).pathname;
  const virtual = new Map(files.filter(file => /\.tsx?$/.test(file.path)).map(file => [root + file.path, file.content]));
  virtual.set(root + "caller.ts", caller);
  virtual.set(root + "dependencies.d.ts", 'declare module "react-aria-components" { export const Button: import("react").ComponentType<Record<string, unknown>>; }');
  const options: ts.CompilerOptions = { noEmit: true, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] };
  const host = ts.createCompilerHost(options);
  const originalFile = host.fileExists.bind(host), originalRead = host.readFile.bind(host), originalSource = host.getSourceFile.bind(host), originalDirectory = host.directoryExists!.bind(host);
  host.fileExists = path => virtual.has(path) || originalFile(path);
  host.readFile = path => virtual.get(path) ?? originalRead(path);
  host.directoryExists = path => path.startsWith(root) || originalDirectory(path);
  host.getSourceFile = (path, version, onError, create) => virtual.has(path) ? ts.createSourceFile(path, virtual.get(path)!, version) : originalSource(path, version, onError, create);
  return ts.getPreEmitDiagnostics(ts.createProgram([...virtual.keys()], options, host));
}
describe("SYNTHETIC authenticated leaf secondary exports; no real runtime claim", () => {
  it("G1-1 emits exactly five adopted same-entry values at the leaf, never the root", async () => {
    const { profile } = await secondaryProfile();
    expect(profile.check.ok).toBe(true);
    const files = emitComponents(profile, ["component-index"]);
    expect(publicNames(leaf(files))).toEqual(["Button", ...secondaryNames].sort());
    for (const name of secondaryNames) expect(leaf(files)).toContain(`export { ${name} } from "./button";`);
    expect(files.find(file => file.path === "component-index.ts")!.content).not.toMatch(/Button(?:Content|Group|Item|Trigger|Value|Private)/);
    const caller = { path: "components/caller/caller.tsx", content: 'import { ButtonTrigger } from "../button/index.js";' };
    expect(() => assertComponentImportClosure([...files, caller], { react: ["Fragment", "createElement", "ReactNode", "forwardRef", "ComponentType"], "react-aria-components": ["Button"] })).not.toThrow();
    caller.content = 'import { ButtonPrivate } from "../button/index.js";';
    expect(() => assertComponentImportClosure([...files, caller], {})).toThrow();
  });
  it("G1-1 typechecks a caller against the generated five-value API and refuses the private sixth", async () => {
    const { profile } = await secondaryProfile(), files = emitComponents(profile, ["component-index"]);
    const caller = `import { ${secondaryNames.join(", ")} } from "./components/button/index.js";\n${secondaryNames.map(name => `${name}({ value: 1 });`).join("\n")}`;
    expect(typecheckCaller(files, caller).map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n"))).toEqual([]);
    const denied = typecheckCaller(files, 'import { ButtonPrivate } from "./components/button/index.js"; ButtonPrivate({});');
    expect(denied.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n"))).toEqual([expect.stringMatching(/no exported member.*ButtonPrivate/)]);
  });
  it("G1-1 preserves legacy bytes and hashes when inventory is absent", async () => {
    const legacy = syntheticSource();
    const same = secondaryFixture(undefined, legacy.file.content);
    delete same.candidate.secondaryExports;
    expect(stableStringify(same.candidate)).toBe(stableStringify(legacy.candidate));
    expect(componentDescriptorHash(same.candidate)).toBe(componentDescriptorHash(legacy.candidate));
    const before = await secondaryProfile({ ...same, candidate: structuredClone(same.candidate) });
    const after = await secondaryProfile(same);
    expect(componentLibraryHash(after.library)).toBe(componentLibraryHash(before.library));
    expect(emitComponents(after.profile, ["component-index"])).toEqual(emitComponents(before.profile, ["component-index"]));
  });
  it("G1-1 sorts a validated copy and supports explicit public aliases", async () => {
    const rows = secondaryInventory().reverse();
    rows[0]!.name = "PublicValue";
    const input = secondaryFixture(rows), before = structuredClone(rows);
    const { profile } = await secondaryProfile(input);
    const text = leaf(emitComponents(profile, ["component-index"]));
    expect(text).toContain('export { ButtonValue as PublicValue } from "./button";');
    expect(publicNames(text)).toEqual(["Button", ...rows.map(row => row.name)].sort());
    expect(rows).toEqual(before);
  });
  it.each([
    [], null, {}, [null], [{ name: "ButtonTrigger" }], [{ name: 1, export: "ButtonTrigger" }],
    [{ name: "ButtonTrigger", export: "ButtonTrigger", path: "other.ts" }],
    [{ name: "ButtonTrigger", export: "ButtonTrigger" }, { name: "ButtonTrigger", export: "ButtonValue" }],
    [{ name: "One", export: "ButtonTrigger" }, { name: "Two", export: "ButtonTrigger" }],
    ...["Button", "LibraryProvider", "__proto__", "constructor", "prototype", "Bad.Name", "../Bad", "default", "*", "Bad()"].map(name => [{ name, export: "ButtonTrigger" }]),
    ...["Button", "LibraryProvider", "__proto__", "constructor", "prototype", "Bad.Name", "../Bad", "default", "*", "Bad()"].map(target => [{ name: "PublicPart", export: target }]),
  ])("G1-2 rejects malformed, duplicate, colliding or unsafe inventory %j", inventory => {
    expect(() => assertComponentDescriptor(secondaryFixture(inventory).candidate)).toThrow(/secondary/);
  });
  it("G1-2 rejects package inventories and both primary aliases", () => {
    const fill = secondaryFixture().candidate;
    fill.impl = { kind: "package", module: "test-kit/components", export: "RawButton" };
    expect(() => assertComponentDescriptor(fill)).toThrow(/secondary/);
    fill.impl = { kind: "source", entry: "components/button/button.tsx", export: "RawButton" };
    fill.secondaryExports = [{ name: "RawButton", export: "ButtonTrigger" }];
    expect(() => assertComponentDescriptor(fill)).toThrow(/secondary/);
  });
  it.each([
    ["absent", "Missing", secondarySourceText],
    ["type-only", "ButtonTypeOnly", secondarySourceText],
    ["imported", "ImportedPart", 'import { Button, Button as ImportedPart } from "react-aria-components"; export { Button, ImportedPart };'],
    ["reexport", "ButtonTrigger", 'export { ButtonTrigger } from "other";'],
    ["source alias", "ButtonTrigger", 'function Local() {} export { Local as ButtonTrigger };'],
    ["default", "ButtonTrigger", 'export default function ButtonTrigger() {}'],
    ["wildcard", "ButtonTrigger", 'export * from "other";'],
    ["ambient", "ButtonTrigger", 'declare function ButtonTrigger(): void; export { ButtonTrigger };'],
    ["overload", "ButtonTrigger", 'function ButtonTrigger(): void; export { ButtonTrigger };'],
    ["return annotation outside bounded grammar", "ButtonTrigger", 'function ButtonTrigger(): unknown { return null; } export { ButtonTrigger };'],
    ["expression", "ButtonTrigger", 'const Holder = function ButtonTrigger() {}; export { ButtonTrigger };'],
    ["nested", "ButtonTrigger", 'function Holder() { function ButtonTrigger() {} } export { ButtonTrigger };'],
    ["comment", "ButtonTrigger", '/* function ButtonTrigger() {} */ export { ButtonTrigger };'],
    ["string", "ButtonTrigger", '\'function ButtonTrigger() {}\'; export { ButtonTrigger };'],
    ["template", "ButtonTrigger", '`function ButtonTrigger() {}`; export { ButtonTrigger };'],
    ["regex", "ButtonTrigger", 'function Holder() { return /function ButtonTrigger() {}/; } export { ButtonTrigger };'],
    ["JSX text", "ButtonTrigger", 'function Holder() { return <div>function ButtonTrigger() {}</div>; } export { ButtonTrigger };'],
  ])("G1-2 refuses %s as runtime value proof", async (_label, target, source) => {
    await expect(secondaryProfile(secondaryFixture([{ name: "PublicPart", export: target }], source))).rejects.toThrow(/secondary/);
  });
  it("G1-2 independently distinguishes erased export syntax from function values", () => {
    const ast = ts.createSourceFile("fixture.tsx", secondarySourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.name?.text);
    const exported = ast.statements.filter(ts.isExportDeclaration);
    expect(secondaryNames.every(name => functions.includes(name))).toBe(true);
    expect(exported.filter(node => node.isTypeOnly).flatMap(node => node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map(item => item.name.text) : [])).toEqual(["ButtonTypeOnly"]);
  });
  it.each([
    'export function ButtonTrigger<T extends object>(props: T) { return null; }',
    'function ButtonTrigger({ child }: { child: unknown }) { return <div data-slot="part"><span>{String(child)}</span></div>; } export { ButtonTrigger };',
    'function ButtonTrigger<T extends object>(props: T) { return <>{props ? <span /> : null}</>; } export { ButtonTrigger };',
  ])("G1-2 proves only concrete functions with supported generic/parameter and JSX syntax", source => {
    const input = secondaryFixture([{ name: "PublicPart", export: "ButtonTrigger" }], source);
    expect(componentSecondaryExports(input.candidate, [input.file])).toEqual([{ name: "PublicPart", export: "ButtonTrigger" }]);
  });
  it("G1-2 reads the normalized Select function grammar without adopting or measuring it", () => {
    const golden = JSON.parse(readFileSync(new URL("../importers/__fixtures__/shadcn-aria/select.golden.json", import.meta.url), "utf8")) as { files: { path: string; content: string }[] };
    const file = golden.files.find(file => file.path === "components/select/select.tsx")!;
    const rows = ["SelectTrigger", "SelectValue", "SelectContent", "SelectGroup", "SelectItem"].map(name => ({ name, export: name }));
    const input = secondaryFixture(rows, file.content);
    // Parser evidence only: no check.ok, source bundle, adoption or real runtime.
    expect(componentSecondaryExports(input.candidate, [input.file])).toEqual([...rows].sort((a, b) => a.name.localeCompare(b.name)));
  });
  it("proves only the exact adopted ToggleGroup concrete functions, independently of private context and CVA", async () => {
    const root = new URL("../", import.meta.url);
    const fixtures = new URL("importers/__fixtures__/shadcn-aria/", root);
    const styles = readFileSync(new URL("style-nova.css", fixtures), "utf8");
    const selected = ["toggle-group", "toggle"].map(item => {
      const raw = JSON.parse(readFileSync(new URL(`${item}.json`, fixtures), "utf8")).files[0];
      const result = rewriteShadcnAria({ item, leaf: item === "toggle" ? "toggle-button" : item,
        files: [toggleExecutableSource(item, raw)], styles, leafByItem: { toggle: "toggle-button", "toggle-group": "toggle-group" } });
      expect(result.issues).toEqual([]);
      const file = normalizeSelectedSource(result.files[0]!);
      const materialized = readFileSync(new URL(file.path, root), "utf8");
      // The UI handoff retains its old materialized module until the Mid owner
      // applies this exact closure correction. No other byte difference is allowed.
      // The package's own copy keeps NodeNext .js specifiers; consumer output is extensionless.
      expect(materialized.replace(/(from "\.\.?\/[^"]*)\.js"/g, '$1"')).toBe(file.content);
      if (item === "toggle-group") {
        expect(file.content).toContain('import { toggleVariants } from "../toggle-button/toggle"');
        expect(() => normalizeSelectedSource({ ...result.files[0]!, content: result.files[0]!.content + " " })).toThrow(/closure receipt differs/);
      }
      return file;
    });
    const file = selected[0]!;
    const ast = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect((ast as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
    const functions = ast.statements.filter(ts.isFunctionDeclaration).filter(node => node.body !== undefined).map(node => node.name!.text).sort();
    const exports = ast.statements.filter(ts.isExportDeclaration).flatMap(node => {
      expect(node.moduleSpecifier).toBeUndefined();
      expect(node.isTypeOnly).toBe(false);
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) throw new Error("expected concrete local exports");
      return node.exportClause.elements.map(binding => {
        expect(binding.propertyName).toBeUndefined();
        expect(binding.isTypeOnly).toBe(false);
        return binding.name.text;
      });
    }).sort();
    expect(functions).toEqual(["ToggleGroup", "ToggleGroupItem"]);
    expect(exports).toEqual(functions);
    const input = secondaryFixture([{ name: "ToggleGroupItem", export: "ToggleGroupItem" }], file.content);
    input.candidate.slot = "components.toggle-group";
    input.candidate.impl = { kind: "source", entry: file.path, export: "ToggleGroup" };
    expect(componentSecondaryExports(input.candidate, [file])).toEqual([{ name: "ToggleGroupItem", export: "ToggleGroupItem" }]);
    const runtimeFiles = [...selected, ...["components/toggle-button/index.ts", "components/_parts/utils/index.ts"].map(path => ({ path, content: readFileSync(new URL(path, root), "utf8") }))];
    const runtime = await selectedRuntime(runtimeFiles).loadAsync(file.path);
    expect(Object.keys(runtime).sort()).toEqual(exports);
    for (const name of functions) expect(typeof runtime[name]).toBe("function");
    for (const name of ["ToggleGroupContext", "VariantProps", "toggleVariants", "Missing", "React", "Context"]) {
      input.candidate.secondaryExports = [{ name: "PublicPart", export: name }];
      expect(() => componentSecondaryExports(input.candidate, [file])).toThrow(/secondary/);
    }
    input.candidate.secondaryExports = [{ name: "ToggleGroupItem", export: "ToggleGroupItem" }];
    for (const content of [file.content + " ", file.content.replace("function ToggleGroupItem(", "declare function ToggleGroupItem("),
      file.content.replace("export { ToggleGroup, ToggleGroupItem }", 'export { ToggleGroupItem } from "other"'),
      file.content.replace("export { ToggleGroup, ToggleGroupItem }", "export { ToggleGroupItem as PublicPart }"),
      file.content.replace("const ToggleGroupContext", "let ToggleGroupContext")]) {
      expect(() => componentSecondaryExports(input.candidate, [{ ...file, content }])).toThrow(/secondary/);
    }
    expect(() => componentSecondaryExports(input.candidate, [{ ...file, path: "components/other/toggle-group.tsx" }])).toThrow(/secondary/);
  });
  it("G1-3 transports adopted inventory into the facade and all existing identity domains", async () => {
    const input = secondaryFixture(), first = await secondaryProfile(input);
    const changed = secondaryFixture(secondaryInventory().map(row => ({ ...row, name: `Public${row.name}` })));
    const second = await secondaryProfile(changed);
    expect(first.profile.components["components.button"]!.descriptor).toMatchObject({ secondaryExports: secondaryInventory() });
    expect(publicNames(leaf(emitComponents(first.profile, ["component-index"])))).toEqual(["Button", ...secondaryNames].sort());
    expect(componentDescriptorHash(changed.candidate)).not.toBe(componentDescriptorHash(input.candidate));
    expect(componentLibraryHash(second.library)).not.toBe(componentLibraryHash(first.library));
    const composite = (library: typeof first.library) => ({ source: library.source, adoptedAt: library.adoptedAt, values: { fills: [] }, components: { fills: library.fills, files: library.files } });
    expect(compositeLibraryHash(composite(second.library))).not.toBe(compositeLibraryHash(composite(first.library)));
    expect(componentInputsHash(second.library, ["components.button"])).not.toBe(componentInputsHash(first.library, ["components.button"]));
    expect(second.candidate.pin).toEqual(first.candidate.pin);
    expect(second.candidate.outputSha256).toEqual(first.candidate.outputSha256);
    expect(second.bundle.files).toEqual(first.bundle.files);
    expect(() => applyComponentLibraryChange(changed.catalog, changed.library, { baseHash: componentLibraryHash(changed.library), changes: [{ op: "adopt", slot: changed.candidate.slot, source: changed.candidate.source }] }, [first.bundle])).toThrow(/bundle/);
    expect(() => applyComponentLibraryChange(second.catalog, second.library, { baseHash: componentLibraryHash(first.library), changes: [] })).toThrow(/baseHash/);
    const installed = first.library.fills[0]!.components.button! as typeof first.candidate;
    installed.secondaryExports = changed.candidate.secondaryExports;
    expect(first.resolve).toThrow(/hand-edit/);
  });
  it("G1-3 refuses inventory added or edited after resolution with stale adoption identity", async () => {
    const input = await secondaryProfile();
    const changed = structuredClone(input.profile);
    const descriptor = changed.components["components.button"]!.descriptor;
    descriptor.secondaryExports = [...descriptor.secondaryExports!, { name: "ButtonPrivate", export: "ButtonPrivate" }];
    expect(() => emitComponents(changed, ["component-index"])).toThrow(/descriptor|secondary|adopt/);
    const absent = secondaryFixture(undefined); delete absent.candidate.secondaryExports;
    const legacy = await secondaryProfile(absent);
    legacy.profile.components["components.button"]!.descriptor.secondaryExports = secondaryInventory();
    expect(() => emitComponents(legacy.profile, ["component-index"])).toThrow(/descriptor|secondary|adopt/);
  });
  it("G1-3 rejects stale composed bindings after a transitive inventory change", async () => {
    const first = await secondaryProfile(), pkg = synthetic().candidate;
    const slot = "components.select";
    const rule = { id: "compose:secondary-test@1", kind: "compose" as const, slot, inputs: ["components.button"], template: { ...pkg, slot, reads: { ...pkg.reads, components: ["components.button"] }, composes: ["components.button"] }, files: [] };
    const catalog = { ...first.catalog, slots: [...first.catalog.slots, { ...first.catalog.slots[0]!, id: slot }], rules: [rule] };
    const library = applyComponentLibraryChange(catalog, first.library, { baseHash: componentLibraryHash(first.library), changes: [{ op: "compose", slot, rule: rule.id }] });
    const oldHash = componentInputsHash(library, [slot]);
    const changed = secondaryFixture(secondaryInventory().map(row => ({ ...row, name: `Public${row.name}` })));
    const next = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [{ op: "author", slot: "components.button", fill: changed.candidate, files: [changed.file, changed.notice] }] });
    expect(componentInputsHash(next, [slot])).not.toBe(oldHash);
    const parent = next.fills.find(doc => doc.components.select)!.components.select!;
    expect(() => validateInstalledComponentRule(parent, { rules: [rule], library: next })).toThrow(/stale rule inputs/);
  });
  it("G1-4 revalidates opt-in source bytes and preserves check/index/closure refusals", async () => {
    const { profile } = await secondaryProfile();
    const bad = structuredClone(profile);
    bad.files[0]!.content += "\n// tampered";
    expect(() => emitComponents(bad, ["component-index"])).toThrow(/hash|secondary/);
    const missing = structuredClone(profile); missing.files = missing.files.filter(file => file.path !== "components/button/button.tsx");
    expect(() => emitComponents(missing, ["component-index"])).toThrow();
    const failed = structuredClone(profile); failed.check.ok = false;
    expect(() => emitComponents(failed, ["component-index"])).toThrow(/observations/);
    const collision = { ...profile, files: [...profile.files, { path: "components/button/index.ts", content: "export {};" }] };
    expect(() => emitComponents(collision, ["component-index"])).toThrow(/conflicts/);
    expect(() => assertComponentImportClosure([{ path: "components/button/button.tsx", content: 'export * from "other";' }], {})).toThrow(/wildcard/);
  });
});
