import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes, createRequire } from "node:module";
import { resolve, relative } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
const root = resolve(process.argv[4] ?? process.cwd());
const base = "bf7c3a8c9bddf84f773df923fba9187db192b225";
const out = resolve(root, "coverage/tmp/te1-pushed-base");
mkdirSync(out,{recursive:true});
const mode = process.argv[2] ?? "current";
const scenario = process.argv[3] ?? "marketing";
assert.ok(["base","current","mutation-drop","mutation-map","mutation-spacing","mutation-scan"].includes(mode), "unknown mode");
assert.ok(["marketing","completed","producer"].includes(scenario), "unknown scenario");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
const sha = value => createHash("sha256").update(value).digest("hex");
const paths = new Set(git("ls-tree", "-r", "--name-only", base).toString().trim().split("\n"));
const sources = new Map(), loaded = new Map();
const prefix = pathToFileURL(root + "/").href;
function source(path) {
  if (sources.has(path)) return sources.get(path);
  let bytes = mode === "base" ? git("show", base + ":" + path) : readFileSync(resolve(root,path));
  if(mode==="mutation-map" && path==="packages/designer/src/catalog-core/emit.ts") bytes=Buffer.from(bytes.toString().replace('"font-size": "text", ',""));
  if(mode==="mutation-scan" && path==="packages/designer/src/compiled-css/class-scan.ts") bytes=git("show",base+":"+path);
  sources.set(path, bytes); return bytes;
}
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(prefix) && specifier.startsWith(".")) {
      let path = relative(root, fileURLToPath(new URL(specifier, context.parentURL)));
      const choice = [path, path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx"), path + ".ts", path + "/index.ts"].find(x => paths.has(x));
      if (choice) return { url: pathToFileURL(resolve(root, choice)).href, shortCircuit: true };
    }
    const result=next(specifier, context);
    if(result.url?.includes("/packages/") && result.url.includes("/dist/")) throw new Error("Compiled package forbidden: "+result.url);
    return result;
  },
  load(url, context, next) {
    if (url.startsWith(prefix)) {
      const path = relative(root, fileURLToPath(url));
      if (paths.has(path) && /^packages\/.*\/src\/.*\.(ts|tsx|json)$/.test(path)) {
        const bytes = source(path); loaded.set(path, sha(bytes));
        if (path.endsWith(".json")) return { format: "json", source: bytes.toString(), shortCircuit: true };
        if (path.endsWith(".tsx")) {
          const ts = require("typescript");
          return { format: "module", source: ts.transpileModule(bytes.toString(), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText, shortCircuit: true };
        }
        return { format: "module", source: stripTypeScriptTypes(bytes.toString(), { mode: "transform" }), shortCircuit: true };
      }
    }
    return next(url, context);
  }
});
const { loadCatalog } = await import(pathToFileURL(resolve(root, "packages/designer/src/catalog-core/index.ts")));
const { completedTokenLibrary } = await import(pathToFileURL(resolve(root, "packages/designer/src/importers/__fixtures__/completed-token-library.ts")));
const { resolve: resolveValues } = await import(pathToFileURL(resolve(root, "packages/designer/src/catalog-core/resolve.ts")));
const { emit, emittedTokenProperties } = await import(pathToFileURL(resolve(root, "packages/designer/src/catalog-core/emit.ts")));
const { parseTokenCss, tokenVarProperties } = await import(pathToFileURL(resolve(root, "packages/designer/src/catalog-core/token-css-syntax.ts")));
const require = createRequire(resolve(root, "package.json")), { walk, generate } = require("css-tree");
const { applyLibraryChange, libraryHash, resolve: resolveProfile } = await import(pathToFileURL(resolve(root, "packages/designer/src/catalog-core/api.ts")));
const chooserPath = "packages/designer/src/studio/marketing-component-selection.tsx";
const chooserSource = source(chooserPath).toString();
const start = chooserSource.indexOf("  const catalog = loadCatalog();");
const end = chooserSource.indexOf("  const css = ", start);
assert.ok(start >= 0 && end > start);
const chooser = "function choose() {\n" + chooserSource.slice(start,end) + "\nreturn {catalog,library:values,profile:resolved};\n}";
const choose = new Function("loadCatalog","applyLibraryChange","libraryHash","resolve",stripTypeScriptTypes(chooser,{mode:"transform"})+"\nreturn choose();");
let {catalog,library,profile} = choose(loadCatalog,applyLibraryChange,libraryHash,resolveProfile);
if(scenario==="completed"){ catalog=loadCatalog(); library=completedTokenLibrary(catalog,{id:"specimen-test-consumer",kind:"consumer",author:"consumer",license:"MIT"},"2026-10-29"); profile=resolveValues({catalog,library}); }

if(scenario==="producer"){
  catalog=loadCatalog();
  const producerPath="packages/producer/src/server/selection-defaults.ts",text=source(producerPath).toString();
  const a=text.indexOf("  const absentValues = "), b=text.indexOf("  const literal = ",a);
  assert.ok(a>=0&&b>a);
  const fragment="function choose(catalog, values) {\nconst meta = fill => fill.$extensions['com.clossys.fill'];\n"+text.slice(a,b)+"\nreturn {library:values,profile};\n}";
  const run=new Function("applyLibraryChange","libraryHash","resolve",stripTypeScriptTypes(fragment,{mode:"transform"})+"\nreturn choose;");
  const seed={source:{id:"studio",kind:"consumer",author:"consumer",license:"MIT",extends:"foundry"},adoptedAt:"2026-10-29",fills:[]};
  ({library,profile}=run(applyLibraryChange,libraryHash,resolveProfile)({values:catalog},seed));
  loaded.set(producerPath,sha(source(producerPath)));
}

loaded.set(chooserPath,sha(source(chooserPath)));
const selected = Object.entries(profile.members).filter(([id,m]) => id==="tokens.display-face.weight" || ["fontFamily","fontWeight"].includes(m.$type)||["tokens.line-height","tokens.letter-spacing","tokens.spacing","tokens.radius"].includes(m.slot)||m.$type==="dimension"&&["font","body","heading","display","caption"].some(s=>m.slot.endsWith(s+"-size")));
const counts = {TYPE:selected.filter(([,m])=>!["tokens.spacing","tokens.radius"].includes(m.slot)).length,SPACING:selected.filter(([,m])=>m.slot==="tokens.spacing").length,RADIUS:selected.filter(([,m])=>m.slot==="tokens.radius").length};
const {TOKENS}=await import(pathToFileURL(resolve(root,"packages/designer/src/tokens/tokens.ts")));
const before = JSON.stringify(profile);
const properties = emittedTokenProperties(profile);
let files = emit(profile, ["css-brand","css-scales"], {header:false});
if(mode==="mutation-drop"){ const before=JSON.stringify(files); files=files.map(file=>({...file,contents:file.contents.split("\n").filter(line=>!line.trimStart().startsWith("--text-base:")).join("\n")})); assert.notEqual(JSON.stringify(files),before,"mutation must remove an actual emitted declaration"); }
if(mode==="mutation-spacing"){ const before=JSON.stringify(files); files=files.map(file=>({...file,contents:file.contents.split("\n").filter(line=>!line.trimStart().startsWith("--spacing-lg:")).join("\n")})); assert.notEqual(JSON.stringify(files),before,"mutation must remove the actual spacing declaration"); }
const declarations = [];
for (const file of files) walk(parseTokenCss(file.contents), {visit:"Declaration",enter(node){declarations.push({file:file.path,property:node.property,value:generate(node.value)});}});
const missing = selected.filter(([id,member]) => {
  const property=properties.get(id)?.property;
  return !property || !declarations.some(d=>d.property===property && d.value===generate(parseTokenCss(member.css.light,"value")));
}).map(([id])=>id);
assert.equal(JSON.stringify(profile),before);

const {check:checkCatalog}=await import(pathToFileURL(resolve(root,"packages/designer/src/catalog-core/api.ts")));
const c4=checkCatalog({catalog,library:{source:library.source,adoptedAt:library.adoptedAt,fills:[]}}).findings.filter(f=>f.code==="C4"&&f.severity==="error");
assert.deepEqual(c4,[]);
if(mode!=="base"){
  for(const path of ["packages/designer/src/tokens/tokens.ts","packages/designer/styles/tokens.css","packages/designer/styles/theme-keys.css","packages/designer/src/catalog/slots/tokens.json"]){
    const current=source(path).toString(),original=git("show",base+":"+path).toString();
    const stripped=current.split("\n").filter(line=>!(line.includes("--text-display-2xl")||line.includes("--text-heading-2xl"))).join("\n");
    assert.equal(stripped,original,"all previous source declarations must remain byte-identical: "+path);
  }
}
const preservedIdsPath = resolve(out,"h1-harness/scripts/evidence/ts1-portable-harness/preserved-member-ids.json");
const preservedProducerIds = scenario!=="producer" ? "not applicable" : existsSync(preservedIdsPath) ? "verified against optional historical harness" : "unavailable: optional historical harness absent";
if(scenario==="producer" && existsSync(preservedIdsPath)){
 const ids=JSON.parse(readFileSync(preservedIdsPath));
 assert.deepEqual(selected.map(([id])=>id),ids);
}

const valuesHash=sha(JSON.stringify(Object.fromEntries(Object.entries(profile.members).map(([id,m])=>[id,{value:m.value,css:m.css,alias:m.alias}]))));
// Real rendered classes drive this check independently of the generator's
// candidate extraction. Additional DOM captures widen the measured scope.
const { DialogFooter } = await import(pathToFileURL(resolve(root,"packages/designer/src/components/preview-runtime/components/dialog/dialog.tsx")));
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const renderedInputs = [{ name:"native DialogFooter", html:renderToStaticMarkup(createElement(DialogFooter,null,"Footer")) }, ...process.argv.slice(5).map(path=>({name:relative(root,resolve(path)),html:readFileSync(resolve(path),"utf8")}))];
const classes = [...new Set(renderedInputs.flatMap(input=>[...input.html.matchAll(/class=["']([^"']*)["']/g)].flatMap(match=>match[1].split(/\s+/).filter(Boolean))))];
assert.ok(classes.includes("-mb-(--spacing-lg)"),"real footer must render the reported negative spacing class");
const { scanCompiledCssSources } = await import(pathToFileURL(resolve(root,"packages/designer/src/compiled-css/scan-sources.ts")));
const { generateCompiledCss } = await import(pathToFileURL(resolve(root,"packages/designer/src/compiled-css/generate.ts")));
const scan = scanCompiledCssSources(resolve(root,"packages/designer"));
const generated = await generateCompiledCss({stylesDir:resolve(root,"packages/designer/styles"),candidates:scan.candidates});
const direct = await generateCompiledCss({stylesDir:resolve(root,"packages/designer/styles"),candidates:classes});
const rules = new Set(), references = new Set(classes.flatMap(name=>name.match(/--[A-Za-z0-9-]+/g)??[])), compiledDefinitions = new Set();
const compiledAst = parseTokenCss(generated.css);
walk(compiledAst,{visit:"Declaration",enter(node){if(node.property.startsWith("--")) compiledDefinitions.add(node.property);}});
walk(compiledAst,{visit:"Rule",enter(rule){
  const names=[];
  walk(rule.prelude,{visit:"ClassSelector",enter(node){names.push(require("css-tree").ident.decode(node.name));}});
  for(const name of names) rules.add(name);
  if(names.some(name=>classes.includes(name))) walk(rule.block,{visit:"Declaration",enter(node){for(const property of tokenVarProperties(node.value)) if(!compiledDefinitions.has(property)) references.add(property);}});
}});
const directRules = new Set();
walk(parseTokenCss(direct.css),{visit:"ClassSelector",enter(node){directRules.add(require("css-tree").ident.decode(node.name));}});
const nonsense = await generateCompiledCss({stylesDir:resolve(root,"packages/designer/styles"),candidates:["not-a-real-utility-(--spacing-lg)","-mb-(--spacing-lg"]});
assert.ok(!nonsense.css.includes(".not-a-real-utility-") && !nonsense.css.includes("margin-bottom:"),"nonsense candidates must not become utility rules");
const classCoverage = {inputs:renderedInputs.map(input=>({name:input.name,sha256:sha(input.html)})),classes,referencedProperties:[...references].sort(),missingDeclarations:[...references].filter(property=>!declarations.some(row=>row.property===property)),missingCompiledRules:classes.filter(name=>!rules.has(name)),missingDirectCandidateRules:classes.filter(name=>!directRules.has(name)),nonsenseControl:"no utility rules",scanFiles:scan.filesScanned,scanCandidates:scan.candidates.length,compiledCssSha256:sha(generated.css),directCssSha256:sha(direct.css)};
const report={mode,base,registryCount:Object.keys(TOKENS).length,registry:TOKENS,c4Errors:c4.length,sourceHead:git("rev-parse","HEAD").toString().trim(),sourceTree:mode==="base" || !git("diff","HEAD","--name-only").toString().trim() ? git("rev-parse",(mode==="base"?base:"HEAD")+"^{tree}").toString().trim() : null,sourceMode:mode==="base"?"git baseline":"applied checkout",preservedProducerIds,scenario,profile:{consumer:profile.consumer,selectionHash:profile.selectionHash,memberCount:Object.keys(profile.members).length,selectedCount:selected.length,counts},missingCount:missing.length,missing,valuesHash,properties:Object.fromEntries(selected.map(([id])=>[id,properties.get(id)])),loadedSourceCount:loaded.size,loadedSourceDigest:sha(JSON.stringify(Object.fromEntries(loaded))),declarations:declarations.filter(d=>selected.some(([id])=>properties.get(id)?.property===d.property)),cssSha256:sha(files.map(f=>f.contents).join("\n"))};
report.classCoverage=classCoverage;
writeFileSync(resolve(out,mode+"-"+scenario+"-coverage.json.gz"),gzipSync(JSON.stringify(report,null,2)+"\n"));
console.log(JSON.stringify({mode,sourceHead:report.sourceHead,sourceTree:report.sourceTree,sourceMode:report.sourceMode,preservedProducerIds,profile:report.profile,missingCount:missing.length,missing,valuesHash,loadedSourceCount:loaded.size,classCoverage}));
if(mode!=="base"){
  assert.equal(Object.keys(TOKENS).length,232);
  assert.deepEqual({selected:missing,declarations:classCoverage.missingDeclarations,rules:classCoverage.missingCompiledRules,direct:classCoverage.missingDirectCandidateRules},{selected:[],declarations:[],rules:[],direct:[]},"every selected token and every rendered class token family/rule must be present");
}
