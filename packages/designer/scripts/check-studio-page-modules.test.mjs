import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { adaptPublishedStudioActions, adaptPublishedStudioBodies, analyzeStudioPageModules, checkStudioPageModules, inspectUnboundStudioPageBodies } from "./check-studio-page-modules.mjs";

// Native-adapter seam fixtures, deliberately not an asserted Publisher schema.
const common = ["Explorer", "Inspector", "Source", "Checks", "Needs"];
const sectionFor = { Explorer: "sections.explorer", Inspector: "sections.record-detail", Source: "sections.content", Checks: "sections.status-list", Needs: "sections.task-list" };
function fixture(change = () => {}, sourceChange = source => source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-page-modules-"));
  const labels = { director: common, designer: common, writer: common, publisher: common, home: ["Needs"] };
  const entries = Object.entries(labels).map(([role, values]) => ({ role, actions: values.map(label => ({ id: label.toLowerCase(), label, icon: "assets.icon", defaultOpen: role !== "home" && label === "Explorer", moduleSection: sectionFor[label] })) }));
  change(entries);
  const files = {
    "publisher/manifest.ts": `export const entries = ${JSON.stringify(entries)};`,
    "publisher/projection.ts": "import {entries} from './manifest.js'; export function project(role:string){return entries.find(page=>page.role===role)?.actions}",
    "component-leaf.tsx": "export function componentLeaf(id:string):any { throw Error(id) }",
    "module.tsx": "import {componentLeaf} from './component-leaf.js';const Button=componentLeaf('components.button');export function Module(){return <Button/>}",
    ...Object.fromEntries(Object.keys(labels).map(role => [`studio/${role}.tsx`, `import {project as pageActions} from '../publisher/projection.js';const selected=pageActions('${role}');export function Page(){return <Host actions={selected}/>}`])),
  };
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, sourceChange(source, name));
  }
  const program = ts.createProgram(Object.keys(files).map(name => path.join(root, name)), { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX });
  const manifestFile = path.join(root, "publisher/manifest.ts"), manifest = program.getSourceFile(manifestFile);
  const array = manifest.statements[0].declarationList.declarations[0].initializer;
  const prop = (node, name) => node.properties.find(row => row.name.text === name).initializer;
  const pages = array.elements.map(node => {
    const actionsNode = prop(node, "actions");
    return { role: prop(node, "role").text, node, actionsNode, actions: actionsNode.elements.map(action => ({ node: action, fields: Object.fromEntries(action.properties.map(row => [row.name.text, row.initializer])) })) };
  });
  const moduleSource = program.getSourceFile(path.join(root, "module.tsx"));
  const moduleRoot = moduleSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === "Module");
  const sections = new Map(entries.flatMap(page => page.actions).filter(action => action.moduleSection).map(action => [action.moduleSection, { roots: [moduleRoot] }]));
  const consumers = Object.keys(labels).map(pageRole => {
    const sourceFile = program.getSourceFile(path.join(root, `studio/${pageRole}.tsx`)), bindings = [];
    const visit = node => { if (ts.isJsxAttribute(node) && node.name.text === "actions") bindings.push({ node: node.initializer.expression }); ts.forEachChild(node, visit); }; visit(sourceFile);
    return { pageRole, sourceFile, bindings };
  });
  const input = { program, root, studioSourceRoot: path.join(root, "studio"), manifestFile, publisherProjectionFile: path.join(root, "publisher/projection.ts"), pages, sections, consumers, leafAnalyzerOptions: { componentLeaves: new Set(["components.button"]), leafFactory: path.join(root, "component-leaf.tsx") } };
  return { input, check: () => analyzeStudioPageModules(input), dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function measure(change, sourceChange, inspect = () => {}) {
  const setup = fixture(change, sourceChange);
  try { inspect(setup.input); return setup.check(); } finally { setup.dispose(); }
}
const has = (result, rule) => result.findings.some(finding => finding.rule === rule);

test("body inspection defaults an omitted root to the Studio source root", () => {
  const setup = fixture();
  try {
    const { root, ...input } = setup.input;
    assert.doesNotThrow(() => inspectUnboundStudioPageBodies(input));
  } finally { setup.dispose(); }
});

test("A242's five remaining pages consume real value symbols and selected module leaves", () => {
  const result = measure();
  assert.equal(result.status, "MEASURED");
  assert.equal(result.coverage.pages, 5);
  assert.ok(result.coverage.modules > 0);
  assert.deepEqual(result.findings, []);
});
test("an unresolved module section is a finding even when its action is valid", () => {
  const result = measure(undefined, undefined, input => input.sections.delete("sections.explorer"));
  assert.ok(has(result, "unregistered-module-section"));
});
test("an otherwise registered action on the wrong page fails A241", () => {
  const result = measure(entries => { entries[0].actions.push({ id: "preview", label: "Preview", icon: "assets.icon", defaultOpen: false, moduleSection: "sections.preview" }); });
  assert.ok(has(result, "page-action-contract"));
});
test("inline action arrays fail provenance and property-shape checks", () => {
  const result = measure(undefined, (source, name) => name === "studio/director.tsx" ? source.replace("const selected=pageActions('director');", "const selected=[{id:'x',label:'Details',icon:'assets.icon',defaultOpen:false,moduleSection:'sections.details'}];") : source);
  for (const rule of ["manifest-consumption-provenance", "inline-page-action-literal", "inline-page-module-literal"]) assert.ok(has(result, rule), rule);
});
test("copying fields under an alias does not establish native manifest provenance", () => {
  const result = measure(undefined, (source, name) => name === "publisher/projection.ts" ? "const copy=[{label:'Details'}];export function project(role:string){return copy}" : source);
  assert.ok(has(result, "manifest-consumption-provenance"));
});
test("the adapter cannot borrow a field from another manifest action", () => {
  const result = measure(undefined, undefined, input => { input.pages[0].actions[0].fields.icon = input.pages[1].actions[0].fields.icon; });
  assert.ok(has(result, "manifest-field-provenance"));
});
test("the adapter cannot omit native action nodes", () => {
  const result = measure(undefined, undefined, input => input.pages[0].actions.pop());
  assert.ok(has(result, "manifest-action-coverage"));
});
test("Apps is removed rather than retained as a nonmodule exception", () => {
  const result = measure(entries => { entries.push({ role: "apps", actions: [{ id: "open", label: "Open app", icon: "assets.icon", defaultOpen: false, intent: "open-app-dev-server" }] }); });
  assert.ok(has(result, "page-identity"));
  const intent = measure(entries => { entries[0].actions[0].intent = "open-app-dev-server"; });
  assert.ok(has(intent, "removed-apps-action"));
});
test("Explorer defaults open only on agent pages, and other modules default closed", () => {
  const result = measure(entries => { entries[0].actions[0].defaultOpen = false; entries[4].actions[0].defaultOpen = true; });
  assert.equal(result.findings.filter(row => row.rule === "module-default-state").length, 2);
});
test("module raw bodies are measured by the shared A237 analyzer", () => {
  const result = measure(undefined, (source, name) => name === "module.tsx" ? "export function Module(){return <p>Raw module copy</p>}" : source);
  assert.ok(has(result, "raw-text-element"));
  assert.ok(result.findings.some(row => row.moduleSection && row.file === "module.tsx"));
});
test("data leaf attributes cannot qualify a raw body", () => {
  const result = measure(undefined, (source, name) => name === "module.tsx" ? "export function Module(){return <button data-component-leaf='components.button'>Open</button>}" : source);
  assert.ok(has(result, "raw-interactive-element"));
});
test("missing native source and omitted pages stay visible", () => {
  const result = measure(undefined, undefined, input => { input.pages.pop(); input.consumers.pop(); });
  assert.ok(has(result, "missing-studio-page"));
  assert.ok(has(result, "missing-page-consumer"));
  const missing = measure(undefined, undefined, input => { input.publisherProjectionFile = path.join(input.root, "absent.ts"); });
  assert.equal(missing.status, "MISSING");
});
test("native CLI never turns absent Studio or unpublished A241 contract into success", () => {
  const result = checkStudioPageModules();
  assert.equal(result.status, "MISSING");
  assert.equal(result.findings.filter(row => row.rule === "missing-input").length, 3);
});

test("a type-only import cannot establish value provenance", () => {
  const result = measure(undefined, (source, name) => name === "studio/director.tsx" ? source.replace("import {project", "import type {project") : source);
  assert.ok(has(result, "manifest-consumption-provenance"));
});
test("A242 supersedes the old Needs/checks reuse even with distinct source", () => {
  const result = measure(entries => { const needs = entries[1].actions.find(row => row.label === "Needs"); needs.moduleSection = "sections.status-list"; needs.moduleSource = "designer.selection-needs"; });
  assert.ok(has(result, "page-module-mapping"));
});

function nativeFixture(change = () => {}, sourceChange = source => source) {
  const setup = fixture();
  const { input } = setup;
  const entries = input.pages.map(page => ({ id: page.role, kind: "page", actions: page.actions.map(action => {
    const raw = JSON.parse(action.node.getText(input.program.getSourceFile(input.manifestFile)));
    const { moduleSection, moduleSource, ...rest } = raw;
    return moduleSection ? { ...rest, module: { section: moduleSection, ...(moduleSource ? { source: moduleSource } : {}) } } : rest;
  }) }));
  const document = { map: { entries }, pageActions: Object.fromEntries(entries.map(entry => [entry.id, structuredClone(entry.actions)])), routes: entries.map(entry => ({ instanceId: entry.id, entry: { file: `studio/${entry.id}.tsx`, export: "default" } })) };
  change(document);
  const manifestFile = path.join(input.root, "studio/generated/studio-map.json"), projectionFile = path.join(input.root, "studio/generated/studio-map.ts");
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, JSON.stringify(document));
  fs.writeFileSync(projectionFile, sourceChange("import projection from './studio-map.json';export const studioPageActions=projection.pageActions;export const studioHome=projection.map.entries[0];", "projection"));
  for (const entry of entries) fs.writeFileSync(path.join(input.root, `studio/${entry.id}.tsx`), sourceChange(`import {studioPageActions as actions} from './generated/studio-map.js';export function Page(){return <Host actions={actions['${entry.id}']}/>}`, entry.id));
  const program = ts.createProgram([...input.program.getRootFileNames(), manifestFile, projectionFile], { ...input.program.getCompilerOptions(), resolveJsonModule: true });
  const adapted = adaptPublishedStudioActions({ program, manifestFile, studioSourceRoot: input.studioSourceRoot });
  const moduleRoot = program.getSourceFile(path.join(input.root, "module.tsx")).statements.find(ts.isFunctionDeclaration);
  const sections = new Map([...input.sections.keys()].map(leaf => [leaf, { roots: [moduleRoot] }]));
  return { ...setup, adapted, checkNative: () => analyzeStudioPageModules({ ...input, program, manifestFile, publisherProjectionFile: projectionFile, publisherProjectionExport: "studioPageActions", sections, pages: adapted.pages, consumers: adapted.consumers }) };
}
test("published H1 field shape carries the revised A242 assertions through native JSON symbols", () => {
  const setup = nativeFixture();
  try {
    assert.equal(setup.adapted.status, "ADAPTED");
    assert.equal(setup.adapted.pages.length, 5);
    assert.deepEqual(setup.checkNative().findings, []);
  } finally { setup.dispose(); }
});
test("native projected arrays cannot silently drift from Publisher entry.actions", () => {
  const setup = nativeFixture(document => { document.pageActions.director[0].label = "Forged"; });
  try { assert.equal(setup.adapted.status, "FINDINGS"); } finally { setup.dispose(); }
});
test("old A238 native projections report missing A241 actions", () => {
  const setup = nativeFixture(document => { delete document.map.entries[0].actions; });
  try { assert.equal(setup.adapted.status, "MISSING"); } finally { setup.dispose(); }
});
test("another export from the same native projection cannot impersonate actions", () => {
  const setup = nativeFixture(undefined, (source, name) => name === "director" ? source.replace("studioPageActions as actions", "studioHome as actions") : source);
  try { assert.ok(has(setup.checkNative(), "manifest-consumption-provenance")); } finally { setup.dispose(); }
});
test("a native consumer cannot select a different page's action array", () => {
  const setup = nativeFixture(undefined, (source, name) => name === "director" ? source.replace("actions['director']", "actions['writer']") : source);
  try { assert.ok(has(setup.checkNative(), "wrong-page-manifest-consumption")); } finally { setup.dispose(); }
});
test("a dynamic native action key needs manifest identity provenance", () => {
  const setup = nativeFixture(undefined, (source, name) => name === "director" ? source.replace("export function", "const arbitrary=String(Math.random());export function").replace("actions['director']", "actions[arbitrary]") : source);
  try { assert.ok(has(setup.checkNative(), "unproven-page-manifest-key")); } finally { setup.dispose(); }
});
test("A241.1 removes old specialized modules and leaves Home with Needs only", () => {
  const result = measure(entries => {
    entries[0].actions.find(action => action.label === "Inspector").label = "Details";
    for (const label of ["Preview", "Locales", "Voice", "Site map", "Search & social"]) entries[1].actions.push({ id: label, label, icon: "assets.icon", defaultOpen: false, moduleSection: "sections.explorer" });
    entries[4].actions = [{ id: "activity", label: "Activity", icon: "assets.icon", defaultOpen: false, moduleSection: "sections.activity-feed" }];
  });
  assert.ok(result.findings.filter(row => row.rule === "page-action-contract").length >= 3);
});
test("native Apps navigation, command children and intent artifacts are rejected", () => {
  const setup = nativeFixture(document => {
    document.navigation = { home: { tree: [{ id: "apps", href: "/apps", children: [{ id: "publication:site", href: "/apps?publication=site" }] }] } };
    document.commands = [{ items: [{ id: "apps", href: "/apps" }] }];
    document.pageActions.apps = [{ id: "open-selected-app-dev-server", intent: "open-app-dev-server" }];
  });
  try { assert.ok(setup.adapted.findings.filter(row => row.rule === "removed-apps-surface").length >= 6); } finally { setup.dispose(); }
});
test("A242 body checks report the specific unpublished binding authority and actual inline JSX", () => {
  const setup = fixture(undefined, (source, name) => name === "studio/director.tsx" ? source.replace("<Host actions={selected}/>", "<div><UnboundSection/></div>") : source);
  try {
    const findings = inspectUnboundStudioPageBodies(setup.input);
    assert.ok(findings.some(row => row.rule === "missing-native-body-binding-contract"));
    assert.ok(findings.some(row => row.page === "director" && row.rule === "raw-page-body-element"));
    assert.ok(findings.some(row => row.page === "director" && row.rule === "unbound-page-section"));
  } finally { setup.dispose(); }
});
test("the ST-3 specimen awaits a native L3 port without being mislabeled a raw component leaf", () => {
  const setup = fixture(undefined, (source, name) => name === "studio/designer.tsx" ? source.replace("<Host actions={selected}/>", "<Specimen/>") : source);
  try {
    const findings = inspectUnboundStudioPageBodies(setup.input);
    assert.ok(findings.some(row => row.page === "designer" && row.rule === "unbound-page-section"));
    assert.ok(!findings.some(row => row.page === "designer" && row.rule === "raw-interactive-element"));
  } finally { setup.dispose(); }
});
test("a wrapper containing StudioFrame cannot impersonate the exact frame export", () => {
  const setup = fixture();
  try {
    const frameFile = path.join(setup.input.studioSourceRoot, "components/StudioFrame.tsx");
    fs.mkdirSync(path.dirname(frameFile), { recursive: true });
    fs.writeFileSync(frameFile, "export function StudioFrame(){return null}");
    const pageFile = path.join(setup.input.studioSourceRoot, "director.tsx");
    fs.writeFileSync(pageFile, "import {StudioFrame as Frame} from './components/StudioFrame.js';function Wrapped(){return <Frame/>}export function Page(){return <Wrapped/>}");
    const program = ts.createProgram([...setup.input.program.getRootFileNames(), frameFile], setup.input.program.getCompilerOptions());
    const findings = inspectUnboundStudioPageBodies({ ...setup.input, program, consumers: [{ pageRole: "director", sourceFile: program.getSourceFile(pageFile), bindings: [] }] });
    assert.ok(findings.some(row => row.rule === "unbound-page-section" && row.detail.startsWith("Wrapped ")));
    assert.ok(!findings.some(row => row.rule === "unbound-page-section" && row.detail.startsWith("Frame ")));
  } finally { setup.dispose(); }
});

// This shape is extracted from H1 2d68fae, not the superseded A243 table/container shape.
const nativeBody = () => ({ template: "ia-scroll", bands: { L0: "sections.section-header", L1: "sections.section-header", L2: "sections.cards" }, row: { columns: ["title", "specimen", "status", "version", "usedBy", "linkOut"] } });
function bodyFixture(change = () => {}, sourceChange = source => source) {
  const setup = nativeFixture(document => {
    document.pageBodies = {};
    for (const entry of document.map.entries.filter(entry => entry.id !== "home")) {
      entry.body = nativeBody(); document.pageBodies[entry.id] = structuredClone(entry.body);
    }
    change(document);
  }, (source, name) => {
    if (name === "projection") source += "export const studioPageBodies=projection.pageBodies;export function studioPageBody(pageId:string,boundSpecimenId:string){return { ...studioPageBodies[pageId],row:{...studioPageBodies[pageId].row,specimen:boundSpecimenId}}}";
    else if (name !== "home") source = `import {studioPageBodies as bodies} from './generated/studio-map.js';import {Module as Section} from '../module.js';export function Page(){return <Section binding={bodies['${name}'].bands.L0}/>}`;
    return sourceChange(source, name);
  });
  const { input } = setup;
  const manifestFile = path.join(input.root, "studio/generated/studio-map.json");
  const program = ts.createProgram([...input.program.getRootFileNames(), manifestFile, path.join(input.root, "studio/generated/studio-map.ts")], { ...input.program.getCompilerOptions(), resolveJsonModule: true });
  const adapted = adaptPublishedStudioActions({ program, manifestFile, studioSourceRoot: input.studioSourceRoot });
  const moduleRoot = program.getSourceFile(path.join(input.root, "module.tsx")).statements.find(ts.isFunctionDeclaration);
  const sections = new Map(["sections.section-header", "sections.cards", "sections.specimen-test"].map(leaf => [leaf, { roots: [moduleRoot] }]));
  return { ...setup, bodies: () => adaptPublishedStudioBodies({ program, manifestFile }), inspect: () => inspectUnboundStudioPageBodies({ ...input, program, manifestFile, sections, consumers: adapted.consumers }) };
}
test("current native body adapter accepts cards bands without invented containers", () => {
  const setup = bodyFixture();
  try { assert.equal(setup.bodies().status, "ADAPTED"); assert.equal(setup.bodies().pages.length, 4); assert.deepEqual(setup.inspect().filter(row => row.page !== "home"), []); } finally { setup.dispose(); }
});
test("native body projection cannot drift from entry.body", () => {
  const setup = bodyFixture(document => { document.pageBodies.director.bands.L2 = "sections.data-table"; });
  try { assert.ok(has(setup.bodies(), "native-body-projection-drift")); } finally { setup.dispose(); }
});
test("A244 rejects superseded table bands and container/span/layout overrides", () => {
  const setup = bodyFixture(document => { const body = document.map.entries.find(row => row.id === "director").body; body.bands.L2 = "sections.data-table"; body.container = "table"; body.row.span = "half"; body.row.layout = "grid"; document.pageBodies.director = structuredClone(body); });
  try { assert.ok(has(setup.bodies(), "page-body-bands")); assert.equal(setup.bodies().findings.filter(row => row.rule === "superseded-body-field").length, 3); } finally { setup.dispose(); }
});
test("Home cannot acquire an IA body declaration", () => {
  const setup = bodyFixture(document => { document.map.entries.find(row => row.id === "home").body = nativeBody(); document.pageBodies.home = nativeBody(); });
  try { assert.ok(has(setup.bodies(), "home-body-declaration")); assert.ok(has(setup.bodies(), "unexpected-projected-body")); } finally { setup.dispose(); }
});
test("published bodies without a consumer remain findings instead of stale missing authority", () => {
  const setup = bodyFixture(undefined, (source, name) => name === "director" ? "export function Page(){return <Unbound/>}" : source);
  try { const findings = setup.inspect(); assert.ok(findings.some(row => row.rule === "missing-native-body-consumption" && row.page === "director")); assert.ok(!findings.some(row => row.rule === "missing-native-body-binding-contract")); } finally { setup.dispose(); }
});
test("body export aliases preserve exact page identity", () => {
  const setup = bodyFixture(undefined, (source, name) => name === "director" ? source.replace("bodies['director']", "bodies['writer']") : source);
  try { assert.ok(setup.inspect().some(row => row.rule === "wrong-page-body-consumption")); } finally { setup.dispose(); }
});
test("arbitrary dynamic body keys are not native route identity", () => {
  const setup = bodyFixture(undefined, (source, name) => name === "director" ? source.replace("export function", "const key=String(Math.random());export function").replace("bodies['director']", "bodies[key]") : source);
  try { assert.ok(setup.inspect().some(row => row.rule === "unproven-page-body-key")); } finally { setup.dispose(); }
});
test("type-only body imports cannot bless a section", () => {
  const setup = bodyFixture(undefined, (source, name) => name === "director" ? source.replace("import {studioPageBodies", "import type {studioPageBodies") : source);
  try { assert.ok(setup.inspect().some(row => row.rule === "missing-native-body-consumption" && row.page === "director")); } finally { setup.dispose(); }
});
test("a named or registered section with an unrelated native body prop stays unbound", () => {
  const setup = bodyFixture(undefined, (source, name) => name === "director" ? source.replace(".bands.L0", "") : source);
  try { assert.ok(setup.inspect().some(row => row.rule === "unbound-page-section" && row.page === "director")); } finally { setup.dispose(); }
});
test("helper calls require a registered exact specimen identity", () => {
  const setup = bodyFixture(undefined, (source, name) => name === "director" ? source.replace("studioPageBodies as bodies", "studioPageBody as bodies").replace("bodies['director']", "bodies('director', String(Math.random()))") : source);
  try { assert.ok(setup.inspect().some(row => row.rule === "unproven-bound-specimen")); } finally { setup.dispose(); }
});
test("authored native specimen identity and runtime binding cannot conflict", () => {
  const setup = bodyFixture(document => { const body = document.map.entries.find(row => row.id === "director").body; body.row.specimen = "sections.specimen-test"; document.pageBodies.director = structuredClone(body); }, (source, name) => name === "director" ? source.replace("studioPageBodies as bodies", "studioPageBody as bodies").replace("bodies['director']", "bodies('director', 'sections.specimen-other')") : source);
  try { assert.ok(setup.inspect().some(row => row.rule === "conflicting-bound-specimen")); } finally { setup.dispose(); }
});
test("a type-only exact StudioFrame import grants no body exemption", () => {
  const setup = fixture();
  try {
    const frameFile = path.join(setup.input.studioSourceRoot, "components/StudioFrame.tsx");
    fs.mkdirSync(path.dirname(frameFile), { recursive: true });
    fs.writeFileSync(frameFile, "export function StudioFrame(){return null}");
    const pageFile = path.join(setup.input.studioSourceRoot, "director.tsx");
    fs.writeFileSync(pageFile, "import type {StudioFrame as Frame} from './components/StudioFrame.js';export function Page(){return <Frame/>}");
    const program = ts.createProgram([...setup.input.program.getRootFileNames(), frameFile], setup.input.program.getCompilerOptions());
    const findings = inspectUnboundStudioPageBodies({ ...setup.input, program, consumers: [{ pageRole: "director", sourceFile: program.getSourceFile(pageFile), bindings: [] }] });
    assert.ok(findings.some(row => row.rule === "unbound-page-section" && row.detail.startsWith("Frame ")));
  } finally { setup.dispose(); }
});
