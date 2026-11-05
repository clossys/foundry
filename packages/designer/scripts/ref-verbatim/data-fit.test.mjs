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
function invokeContentFunction(text, name, props) {
  const ts = loadTypeScript();
  const parsed = ts.createSourceFile("slots.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn);
  const tags = new Set(["Fragment"]);
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /^[A-Z]/.test(node.tagName.getText(parsed))) tags.add(node.tagName.getText(parsed));
    ts.forEachChild(node, visit);
  };
  visit(fn);
  const compiled = ts.transpileModule(fn.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React, jsxFactory: "element", jsxFragmentFactory: "Fragment" }, reportDiagnostics: true,
  });
  assert.deepEqual(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const element = (type, props, ...children) => ({ type, props, children });
  // Symbolic stock tags collect JSX; only the actual replayed declaration runs.
  const execute = new Function("exports", "element", ...tags,
    `${compiled.outputText}\nreturn exports.${name === "Page" ? "default" : name};`)({}, element, ...tags);
  return execute(props);
}
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
test("page children body invokes supplied content inside the unchanged stock inset/header/body wrappers", () => {
  const source = page(), bindings = { region: "page", body: "children" };
  const result = replay(source, "sidebar15-frame-split", bindings);
  const child = { content: "page input" };
  const tree = invokeContentFunction(result, "Page", { children: child });
  assert.equal(tree.type, "Fragment");
  assert.equal(tree.children[0].type, "SidebarInset");
  const [header, body] = tree.children[0].children;
  assert.equal(header.type, "header");
  assert.equal(header.props.className, "sticky top-0 flex h-14 shrink-0 items-center gap-2 bg-background");
  assert.equal(body.type, "div");
  assert.equal(body.props.className, "flex flex-1 flex-col gap-4 p-4");
  assert.deepEqual(body.children, [child]);
  assert.equal(tree.children[1].type, "SidebarRight");
  const expected = replay(source, "sidebar15-frame-split", { region: "page" })
    .replace("function Page()", "function Page({ children }: { children: React.ReactNode })")
    .replace(/(<div className="flex flex-1 flex-col gap-4 p-4">)[\s\S]*?(<\/div>)/, "$1{children}$2");
  assert.equal(result, expected);
  for (const bindings of [{ body: "children" }, { region: "app", body: "children" }, { region: "page", body: false },
    { region: "page", body: "other" }, { region: "page", body: "children", jsx: "<div />" }])
    assert.throws(() => replay(source, "sidebar15-frame-split", bindings), /NEED/);
  for (const text of [source.text.replace("function Page()", "function Page(props: unknown)"),
    source.text.replace('<SidebarInset>', '<SidebarInset><section>').replace('</SidebarInset>', '</section></SidebarInset>'),
    source.text.replace('<SidebarRight />', '<SidebarRight /><SidebarInset />'),
    source.text.replace('h-24 w-full', 'h-32 w-full'),
    source.text.replace('<div className="flex flex-1 flex-col gap-4 p-4">', '<div className="flex flex-1 flex-col gap-4 p-4">{/* extra */}'),
    source.text.replace('      </SidebarInset>', '      </SidebarInset><div className="flex flex-1 flex-col gap-4 p-4" />')])
    assert.throws(() => replay({ ...source, text }, "sidebar15-frame-split", bindings), /NEED/);
});
test("right content slots invoke required header/body/footer inputs and preserve stock wrappers and native props", () => {
  const source = stock("sidebar-15", "registry/aria-nova/blocks/sidebar-15/components/sidebar-right.tsx");
  const bindings = { side: "right", collapsible: "offcanvas", contentSlots: true };
  const result = replay(source, "sidebar15-right-offcanvas", bindings);
  const header = { content: "header" }, child = { content: "chat" }, footer = { content: "footer" };
  const tree = invokeContentFunction(result, "SidebarRight", { header, children: child, footer, id: "chat" });
  assert.equal(tree.type, "Sidebar");
  assert.deepEqual(tree.props, { side: "right", collapsible: "offcanvas", className: "sticky top-0 h-svh border-l", id: "chat" });
  assert.deepEqual(tree.children.map(node => [node.type, node.props, node.children]), [
    ["SidebarHeader", { className: "h-16 border-b border-sidebar-border" }, [header]],
    ["SidebarContent", null, [child]], ["SidebarFooter", null, [footer]],
  ]);
  assert.deepEqual(invokeContentFunction(result, "SidebarRight", { header: null, children: child, footer: null })
    .children.map(node => node.children), [[null], [child], [null]]);
  assert.match(result, /header: React.ReactNode; footer: React.ReactNode/);
  for (const bindings of [{ contentSlots: true }, { side: "right", collapsible: "offcanvas", contentSlots: false },
    { side: "right", collapsible: "offcanvas", contentSlots: "true" },
    { side: "right", collapsible: "offcanvas", contentSlots: true, header: "<div />" }])
    assert.throws(() => replay(source, "sidebar15-right-offcanvas", bindings), /NEED/);
  for (const text of [source.text.replace('...props', '...other'),
    source.text.replace('React.ComponentProps<typeof Sidebar>', 'unknown'),
    source.text.replace('<SidebarContent>', '<section><SidebarContent>').replace('</SidebarContent>', '</SidebarContent></section>'),
    source.text.replace('</SidebarContent>', '</SidebarContent><SidebarContent />'),
    source.text.replace('<DatePicker />', '{/* extra */}<DatePicker />'),
    source.text.replace('h-16 border-b', 'h-20 border-b')])
    assert.throws(() => replay({ ...source, text }, "sidebar15-right-offcanvas", bindings), /NEED/);
  for (const context of [{ ...source, raw: source.raw + "\n" },
    { ...source, source: { ...source.source, version: "next" } },
    { ...source, source: { ...source.source, registry: "custom" } },
    { ...source, source: { ...source.source, item: "sidebar-07" } }])
    assert.throws(() => replayDataFit(source.text, source.path, record(source, "sidebar15-right-offcanvas", bindings), context), /NEED/);
  assert.throws(() => replayDataFit(source.text, source.path.replace("sidebar-right.tsx", "other.tsx"),
    record(source, "sidebar15-right-offcanvas", bindings), source), /NEED/);
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

// O3: an allowed H-IMPORT must not rebind cn, which would make cn(...) and the className passthrough call arbitrary code.
test("O3: a payload's cn must be the registry's own cn import", () => {
  const ref = 'import { cn } from "cn"\nexport function Hero({ className }: { className?: string }) {\n  return <section className={cn("bg-background p-8", className)}><h1 className="text-lg">Title</h1></section>\n}\n';
  const plain = 'export function Hero({ className }: { className?: string }) {\n  return <section className="bg-background p-8"><h1 className="text-lg">Title</h1></section>\n}\n';
  const failing = (refText, file, options) => diffSources(refText, "hero.tsx", file, "hero.tsx", options).hunks.filter(h => !h.ok).map(h => h.rule);
  // The registry's own cn: the reference's module, the "cn" alias, the default or the consumer's utils path.
  assert.deepEqual(failing(ref, ref), []);
  assert.deepEqual(failing(ref, ref.replace('"cn"', '"@/lib/utils"')), []);
  assert.deepEqual(failing(ref, ref.replace('"cn"', '"~/utils"'), { utils: "~/utils" }), []);
  assert.deepEqual(failing(plain, `import { cn } from "cn"\n${plain.replace('className="bg-background p-8"', 'className={cn("bg-background p-8", className)}')}`), []);
  // Anything else bound to cn fails, whether the reference calls cn or only the passthrough does.
  assert.deepEqual(failing(ref, ref.replace('"cn"', '"./evil"')), ["REF-HUNK-LOGIC"]);
  assert.deepEqual(failing(ref, ref.replace('import { cn } from "cn"', 'import { twMerge as cn } from "tailwind-merge"')), ["REF-HUNK-LOGIC"]);
  assert.deepEqual(failing(ref, ref.replace('import { cn } from "cn"', 'import cn from "cn"')), ["REF-HUNK-LOGIC"]);
  assert.ok(failing(ref, ref.replace('import { cn } from "cn"\n', "")).includes("REF-HUNK-LOGIC"));
  const evilPassthrough = `import { cn } from "./evil"\n${plain.replace('className="bg-background p-8"', 'className={cn("bg-background p-8", className)}')}`;
  assert.deepEqual(failing(plain, evilPassthrough), ["REF-HUNK-LOGIC"]);
  assert.ok(failing(ref, ref.replace("export function Hero({ className }", "export function Hero({ className, cn }")).includes("REF-HUNK-LOGIC"));
});
