import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { replayDataFit, sourceHash, DATA_FIT_OPERATIONS } from "./data-fit.mjs";
import { configFromComponents, normalizeReference } from "./normalize.mjs";
import { diffSources } from "./diff.mjs";
import { loadTypeScript } from "./typescript.mjs";
const config = configFromComponents(JSON.parse(readFileSync(new URL("../../ui/components.json", import.meta.url), "utf8")));
function stock(item, path, registry = "shadcn-aria") {
  const raw = readFileSync(new URL(`../../references/${registry}/${item}@4.23.0/${path}`, import.meta.url), "utf8");
  return { raw, source: { registry, item, version: "4.23.0" }, text: normalizeReference(raw, path, config), path, sources: [] };
}
const page = () => stock("sidebar-15", "registry/aria-nova/blocks/sidebar-15/page.tsx");
const record = (source, operation, bindings) => ({ kind: "data-fit", file: "index.tsx", reason: "Fit the one recorded frame/slot input", sourceHash: sourceHash(source.raw), operation, bindings });
const replay = (source, operation, bindings) => replayDataFit(source.text, source.path, record(source, operation, bindings), source);
test("finite frame split keeps copied provider/navigation or inset/header/body/right subtrees", () => {
  const source = page();
  const app = replay(source, "sidebar15-frame-split", { region: "app" });
  assert.match(app, /<SidebarProvider>/); assert.match(app, /<SidebarLeft \/>/); assert.match(app, /\{children\}/);
  assert.doesNotMatch(app, /<SidebarInset>/); assert.doesNotMatch(app, /<SidebarRight \/>/);
  const result = replay(source, "sidebar15-frame-split", { region: "page" });
  assert.match(result, /<SidebarInset>/); assert.match(result, /<SidebarRight \/>/);
  assert.match(result, /sticky top-0 flex h-14 shrink-0 items-center gap-2 bg-background/);
  assert.doesNotMatch(result, /<SidebarLeft \/>/);
  assert.throws(() => replay(source, "sidebar15-frame-split", { region: "page", className: "gap-8" }));
});
test("app frame split binds child input during direct invocation of transpiled Page", () => {
  const source = page();
  const app = replay(source, "sidebar15-frame-split", { region: "app" });
  const ts = loadTypeScript();
  const parsed = ts.createSourceFile("app.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = parsed.statements.filter(node => ts.isFunctionDeclaration(node)
    && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword));
  assert.equal(declarations.length, 1);
  // Execute the actual replayed Page declaration. The JSX collector and symbolic
  // tags host the invocation; application imports and UI components are not run.
  const compiled = ts.transpileModule(declarations[0].getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React, jsxFactory: "element" },
    reportDiagnostics: true,
  });
  assert.deepEqual(compiled.diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error), []);
  const provider = Symbol("SidebarProvider"), left = Symbol("SidebarLeft");
  const element = (type, props, ...children) => ({ type, props, children });
  const Page = new Function("exports", "element", "SidebarProvider", "SidebarLeft",
    `${compiled.outputText}\nreturn exports.default;`)({}, element, provider, left);
  const child = { content: "recorded child input" };
  let result;
  assert.doesNotThrow(() => { result = Page({ children: child }); });
  assert.equal(result.type, provider);
  assert.equal(result.children.length, 2);
  assert.equal(result.children[0].type, left);
  assert.equal(result.children[1], child);
  const pageRegion = replay(source, "sidebar15-frame-split", { region: "page" });
  assert.equal(pageRegion, source.text.replace("<SidebarProvider>", "<>")
    .replace("</SidebarProvider>", "</>").replace("<SidebarLeft />", ""));
  for (const text of [source.text.replace("function Page()", "function Page(props: unknown)"),
    source.text.replace("function Page()", "async function Page()"),
    source.text.replace("function Page()", "function Other()"),
    source.text.replace("return (", "const children = 'local'; return (")]) {
    assert.throws(() => replay({ ...source, text }, "sidebar15-frame-split", { region: "app" }),
      /NEED: app frame requires stock zero-parameter default Page returning the provider/);
  }
});
test("right sidebar changes only none/hidden-lg defaults to right/offcanvas", () => {
  const source = stock("sidebar-15", "registry/aria-nova/blocks/sidebar-15/components/sidebar-right.tsx");
  const result = replay(source, "sidebar15-right-offcanvas", { side: "right", collapsible: "offcanvas" });
  assert.match(result, /side="right" collapsible="offcanvas"/);
  assert.match(result, /className="sticky top-0 h-svh border-l"/);
  assert.equal(result.replace('side="right" collapsible="offcanvas"', 'collapsible="none"').replace('className="sticky top-0 h-svh border-l"', 'className="sticky top-0 hidden h-svh border-l lg:flex"'), source.text);
  assert.throws(() => replay(source, "sidebar15-right-offcanvas", { side: "left", collapsible: "offcanvas" }));
});
test("both single-option stock row bodies retain avatar/button classes and remove only choice chrome", () => {
  for (const registry of ["shadcn-aria", "shadcn"]) for (const name of ["team-switcher", "nav-user"]) {
    const engine = registry === "shadcn" ? "radix" : "aria";
    const source = stock("sidebar-07", `registry/${engine}-nova/blocks/sidebar-07/components/${name}.tsx`, registry);
    const input = name === "nav-user" ? "user" : "teams";
    const result = replay(source, "sidebar07-single-option", { input, values: [{ name: "One" }] });
    assert.doesNotMatch(result, /<DropdownMenu|<ChevronsUpDownIcon/);
    assert.match(result, /<SidebarMenuButton/);
    if (input === "user") { assert.match(result, /<AvatarImage src=\{user.avatar\} alt=\{user.name\}/); assert.match(result, /<AvatarFallback/); }
    assert.throws(() => replay(source, "sidebar07-single-option", { input, values: [{}, {}] }));
  }
});
test("mirrored edge removes only mr-2 and reverses the exact trigger/separator order", () => {
  const source = page();
  const left = replay(source, "sidebar-mirrored-edge", { side: "left" });
  const right = replay(source, "sidebar-mirrored-edge", { side: "right" });
  assert.ok(left.indexOf("<SidebarTrigger") < left.indexOf("<Separator"));
  assert.ok(right.indexOf("<SidebarTrigger") > right.indexOf("<Separator"));
  assert.doesNotMatch(left, /mr-2/);
  assert.match(left, /className="data-\[orientation=vertical\]:h-4"/);
  for (const mutant of [left.replace('data-[orientation=vertical]:h-4', 'data-[orientation=vertical]:h-4 gap-8'), left.replace('orientation="vertical"', ''), left.replace('<SidebarTrigger />', '<Button />')]) {
    assert.ok(diffSources(left, "edge.tsx", mutant, "edge.tsx").hunks.some(hunk => !hunk.ok));
  }
  // Stock hidden label and attributes remain inside the unchanged stock trigger implementation.
  const sidebar = stock("sidebar", "registry/aria-nova/ui/sidebar.tsx");
  for (const mutant of [sidebar.text.replace('<span className="sr-only">Toggle Sidebar</span>', ''), sidebar.text.replace('data-sidebar="trigger"', '')]) {
    assert.ok(diffSources(sidebar.text, "sidebar.tsx", mutant, "sidebar.tsx").hunks.length);
  }
});
test("resize adds only stock wrappers and refuses missing primitive provenance/custom callbacks", () => {
  const source = page();
  assert.throws(() => replay(source, "sidebar-resizable-panels", { orientation: "horizontal" }));
  source.sources.push({ source: { registry: "shadcn", item: "resizable", version: "4.23.0" } });
  const result = replay(source, "sidebar-resizable-panels", { orientation: "horizontal" });
  assert.match(result, /<ResizablePanelGroup orientation="horizontal">/);
  assert.equal((result.match(/<ResizablePanel>/g) ?? []).length, 3);
  assert.equal((result.match(/<ResizableHandle \/>/g) ?? []).length, 2);
  assert.match(result, /<SidebarLeft \/>/); assert.match(result, /<SidebarRight \/>/);
  assert.throws(() => replay(source, "sidebar-resizable-panels", { orientation: "horizontal", onResize: "customDrag()" }));
});
test("unknown operations, stale source hashes, extra bindings and version drift fail closed", () => {
  const source = page();
  assert.equal(DATA_FIT_OPERATIONS.length, 5);
  const good = record(source, "sidebar-mirrored-edge", { side: "left" });
  for (const bad of [{ ...good, sourceHash: "sha256:" + "0".repeat(64) }, { ...good, operation: "rewrite-layout" }, { ...good, reason: " " }, { ...good, bindings: { side: "left", source: "<div />" } }]) {
    assert.throws(() => replayDataFit(source.text, source.path, bad, source));
  }
  assert.throws(() => replayDataFit(source.text, source.path, good, { ...source, source: { ...source.source, version: "next" } }));
});
