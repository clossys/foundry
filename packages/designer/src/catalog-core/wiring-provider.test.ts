// @vitest-environment node
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { elementHash } from "./dogfood.js";
import { checkWiring, type WiringRoutes } from "./wiring.js";

// WL10 admission of a Publisher-checked registered nonvisual provider at its exact emitted mount.
// The page below is Publisher's emitted registered-route page for a provider route; Publisher's own
// suite runs the real emitter and producer through checkWiring (Designer never imports Publisher).
const ROUTE = "generated/example.tools.tsx";
const PROVIDER = "providers/designer.tsx";
const SPECIFIER = "../providers/designer.tsx";
const PROVIDER_BYTES = "SYNTHETIC provider bytes the Publisher check classified nonvisual";
const ASSEMBLY = [{ module: "@clossys/publisher/web/registered-route", export: "RegisteredRoutePage" }] as const;
const ENTRY = '<RegisteredRoutePage registry={registry} routeId="example.tools" useRuntime={useRuntime} />';
const IMPORT = `import { DesignerStudioProvider as RegisteredProvider } from "${SPECIFIER}";`;
const page = (body = `<RegisteredProvider>${ENTRY}</RegisteredProvider>`, providerImport = IMPORT): string => [
  '"use client";',
  'import registry from "../routes.ts";',
  'import { RegisteredRoutePage } from "@clossys/publisher/web/registered-route";',
  'import { useRuntime as useRuntime } from "../runtime.ts";',
  providerImport,
  "export default function RegisteredPage() {",
  `  return ${body};`,
  "}", "",
].join("\n");

type Fields = { kind: string; version: number; route: { path: string; hash: string }; provider: { file: string; export: string; hash: string }; mount: string };
const digest = (fields: Fields) => elementHash(JSON.stringify([fields.kind, fields.version, fields.route.path, fields.route.hash, fields.provider.file, fields.provider.export, fields.provider.hash, fields.mount]));
/** A proof shaped as the Publisher producer issues it, bound to `content`. */
function proof(content: string, change: (fields: Fields) => void = () => {}) {
  const fields: Fields = { kind: "publisher.registered-provider-check", version: 1, route: { path: ROUTE, hash: elementHash(content) }, provider: { file: PROVIDER, export: "DesignerStudioProvider", hash: elementHash(PROVIDER_BYTES) }, mount: "designer.whole-studio" };
  change(fields);
  return { ...fields, digest: digest(fields) };
}
const claim = (content: string, over: Record<string, unknown> = {}) => ({ route: ROUTE, module: SPECIFIER, export: "DesignerStudioProvider", proof: proof(content), ...over });
const wl10 = (content: string, providers?: readonly unknown[], extra: WiringRoutes["modules"] = []) =>
  checkWiring({ sources: [], routes: { modules: [{ path: ROUTE, content }, ...extra], assembly: ASSEMBLY, ...(providers ? { providers: providers as WiringRoutes["providers"] } : {}) } }).findings.filter(row => row.code === "WL10");
/** The wrapper itself is reported: nothing admitted it. */
const wrapperReported = (findings: ReturnType<typeof wl10>, local = "RegisteredProvider") => findings.some(row => row.evidence === `Route module renders <${local}> outside the runtime assembly`);
const refusal = (findings: ReturnType<typeof wl10>) => findings.find(row => row.evidence.startsWith("Checked provider is not admitted"))?.evidence ?? "";
/** `name` with its character at `at` spelled as a backslash-u escape (built, so this file holds no escape). */
const escaped = (name: string, at = 0) => `${name.slice(0, at)}${String.fromCharCode(92)}u${name.codePointAt(at)!.toString(16).padStart(4, "0")}${name.slice(at + 1)}`;
/** Identifier names whose source text is an escape, as the TypeScript parser resolves them. */
function escapedIdentifierNames(source: string): string[] {
  const file = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), names: string[] = [];
  const visit = (node: ts.Node): void => { if (ts.isIdentifier(node) && node.getText(file) !== node.text) names.push(node.text); ts.forEachChild(node, visit); };
  visit(file);
  return names;
}

describe("WL10 checked registered nonvisual provider", () => {
  it("admits the proved provider only at its exact emitted mount: WL10 is 0", () => {
    const emitted = page();
    // Without evidence the emitted wrapper is a WL10 refusal, as before.
    expect(wrapperReported(wl10(emitted))).toBe(true);
    expect(wl10(emitted, [claim(emitted)])).toEqual([]);
    // A default-export provider and a page with header actions keep the same exact mount.
    const byDefault = page(undefined, `import RegisteredProvider from "${SPECIFIER}";`);
    expect(wl10(byDefault, [claim(byDefault, { export: "default", proof: proof(byDefault, fields => { fields.provider.export = "default"; }) })])).toEqual([]);
    const actions = page(`<RegisteredProvider>${ENTRY.replace(" />", " renderActions={renderActions} />")}</RegisteredProvider>`)
      .replace(IMPORT, `import { headerActions as renderActions } from "../actions.ts";\n${IMPORT}`);
    expect(wl10(actions, [claim(actions)])).toEqual([]);
  });

  it("a custom visual wrapper still fails, with or without provider evidence", () => {
    const visual = [
      // A consumer component in place of the proved provider.
      page(`<Chrome>${ENTRY}</Chrome>`, 'import { Chrome } from "../chrome/app-chrome.tsx";'),
      // A registered visual component or block around the assembly.
      page(`<Card>${ENTRY}</Card>`, 'import { Card } from "@clossys/designer/components";'),
      // Raw markup around the assembly.
      page(`<main>${ENTRY}</main>`, ""),
    ];
    for (const content of visual) {
      expect(wl10(content).length, content).toBeGreaterThan(0);
      // Evidence for the proved provider never admits a different wrapper.
      const claimed = wl10(content, [claim(content)]);
      expect(claimed.length, content).toBeGreaterThan(0);
      // The evidence is judged and refused, not ignored.
      expect(refusal(claimed), content).not.toBe("");
    }
    const chrome = visual[0]!;
    expect(wrapperReported(wl10(chrome, [claim(chrome, { module: "../chrome/app-chrome.tsx", export: "Chrome" })]), "Chrome")).toBe(true);
    // A proved provider admits nothing on another route module.
    const other = { path: "generated/other.tsx", content: page() };
    const beside = wl10(page(), [claim(page())], [other]);
    expect(wrapperReported(beside.filter(row => row.file === other.path))).toBe(true);
    expect(beside.filter(row => row.file === ROUTE)).toEqual([]);
  });

  it("an altered mount still fails, even with a proof bound to the altered bytes", () => {
    const altered: Record<string, string> = {
      "extra sibling": page(`<RegisteredProvider>${ENTRY}<footer /></RegisteredProvider>`),
      "second entry": page(`<RegisteredProvider>${ENTRY}${ENTRY}</RegisteredProvider>`),
      "extra prop": page(`<RegisteredProvider theme="dark">${ENTRY}</RegisteredProvider>`),
      "spread prop": page(`<RegisteredProvider {...registry}>${ENTRY}</RegisteredProvider>`),
      "nested element": page(`<RegisteredProvider><div>${ENTRY}</div></RegisteredProvider>`),
      "not outermost": page(`<div><RegisteredProvider>${ENTRY}</RegisteredProvider></div>`),
      "fragment outside": page(`<><RegisteredProvider>${ENTRY}</RegisteredProvider></>`),
      "inside the entry": page(`<RegisteredRoutePage registry={registry} routeId="example.tools" useRuntime={useRuntime}><RegisteredProvider>{null}</RegisteredProvider></RegisteredRoutePage>`),
      "no entry": page("<RegisteredProvider>{null}</RegisteredProvider>"),
      "non-assembly entry": page(`<RegisteredProvider><Chrome /></RegisteredProvider>`, `import { Chrome } from "../chrome.tsx";\n${IMPORT}`),
      "dynamic entry prop": page(`<RegisteredProvider>${ENTRY.replace("useRuntime={useRuntime}", "useRuntime={() => useRuntime()}")}</RegisteredProvider>`),
      "other body code": page(`<RegisteredProvider>${ENTRY}</RegisteredProvider>`).replace("export default function RegisteredPage() {", "export default function RegisteredPage() {\n  const chrome = null;"),
      "second return": page(`<RegisteredProvider>${ENTRY}</RegisteredProvider>`).replace("export default function RegisteredPage() {", "export default function RegisteredPage() {\n  if (registry) return null;"),
      "top-level code": `${page()}export const leaked = RegisteredProvider;\n`,
      "provider aliased elsewhere": page().replace("export default function", "const Shell = RegisteredProvider;\nexport default function"),
      "different module": page(undefined, IMPORT.replace(SPECIFIER, "../providers/other.tsx")),
      "different export": page(undefined, IMPORT.replace("DesignerStudioProvider as", "OtherProvider as")),
      "namespace import": page(undefined, `import * as Providers from "${SPECIFIER}";\nconst RegisteredProvider = Providers.DesignerStudioProvider;`),
      "second import": page(undefined, `${IMPORT}\nimport { DesignerStudioProvider as Again } from "${SPECIFIER}";`),
    };
    for (const [name, content] of Object.entries(altered)) {
      const findings = wl10(content, [claim(content)]);
      expect([name, wrapperReported(findings), refusal(findings) !== ""], content).toEqual([name, true, true]);
    }
    // A claim that names the altered module or export itself is not the proved provider.
    const moved = altered["different module"]!, renamed = altered["different export"]!;
    expect(refusal(wl10(moved, [claim(moved, { module: "../providers/other.tsx" })]))).toContain("not the proved provider");
    expect(refusal(wl10(renamed, [claim(renamed, { export: "OtherProvider" })]))).toContain("not the proved provider");
    expect(wrapperReported(wl10(renamed, [claim(renamed, { export: "OtherProvider" })]))).toBe(true);
  });

  it("an identity without Publisher proof, or with a forged escaped identifier, still fails", () => {
    const emitted = page(), bare = { route: ROUTE, module: SPECIFIER, export: "DesignerStudioProvider" };
    const forged: Record<string, unknown> = {
      "bare identity": bare,
      "proof absent": { ...bare, proof: undefined },
      "proof not an object": { ...bare, proof: "publisher.registered-provider-check" },
      "other kind": claim(emitted, { proof: proof(emitted, fields => { fields.kind = "consumer.asserted"; }) }),
      "other version": claim(emitted, { proof: proof(emitted, fields => { fields.version = 2; }) }),
      "extra proof field": claim(emitted, { proof: { ...proof(emitted), checked: true } }),
      "stale digest": claim(emitted, { proof: { ...proof(emitted), mount: "designer.other" } }),
      "tampered provider": claim(emitted, { proof: { ...proof(emitted), provider: { file: PROVIDER, export: "DesignerStudioProvider", hash: elementHash("other bytes") } } }),
      "other route bytes": claim(emitted, { proof: proof(`${emitted}// edited\n`) }),
      "other route path": claim(emitted, { proof: proof(emitted, fields => { fields.route.path = "generated/other.tsx"; }) }),
      "proved file elsewhere": claim(emitted, { proof: proof(emitted, fields => { fields.provider.file = "providers/other.tsx"; }) }),
      "proved export elsewhere": claim(emitted, { proof: proof(emitted, fields => { fields.provider.export = "OtherProvider"; }) }),
      "extra claim field": { ...claim(emitted), admitted: true },
      "escaped claim export": claim(emitted, { export: escaped("DesignerStudioProvider", 0), proof: proof(emitted, fields => { fields.provider.export = escaped("DesignerStudioProvider", 0); }) }),
    };
    for (const [name, evidence] of Object.entries(forged)) {
      const findings = wl10(emitted, [evidence]);
      expect([name, wrapperReported(findings), refusal(findings) !== ""]).toEqual([name, true, true]);
    }
    // Two claims for one route, or a claim for a route that was not supplied, admit nothing.
    expect(wrapperReported(wl10(emitted, [claim(emitted), claim(emitted)]))).toBe(true);
    expect(wl10(emitted, [claim(emitted), { ...claim(emitted), route: "generated/absent.tsx" }]).map(row => row.evidence)).toEqual(["Checked provider evidence names no supplied route module; nothing is admitted."]);
    // An escape in the route makes raw text differ from the names TypeScript binds: refused, even
    // when the proof is bound to those bytes and the literal spelling is admitted.
    const leaked = `${emitted}export const leaked = ${escaped("RegisteredProvider", 0)};\n`;
    const entryEscaped = emitted.replace("useRuntime={useRuntime}", `useRuntime={${escaped("useRuntime", 0)}}`);
    for (const [source, name] of [[leaked, "RegisteredProvider"], [entryEscaped, "useRuntime"]] as const) {
      expect(escapedIdentifierNames(source)).toEqual([name]);
      expect(refusal(wl10(source, [claim(source)]))).toContain("escape");
      expect(wrapperReported(wl10(source, [claim(source)]))).toBe(true);
    }
    const evaluated = page().replace("export default function", 'eval("RegisteredProvider = null");\nexport default function');
    expect(refusal(wl10(evaluated, [claim(evaluated)]))).not.toBe("");
  });

  it("every other WL10 refusal stands beside an admitted provider", () => {
    // A visual import is still reported, though the mount itself is admitted.
    const visualImport = page().replace(IMPORT, `import { Card } from "@clossys/designer/components";\n${IMPORT}`);
    const findings = wl10(visualImport, [claim(visualImport)]);
    expect(findings.map(row => row.evidence)).toEqual(["Route module imports @clossys/designer/components instead of only the runtime assembly"]);
    // No runtime assembly identity: still refused.
    const emitted = page();
    expect(checkWiring({ sources: [], routes: { modules: [{ path: ROUTE, content: emitted }], assembly: [], providers: [claim(emitted) as never] } }).findings.some(row => row.code === "WL10" && row.subject === "routes")).toBe(true);
  });
});
