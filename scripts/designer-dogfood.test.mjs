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
  try { run({ put, scan, root }); } finally { rmSync(root, { recursive: true, force: true }); }
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
