import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { scanDesignerDogfood } from "./lib/designer-dogfood.mjs";

function fixture(run, native = false) {
  const root = mkdtempSync(resolve(tmpdir(), "designer-dogfood-"));
  const put = (path, text) => { const file = resolve(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file; };
  const designerRoot = resolve(root, "designer");
  put("designer/package.json", JSON.stringify({name:"@fixture/designer",exports:{"./components":{import:"./dist/components/index.js"}}}));
  put("designer/src/components/index.ts", 'export { Button } from "./Button.js";');
  put("designer/src/components/Button.tsx", 'import {Button} from "react-aria-components"; export {Button};');
  put("designer/src/catalog/slots/components.json", '[{"id":"components.button"}]');
  put("designer/src/catalog/aliases/components.json", '[]');
  put("designer/src/catalog/fills/foundry/components.button.json", JSON.stringify({$extensions:{"com.clossys.fill":{id:"foundry/components.button",slot:"components.button",source:"foundry",author:"foundry",mode:"implementation",pin:{package:"@fixture/designer"}}},components:{button:{impl:{kind:"package",module:"@fixture/designer/components",export:"Button"},pin:{package:"@fixture/designer"},propMap:{}}}}));
  if (native) {
    put("designer/src/components/index.ts", 'export { NativeAction } from "./NativeAction.js";');
    put("designer/src/components/NativeAction.tsx", 'export const NativeAction=props=> <button {...props}/>;');
    put("designer/src/catalog/slots/components.json", '[{"id":"components.native-action"}]');
    put("designer/src/catalog/fills/foundry/components.native-action.json", JSON.stringify({$extensions:{"com.clossys.fill":{id:"foundry/components.native-action",slot:"components.native-action",source:"foundry",author:"foundry",mode:"implementation",pin:{package:"@fixture/designer"}}},components:{"native-action":{impl:{kind:"package",module:"@fixture/designer/components",export:"NativeAction"},pin:{package:"@fixture/designer"},propMap:{}}}}));
  }
  const files = Object.fromEntries(["src/components/index.ts", "src/components/Button.tsx", "src/catalog/slots/components.json", "src/catalog/aliases/components.json", "src/catalog/fills/foundry/components.button.json", ...(native ? ["src/components/NativeAction.tsx", "src/catalog/fills/foundry/components.native-action.json"] : [])].map(path => [path, createHash("sha256").update(readFileSync(resolve(designerRoot, path))).digest("hex")]));
  const foundationReceipt = {schema: "designer-foundation/v1", files};
  const scan = (...paths) => scanDesignerDogfood({ designerRoot, foundationReceipt, roots: paths.map(path => resolve(root, path)) });
  try { run({ put, scan, root, designerRoot, foundationReceipt }); } finally { rmSync(root, { recursive: true, force: true }); }
}
const rejects = (text, code) => fixture(({put, scan}) => { put("consumer/Main.tsx", text); const report = scan("consumer"); assert.equal(report.ok, false); assert.ok(report.findings.some(finding => finding.code === code), JSON.stringify(report.findings)); });

test("registered public Foundry component boundary has exact source, barrel and slot identities", () => fixture(({put, scan}) => {
  put("consumer/Main.tsx", 'import { Button } from "../designer/src/components/Button.js"; export const Main=()=> <Button className="bg-surface-base">Go</Button>;');
  const a = scan("consumer"), b = scan("consumer");
  assert.equal(a.ok, true); assert.deepEqual(a, b); assert.equal(a.foundation.length, 1);
  for (const key of ["sha256", "barrelSha256", "slotsSha256", "aliasesSha256"]) assert.match(a.foundation[0][key], /^[a-f0-9]{64}$/);
}));
test("named and namespace React Aria aliases cannot evade the gate", () => {
  rejects('import { Button as Go } from "react-aria-components"; export const X=()=> <Go/>;', "DG1");
  rejects('import * as Rac from "react-aria-components"; export const X=()=> <Rac.Button/>;', "DG1");
});
test("raw controls and local JSX string aliases are rejected", () => {
  for (const tag of ["button", "input", "select", "textarea"]) {
    rejects(`export const X=()=> <${tag}/>;`, "DG2");
    rejects(`const Tag="${tag}"; const Alias=Tag; export const X=()=> <Alias/>;`, "DG2");
  }
});
test("literal, object, identifier and dynamic style props are all rejected", () => {
  for (const style of ['"color:red"', '{{color:"red"}}', '{styles}', '{getStyle()}']) rejects(`export const X=()=> <div style=${style}/>;`, "DG4");
});
test("spread styling and unresolved spreads fail closed, static safe attributes pass", () => {
  rejects('const attrs={style:{color:"red"}}; export const X=()=> <div {...attrs}/>;', "DG4");
  rejects('export const X=props=> <div {...props}/>;', "DG4");
  fixture(({put, scan}) => { put("consumer/Main.tsx", 'const first={title:"hello"};const attrs={...first,id:"x"};export const X=()=> <div {...attrs}/>;'); assert.equal(scan("consumer").ok, true); });
});
test("imperative styles and createElement control paths are rejected", () => {
  rejects('node.style.background="red";', "DG4");
  rejects('const Tag="button"; React.createElement(Tag, null);', "DG2");
  rejects('React.createElement("div", attributes);', "DG4");
});
test("raw hex/rgb in source or stylesheet fails, comments and selectors do not", () => {
  rejects('const value="#aabbcc";', "DG3"); rejects('const value="rgb(1,2,3)";', "DG3");
  fixture(({put, scan}) => { put("consumer/a.css", '#abc { color: rgb(1,2,3); }'); assert.ok(scan("consumer").findings.some(f=>f.code==="DG3")); });
  fixture(({put, scan}) => { put("consumer/a.css", '/* #fff */ #abc { color: var(--color-accent); }'); assert.equal(scan("consumer").ok,true); });
});
test("local helper closure outside the selected folder is inspected", () => fixture(({put, scan}) => {
  put("consumer/Main.tsx", 'import { Hidden } from "../helper/Hidden.js";export const X=()=> <Hidden/>;');
  put("helper/Hidden.tsx", 'export const Hidden=()=> <button>Bad</button>;');
  const report=scan("consumer"); assert.ok(report.findings.some(f=>f.code==="DG2" && f.file.endsWith("helper/Hidden.tsx"))); assert.equal(report.inventory.length,2);
}));
test("moving a handrolled helper beside a component is not a registered boundary", () => fixture(({put, scan}) => {
  put("consumer/Main.tsx", 'import { Hidden } from "../designer/src/components/Hidden.js";export const X=()=> <Hidden/>;');
  put("designer/src/components/Hidden.tsx", 'export const Hidden=()=> <input/>;');
  assert.ok(scan("consumer").findings.some(f=>f.code==="DG2"));
}));
test("missing imports, malformed JSX, dynamic imports and missing/empty scope fail closed", () => {
  rejects('import {X} from "./missing.js";export const Y=()=> <X/>;', "DG0");
  rejects('export const Y=()=> <div;', "DG0"); rejects('import(path);', "DG0");
  fixture(({scan, put}) => { assert.equal(scan("missing").ok,false); put("empty/readme.txt", "x"); assert.equal(scan("empty").ok,false); assert.equal(scan().ok,false); });
});

test("literal dynamic imports and CSS imports inspect the actual helper", () => fixture(({put, scan}) => {
  put("consumer/Main.tsx", 'export const get=()=> import("../hidden/Bad.js");');
  put("hidden/Bad.tsx", 'export const Bad=()=> <input/>;');
  assert.ok(scan("consumer").findings.some(f=>f.code==="DG2"));
  put("consumer/Main.tsx", 'export const Main=()=> <div/>;');
  put("consumer/a.css", '@import "../hidden/b.css";');
  put("hidden/b.css", 'div {color:#fff}');
  assert.ok(scan("consumer").findings.some(f=>f.code==="DG3"));
}));
test("RAC reexports, unqualified external modules and factory aliases cannot evade closure", () => {
  rejects('export { Button as Go } from "react-aria-components";', "DG1");
  rejects('import { Button } from "unrelated-widget"; export const X=()=> <Button/>;', "DG0");
  rejects('import {Button} from "@example/designer/unknown"; export const X=()=> <Button/>;', "DG0");
  rejects('const create=React.createElement; create("button", null);', "DG2");
  rejects('import {createElement as make} from "react";make("input", null);', "DG2");
});
test("imperative styling aliases and stylesheet URLs fail closed", () => {
  rejects('Object.assign(node.style, {color:"red"});', "DG4");
  rejects('node.style.setProperty("color", "red");', "DG4");
  rejects('node.style.cssText="color:red";', "DG4");
  fixture(({put, scan}) => { put("consumer/a.css", '@import url("https://example.invalid/style.css");'); assert.equal(scan("consumer").ok,false); });
});
test("changing a registered body or adding a barrel export is not ownership authority", () => fixture(({put, scan}) => {
  put("consumer/Main.tsx", 'import {Button} from "../designer/src/components/Button.js";export const X=()=> <Button/>;');
  put("designer/src/components/Button.tsx", 'export const Button=()=> <input/>;');
  assert.ok(scan("consumer").findings.some(f=>f.code==="DG0" && f.message.includes("identity differs")));
  put("designer/src/components/index.ts", 'export {Button} from "./Button.js";export {Hidden} from "./Hidden.js";');
  put("designer/src/components/Hidden.tsx", 'export const Hidden=()=> <button/>;');
  assert.equal(scan("consumer").ok,false);
}));

test("namespace control constants, aliased style targets and raw markup cannot hide controls", () => {
  rejects('const tags={Go:"button"}; export const X=()=> <tags.Go/>;', "DG2");
  rejects('const paint=node.style;paint.setProperty("color","red");', "DG4");
  rejects('node["style"]["cssText"]="color:red";', "DG4");
  rejects('node.setAttribute("style", "color:red");', "DG4");
  rejects('export const X=()=> <div dangerouslySetInnerHTML={{__html:markup}}/>;', "DG0");
  rejects('node.innerHTML=markup;', "DG0");
});
test("CommonJS helper imports and unresolved CSS import syntax stay fail closed", () => fixture(({put, scan}) => {
  put("consumer/Main.tsx", 'const helper=require("../hidden/Bad.js");');
  put("hidden/Bad.tsx", 'export const Bad=()=> <textarea/>;');
  assert.ok(scan("consumer").findings.some(f=>f.code==="DG2"));
  put("consumer/a.css", '@import url(unresolved.css);');
  assert.ok(scan("consumer").findings.some(f=>f.code==="DG0" && f.message.includes("CSS import scope")));
}));

test("destructured and imported/reexported JSX string aliases resolve to their raw controls",()=>{
  rejects('const tags={Go:"button"};const {Go:Alias}=tags;export const X=()=> <Alias/>;',"DG2");
  fixture(({put,scan})=>{
    put("consumer/Main.tsx",'import {Go as Alias} from "../hidden/barrel.js";import * as Tags from "../hidden/tags.js";export const X=()=> <><Alias/><Tags.Edit/></>;');
    put("hidden/tags.ts",'const Tag="button";export {Tag as Go};export const Edit="input";');
    put("hidden/barrel.ts",'export {Go} from "./tags.js";');
    const report=scan("consumer");assert.equal(report.findings.filter(f=>f.code==="DG2").length,2);
  });
});

test("intrinsic tag names cannot be shadowed into safe aliases and separate lexical aliases do not overwrite one another",()=>{
  rejects('const button="div";export const X=()=> <button/>;',"DG2");
  rejects('const Tag="button";function helper(){const Tag="div";return <Tag/>;}export const X=()=> <Tag/>;',"DG2");
});
test("native disclosure/link/dialog widgets are Foundry controls too",()=>{
  for(const tag of ["details","summary","dialog","a"]) rejects(`export const X=()=> <${tag}/>;`,"DG2");
});

test("raw arbitrary utility values and inline SVG cannot replace token/asset ownership",()=>{
  rejects('export const X=()=> <div className="w-[14rem]"/>;',"DG5");
  rejects('export const X=()=> <div className={`w-[14rem] ${extra}`}/>;',"DG5");
  rejects('export const X=()=> <svg><path d="M0 0H20"/></svg>;',"DG6");
  rejects('export const X=()=> <iframe srcDoc={markup}/>;',"DG0");
  fixture(({put,scan})=>{put("consumer/Main.tsx",'export const X=()=> <div className="w-[var(--ui-layout-sidebar-w)] max-h-3/4"/>;');assert.equal(scan("consumer").ok,true);});
});

test("synthetic registered native action requires real authored ownership and rejects raw/local preview replacements", () => fixture(({put,scan}) => {
  put("consumer/Main.tsx", 'import {NativeAction} from "../designer/src/components/NativeAction.js";export const X=()=> <NativeAction type="button">Caller</NativeAction>;');
  const accepted=scan("consumer");assert.equal(accepted.ok,true);assert.equal(accepted.foundation[0].provenance[0].slot,"components.native-action");
  put("consumer/Main.tsx", 'export const X=()=> <button type="button">Caller</button>;');
  assert.ok(scan("consumer").findings.some(row=>row.code==="DG2"));
  put("consumer/Main.tsx", 'const PreviewAction=props=> <button {...props}/>;export const X=()=> <PreviewAction type="button">Caller</PreviewAction>;');
  assert.ok(scan("consumer").findings.some(row=>row.code==="DG2"));
  put("consumer/Main.tsx", 'import {NativeAction} from "../designer/src/components/NativeAction.js";export const X=()=> <NativeAction type="button"/>;');
  put("designer/src/components/NativeAction.tsx", 'export const NativeAction=()=> <input/>;');
  assert.ok(scan("consumer").findings.some(row=>row.code==="DG0"&&row.message.includes("identity differs")));
},true));

test("zero-allowlist source mutations fail independently in Studio, admin shell and Publisher", () => fixture(({ put, scan }) => {
  const roots = ["studio/Studio.tsx", "admin/Shell.tsx", "publisher/PublisherPage.tsx"];
  const clean = 'import {Button} from "../designer/src/components/Button.js";export const Page=()=> <Button>Open</Button>;';
  for (const path of roots) put(path, clean);
  const baseline = scan(...roots);
  assert.equal(baseline.ok, true);
  assert.deepEqual(baseline.inventory.map(row => row.file.split("/").slice(-2).join("/")).sort(), [...roots].sort());
  const mutations = [
    ["DG1", 'import {Button as Raw} from "react-aria-components";export const Page=()=> <Raw/>;'],
    ...["button", "input", "select", "textarea"].map(tag => ["DG2", `export const Page=()=> <${tag}/>;`]),
    ["DG3", 'export const Page=()=> <div className="bg-[#aabbcc]"/>;'],
    ["DG3", 'export const paint={ink:"rgb(1,2,3)"};'],
    ["DG4", 'export const Page=()=> <div style={{color:"red"}}/>;'],
  ];
  for (const path of roots) for (const [code, content] of mutations) {
    put(path, "// token-gate:ignore owner=fixture; pinned-residual count=100\n" + content);
    const report = scan(...roots);
    assert.equal(report.ok, false, `${path} ${code} must fail`);
    assert.ok(report.findings.some(row => row.file.endsWith(path) && row.code === code), `${path} ${code}: ${JSON.stringify(report.findings)}`);
    put(path, clean);
    assert.equal(scan(...roots).ok, true, `${path} restoration`);
  }
  put("admin/Shell.tsx", clean + '\nimport "./console.css";');
  put("admin/console.css", '.console{color:var(--color-ink-primary)}');
  assert.equal(scan(...roots).ok, true);
  for (const value of ["#abcdef", "rgb(1, 2, 3)"]) {
    put("admin/console.css", `.console{color:${value}}`);
    const report = scan(...roots);
    assert.equal(report.ok, false);
    assert.ok(report.findings.some(row => row.file.endsWith("admin/console.css") && row.code === "DG3"));
  }
}));

test("bare public package CSS imports resolve the exported stylesheet and inspect its bytes", () => fixture(({ put, scan }) => {
  put("designer/package.json", JSON.stringify({ name: "@fixture/designer", exports: { "./theme.css": "./styles/theme.css" } }));
  put("designer/styles/theme.css", ".owned {color:var(--color-ink);width:var(--size-content)}");
  put("consumer/main.css", '@import "@fixture/designer/theme.css";');
  const clean = scan("consumer");
  assert.equal(clean.ok, true, JSON.stringify(clean.findings));
  assert.ok(clean.inventory.some(row => row.file.endsWith("designer/styles/theme.css")));
  put("designer/styles/theme.css", ".owned {color:#abcdef;width:12px}");
  const raw = scan("consumer");
  for (const code of ["DG3", "DG5"]) assert.ok(raw.findings.some(row => row.code === code && row.file.endsWith("designer/styles/theme.css")));
  for (const statement of ['@import "@fixture/designer/private.css";', '@import "@foreign/designer/theme.css";', '@import "https://example.invalid/theme.css";', '@import "@fixture/designer/theme.css"garbage;']) {
    put("consumer/main.css", statement);
    assert.ok(scan("consumer").findings.some(row => row.code === "DG0"), statement);
  }
}));

test("package CSS conditions select runtime CSS, never types or a guessed package-relative file", () => fixture(({ put, scan }) => {
  put("theme/package.json", JSON.stringify({ name: "@fixture/theme", exports: { "./theme.css": { types: "./types/theme.d.ts", default: "./styles/theme.css" } } }));
  put("theme/styles/theme.css", ".theme{color:var(--color-ink)}");
  put("consumer/main.css", '@import url("@fixture/theme/theme.css");');
  assert.equal(scan("consumer").ok, true);
  put("theme/package.json", JSON.stringify({ name: "@fixture/theme", exports: { "./theme.css": { types: "./styles/theme.css" } } }));
  assert.ok(scan("consumer").findings.some(row => row.code === "DG0"));
  put("theme/package.json", JSON.stringify({ name: "@fixture/theme", exports: { ".": { import: "./index.js", style: "./styles/theme.css" } } }));
  put("consumer/main.css", '@import "@fixture/theme";');
  assert.equal(scan("consumer").ok, true);
  put("theme/package.json", JSON.stringify({ name: "@fixture/theme", exports: { "./theme.css": "../outside.css" } }));
  assert.ok(scan("consumer").findings.some(row => row.code === "DG0"));
}));

test("numeric issue references and issue URLs are prose, while colors in properties and classes remain paint", () => fixture(({ put, scan }) => {
  put("consumer/feed.ts", 'export const titles=["Issue #123", "Fix #1234 and #5678", "#123456 page layout", "Closed (#12345678)", "https://example.invalid/issues/123#123", "https://example.invalid/pull/4#abcdef"];');
  assert.equal(scan("consumer").ok, true);
  for (const content of ['const value="#123";', 'const color="#123";', 'const color="issue #123";', 'const value="#abcdef";', 'const value="rgb(1,2,3)";', 'const value="rgba(1,2,3,.5)";', 'const value="linear-gradient(#123, #456)";', 'const css="color: #123;";', 'const X=()=> <div className="bg-[#123]"/>;']) {
    put("consumer/feed.ts", "export const feed=[];");
    put("consumer/Main.tsx", content);
    assert.ok(scan("consumer").findings.some(row => row.code === "DG3"), content);
  }
}));

test("vendor-prefixed CSS declarations retain raw color and pixel checks", () => fixture(({ put, scan }) => {
  put("consumer/main.css", ".a{-webkit-tap-highlight-color:var(--color-ink);-webkit-mask-position:var(--space-md)}");
  assert.equal(scan("consumer").ok, true);
  put("consumer/main.css", ".a{-webkit-tap-highlight-color:#123456;-webkit-mask-position:12px}");
  const findings = scan("consumer").findings;
  for (const code of ["DG3", "DG5"]) assert.ok(findings.some(row => row.code === code), code);
}));

test("digits-only shadow colors remain paint while positively identified issue prose stays clean", () => fixture(({ put, scan }) => {
  put("consumer/value.ts", 'export const titles=["issue #123", "Fix #1234 and #5678", "Closed (#12345678)", "#123456 page layout", "https://example.invalid/issues/4#000"];');
  assert.equal(scan("consumer").ok, true);
  for (const value of ["0 0 0 2px #000", "0 0 0 2px #333333", "linear-gradient(#000, #333333)", "#000 0 0 2px", "inset 0 0 #333333", "#333333 solid", "solid #000", "#333333 left top", "#000 fixed"]) {
    put("consumer/value.ts", `export const value=${JSON.stringify(value)};`);
    assert.ok(scan("consumer").findings.some(row => row.code === "DG3"), value);
  }
}));

test("raw pixels are rejected in consumer CSS, style declarations and arbitrary classes, not numeric prose", () => fixture(({ put, scan }) => {
  put("consumer/main.css", "/* 12px is documentation. */ .pane{width:var(--content-width);padding:var(--space-md)}");
  put("consumer/feed.ts", 'export const description="The old pane was 320px wide; issue #123 tracks it"; export const count=320;');
  assert.equal(scan("consumer").ok, true);
  for (const css of [".pane{width:12px}", ".pane{padding:0 12px}", ".pane{width:calc(100% - 12px)}", ".pane{--custom-gap:12px}", ".pane{width:.5px}", "@media (width >= 320px){.pane{display:block}}", "@container pane (min-width:320px){.pane{display:block}}"] ) {
    put("consumer/main.css", css);
    assert.ok(scan("consumer").findings.some(row => row.code === "DG5"), css);
  }
  put("consumer/main.css", "@media (width >= 20rem){.pane{display:block}} @container pane (width >= 20rem){.pane{display:block}}");
  assert.equal(scan("consumer").ok, true);
  put("consumer/main.css", ".pane{width:var(--content-width)}");
  for (const content of ['export const width="12px";', 'export const offset="24px";', 'export const offset="calc(100% - 24px)";', 'export const data={size:"24px"};', 'export const paint={padding:"12px"};', 'export const css=`width: 12px;`;', 'export const X=()=> <div className="w-[12px]"/>;']) {
    put("consumer/Main.tsx", content);
    assert.ok(scan("consumer").findings.some(row => row.code === "DG5"), content);
  }
}));

test("external public modules are source-inspected, including aliased controls and nested imports", () => fixture(({ put, scan }) => {
  put("tools/package.json", JSON.stringify({ name: "@fixture/tools", exports: { ".": { import: "./dist/index.js" } } }));
  put("tools/src/index.ts", 'export { label } from "./label.js";');
  put("tools/src/label.ts", 'export const label="Current label";');
  put("consumer/Main.tsx", 'import {label} from "@fixture/tools";export const X=()=> <div>{label}</div>;');
  const clean = scan("consumer");
  assert.equal(clean.ok, true, JSON.stringify(clean.findings));
  for (const path of ["tools/src/index.ts", "tools/src/label.ts"]) assert.ok(clean.inventory.some(row => row.file.endsWith(path)));
  put("tools/src/label.ts", 'import {Hidden} from "./Hidden.js"; export const label="Current label";');
  put("tools/src/Hidden.tsx", 'export const Hidden=()=> <button/>;');
  assert.ok(scan("consumer").findings.some(row => row.code === "DG2" && row.file.endsWith("Hidden.tsx")));
  put("tools/src/label.ts", 'export const label="button";');
  put("consumer/Main.tsx", 'import {label as Action} from "@fixture/tools";export const X=()=> <Action/>;');
  assert.ok(scan("consumer").findings.some(row => row.code === "DG2" && row.file.endsWith("consumer/Main.tsx")));
}));

test("named and namespace external imports inspect executed entry and intermediate barrel side effects", () => fixture(({ put, scan }) => {
  put("tools/package.json", JSON.stringify({ name: "@fixture/tools", exports: { ".": "./dist/index.js" } }));
  put("tools/src/View.tsx", "export const View=()=> null;");
  for (const declaration of ['import {View} from "@fixture/tools";', 'import * as Tools from "@fixture/tools";']) {
    put("consumer/Main.tsx", `${declaration}export const X=()=> <${declaration.includes("* as") ? "Tools.View" : "View"}/>;`);
    for (const side of ["index", "middle"]) {
      put("tools/src/index.ts", `${side === "index" ? 'import "./raw.css";import "./Side.js";' : ""}export {View} from "./middle.js";`);
      put("tools/src/middle.ts", `${side === "middle" ? 'import "./raw.css";import "./Side.js";' : ""}export {View} from "./View.js";`);
      put("tools/src/raw.css", ".effect{color:var(--color-ink)}");
      put("tools/src/Side.tsx", "export const Side=()=> <div/>;");
      const clean = scan("consumer");
      assert.equal(clean.ok, true, JSON.stringify(clean.findings));
      for (const file of ["raw.css", "Side.tsx", "middle.ts"]) assert.ok(clean.inventory.some(row => row.file.endsWith(file)), file);
      put("tools/src/raw.css", ".effect{color:#123456}");
      put("tools/src/Side.tsx", "export const Side=()=> <button/>;");
      const raw = scan("consumer").findings;
      assert.ok(raw.some(row => row.code === "DG3" && row.file.endsWith("raw.css")), `${declaration}:${side}:color`);
      assert.ok(raw.some(row => row.code === "DG2" && row.file.endsWith("Side.tsx")), `${declaration}:${side}:control`);
    }
    put("consumer/Main.tsx", declaration.includes("* as") ? 'import * as Tools from "@fixture/tools";export const X=()=> <Tools.Missing/>;' : 'import {Missing} from "@fixture/tools";export const X=()=> <Missing/>;');
    assert.ok(scan("consumer").findings.some(row => row.code === "DG0"));
  }
}));

test("external missing, foreign, private, malformed and unknown exports stay unqualified", () => fixture(({ put, scan }) => {
  put("tools/package.json", JSON.stringify({ name: "@fixture/tools", exports: { ".": "./dist/index.js" } }));
  put("tools/src/index.ts", 'export const value="safe";');
  for (const module of ["@fixture/missing", "@foreign/tools", "@fixture/tools/private", "@fixture/tools/../private", "node:not-a-real-runtime"]) {
    put("consumer/Main.tsx", `import {value} from ${JSON.stringify(module)};export const X=()=> <div>{value}</div>;`);
    assert.ok(scan("consumer").findings.some(row => row.code === "DG0"), module);
  }
  put("consumer/Main.tsx", 'import {Fake} from "@fixture/tools";export const X=()=> <Fake/>;');
  assert.ok(scan("consumer").findings.some(row => row.code === "DG0"));
  put("tools/src/index.ts", 'export const Fake=()=> <div;');
  assert.ok(scan("consumer").findings.some(row => row.code === "DG0"));
  put("tools/src/index.ts", 'export {Fake} from "./missing.js";');
  assert.ok(scan("consumer").findings.some(row => row.code === "DG0"));
}));

test("external exports grant no boundary to empty wrappers, and installed exports use actual bytes", () => fixture(({ put, scan }) => {
  put("consumer/node_modules/widget/package.json", JSON.stringify({ name: "widget", exports: { ".": { import: "./index.jsx" } } }));
  put("consumer/node_modules/widget/index.jsx", 'export const Fake=()=> null;');
  put("consumer/Main.tsx", 'import {Fake} from "widget";export const X=()=> <Fake/>;');
  const empty = scan("consumer");
  assert.equal(empty.ok, true);
  assert.equal(empty.foundation.length, 1, "inspected external helpers do not acquire foundation ownership");
  assert.ok(empty.inventory.some(row => row.file.endsWith("widget/index.jsx")));
  put("consumer/node_modules/widget/index.jsx", 'export const Fake=()=> <input/>;');
  assert.ok(scan("consumer").findings.some(row => row.code === "DG2" && row.file.endsWith("widget/index.jsx")));
  put("consumer/node_modules/widget/package.json", JSON.stringify({ name: "lookalike", exports: { ".": "./index.js" } }));
  assert.ok(scan("consumer").findings.some(row => row.code === "DG0"));
}));

test("external namespace JSX requires an actual public export, and unsupported source types refuse", () => fixture(({ put, scan }) => {
  put("tools/package.json", JSON.stringify({ name: "@fixture/tools", exports: { ".": "./dist/index.js" } }));
  put("tools/src/index.ts", "export const View=()=> null;");
  put("consumer/Main.tsx", 'import * as Tools from "@fixture/tools";export const X=()=> <Tools.View/>;');
  assert.equal(scan("consumer").ok, true);
  for (const tag of ["Tools.Missing", "Tools.View.Missing"]) {
    put("consumer/Main.tsx", `import * as Tools from "@fixture/tools";export const X=()=> <${tag}/>;`);
    assert.ok(scan("consumer").findings.some(row => row.code === "DG0"), tag);
  }
  put("tools/package.json", JSON.stringify({ name: "@fixture/tools", exports: { ".": "./opaque.txt" } }));
  put("tools/opaque.txt", "ordinary prose");
  put("consumer/Main.tsx", 'import "@fixture/tools";export const X=()=> <div/>;');
  assert.ok(scan("consumer").findings.some(row => row.code === "DG0" && row.message.includes("unsupported")));
  put("consumer/Main.tsx", 'import "./opaque.txt";');
  put("consumer/opaque.txt", "ordinary prose");
  assert.ok(scan("consumer").findings.some(row => row.code === "DG0" && row.message.includes("unsupported")));
}));
