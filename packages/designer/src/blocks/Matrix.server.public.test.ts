import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import ts from "typescript";
import { Matrix as ServerMatrix } from "./Matrix.server.js";
import { Matrix as OrdinaryMatrix, type MatrixProps } from "./Matrix.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sides = [{ id: "a", heading: "First", points: ["One", "Two"] }, { id: "b", heading: "Second", points: ["Three", "Four"] }] as const;
const grid = { arrangement: "grid", columns: [{ id: "a", label: "A" }, { id: "b", label: "B" }], rows: [
  { id: "one", label: "One", cells: { a: { type: "text", text: "A1" }, b: { type: "text", text: "B1" } } },
  { id: "two", label: "Two", cells: { a: { type: "text", text: "A2" }, b: { type: "text", text: "B2" } } },
] } as const;
const html = (component: typeof OrdinaryMatrix | typeof ServerMatrix, props: unknown) => renderToStaticMarkup(createElement(component as typeof OrdinaryMatrix, props as MatrixProps));
it("source server Matrix preserves the byte-identical ordinary sides/grid output", () => {
  for (const ground of ["base", "sunken", "inverse"] as const) {
    for (const props of [
      { sides, ground, featured: "a", headingLevel: 4, className: "authored extra", "aria-label": "Compare", style: { maxWidth: 800 } },
      { arrangement: "sides", sides: sides.map(side => ({ id: side.id, label: side.heading, heading: side.heading, description: side.id === "a" ? "Lead" : undefined, visual: createElement("svg", { "aria-label": side.id }) })), ground },
      { ...grid, ground, featured: { column: "b" }, featuredLabel: "Chosen", "aria-label": "Table" },
      { ...grid, ground, rows: grid.rows.map(row => ({ ...row, cells: { a: { type: "mark", value: 3 }, b: { type: "empty" } } })), markLabels: ["None", "Some", "Half", "Most", "All"], emptyLabel: "Absent", keyLabel: "Legend" },
    ]) expect(html(ServerMatrix, props)).toBe(html(OrdinaryMatrix, props));
  }
});
it("source server Matrix preserves original sides/grid validation refusals", () => {
  for (const props of [
    {}, { sides: [sides[0]] }, { sides: [sides[0], sides[0]] }, { sides, featured: "foreign" },
    { sides, ground: "unknown" }, { sides, headingLevel: 1 },
    { sides: [sides[0], { ...sides[1], points: ["One"] }] },
    { ...grid, sides }, { ...grid, columns: [] }, { ...grid, rows: [] },
    { ...grid, featured: { row: "one", column: "a" }, featuredLabel: "Chosen" },
    { ...grid, rows: [{ ...grid.rows[0], cells: {} }, grid.rows[1]] },
  ]) {
    let ordinary: unknown;
    try { html(OrdinaryMatrix, props); } catch (error) { ordinary = error; }
    expect(ordinary).toBeInstanceOf(TypeError);
    expect(() => html(ServerMatrix, props)).toThrow((ordinary as Error).message);
  }
  for (const arrangement of ["choices", "library-board", "unknown"])
    expect(() => html(ServerMatrix, { arrangement })).toThrow("Matrix: server entry supports only sides and grid arrangements.");
});
it("compiled public server Matrix runs both finite arrangements under actual react-server", () => {
  const entry = join(root, "dist/blocks/server.js");
  const script = `import {Matrix} from ${JSON.stringify(entry)}; function nodes(n){if(Array.isArray(n))return n.flatMap(nodes);if(!n||typeof n!=="object"||!n.props)return [];if(typeof n.type==="function")return nodes(n.type(n.props));return[n,...nodes(n.props.children)];}const sides=${JSON.stringify(sides)},grid=${JSON.stringify(grid)};const s=nodes(Matrix({sides})),g=nodes(Matrix(grid));if(s.filter(n=>n.props["data-matrix-side"]!==undefined).length!==2||g.filter(n=>n.type==="table").length!==1||g.filter(n=>n.type==="th"&&n.props.scope==="col").length!==2)throw Error("static semantic output lost");for(const arrangement of["choices","library-board","unknown"]){let caught=false;try{Matrix({arrangement})}catch(e){if(e.message!=="Matrix: server entry supports only sides and grid arrangements.")throw e;caught=true}if(!caught)throw Error("interactive server arrangement accepted")}process.stdout.write("OK");`;
  expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 })).toBe("OK");
});
it("compiled Matrix declarations narrow only server arrangements and preserve ordinary interactive contracts", () => {
  const filename = join(root, "matrix-server-consumer.check.ts");
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const diagnostics = (text: string) => {
    const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, text, language, true) : original(path, language, error, fresh);
    return ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
  };
  const server = `import type * as B from ${JSON.stringify(join(root, "dist/blocks/server.js"))};`;
  expect(diagnostics(`${server}const sides:B.MatrixProps=${JSON.stringify({ sides })};const grid:B.MatrixProps=${JSON.stringify(grid)};type S=B.MatrixSide;type Q=B.MatrixQuadrantProps;type G=B.MatrixGridProps;type C=B.MatrixCellData;type H=B.MatrixHeadingLevel;`)).toEqual([]);
  for (const arrangement of ["choices", "library-board"]) {
    const result = diagnostics(`${server}type Interactive=Extract<B.MatrixProps,{arrangement:${JSON.stringify(arrangement)}}>;const interactive:Interactive={} as unknown;`);
    expect(result).toHaveLength(1); expect(result[0]?.code).toBe(2322);
    for (const entry of ["index.js", "blocks/index.js"]) {
      const ordinary = `import type * as B from ${JSON.stringify(join(root, "dist", entry))};type Interactive=Extract<B.MatrixProps,{arrangement:${JSON.stringify(arrangement)}}>;type Present=Interactive extends never?false:true;const present:Present=true;`;
      expect(diagnostics(ordinary)).toEqual([]);
    }
  }
  // Compile the whole emitted dependency graph, not only the consumer errors.
  expect(readFileSync(join(root, "dist/blocks/Matrix.server.d.ts"), "utf8")).toContain("MatrixProps = MatrixQuadrantProps | MatrixGridProps");
}, 30_000);

it("compiled public server PricingTable preserves fixed/interval comparison output and refusals under actual react-server", () => {
  const entry = join(root, "dist/blocks/server.js");
  const script = `import {PricingTable} from ${JSON.stringify(entry)};
function tree(n){if(Array.isArray(n))return n.map(tree).flat().filter(v=>v!==null);if(n===null||n===undefined||typeof n==="boolean")return null;if(typeof n!=="object")return n;if(n.type===Symbol.for("react.fragment"))return tree(n.props.children);if(typeof n.type==="function")return tree(n.type(n.props));if(typeof n.type?.render==="function")return tree(n.type.render(n.props,null));if(typeof n.type!=="string")throw Error("unresolved native element");const props={};for(const k of Object.keys(n.props).sort())if(k!=="children"&&typeof n.props[k]!=="function")props[k]=n.props[k];return {tag:n.type,props,children:tree(n.props.children)};}
const tiers=[{id:"starter",name:"Starter",price:"Fixed one",features:["Feature one"],cta:"Choose one"},{id:"team",name:"Team",price:"Fixed two",features:["Feature two"],cta:"Choose two",isHighlighted:true,badge:"Featured"}];
const intervals=tiers.map(({price,...t},i)=>({...t,priceByInterval:{a:{amount:"Amount a "+i,priceText:"Spoken a "+i},b:{amount:"Amount b "+i,priceText:"Spoken b "+i,note:"Annual note"}}}));
const groups=Array.from({length:4},(_,i)=>({id:"g"+i,label:"Group "+i,rows:[0,1].map(j=>({id:"r"+j,label:"Row "+i+" "+j,description:"Row description",cells:i===0?{starter:{kind:"mark",included:false},team:{kind:"mark",included:true}}:{starter:{kind:"text",text:"First "+j},team:{kind:"text",text:"Second "+j}}}))}));
const comparison={groups,featuredLabel:"Featured tier",markLabels:["None","Some","Half","Most","All"],keyLabel:"Legend"};
const output=[];for(const ground of["base","sunken","inverse"])for(const count of[1,2,3,4])for(const interval of[undefined,"b"]){const props={heading:"Plans",headingLevel:3,description:"Plan details",tiers:interval===undefined?tiers:intervals,interval,ground,comparison:{...comparison,groups:groups.slice(0,count)},controls:"Interval controls",dir:"rtl",id:"plans","aria-label":"Plan comparison",className:"authored",style:{maxWidth:900}};output.push(tree(PricingTable(props)));}
const invalid=[{tiers:[{...tiers[0],priceByInterval:intervals[0].priceByInterval}],interval:"b"},{tiers:intervals},{tiers:intervals,interval:"unknown"},{tiers,interval:"b"},{tiers,comparison:{...comparison,groups:[]}},{tiers,comparison:{...comparison,groups:[...groups,groups[0]]}},{tiers,comparison:{...comparison,groups:[groups[0],groups[0]]}},{tiers:tiers.map(t=>({...t,isHighlighted:true})),comparison},{tiers,comparison:{...comparison,featuredLabel:undefined}},{tiers,comparison:{...comparison,markLabels:undefined}},{tiers,comparison:{...comparison,keyLabel:undefined}},{tiers,comparison:{...comparison,groups:[{...groups[0],rows:groups[0].rows.map(r=>({...r,cells:{starter:r.cells.starter}}))}]}}];
const errors=invalid.map(props=>{try{tree(PricingTable(props))}catch(e){if(e.name!=="TypeError"||!/^PricingTable:|^Matrix:/.test(e.message))throw e;return e.message}throw Error("invalid pricing accepted")});process.stdout.write(JSON.stringify({output,errors}));`;
  const run = (conditions: string[]) => JSON.parse(execFileSync(process.execPath, [...conditions, "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 }));
  const ordinary = run([]), server = run(["--conditions=react-server"]);
  expect(server).toEqual(ordinary);
  expect(server.output).toHaveLength(24);
  expect(server.errors).toHaveLength(12);
  const nodes = (value: any): any[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" ? [value, ...nodes(value.children)] : [];
  server.output.forEach((value: unknown, i: number) => {
    const all = nodes(value), count = Math.floor(i / 2) % 4 + 1;
    expect(all.filter(n => n.tag === "table")).toHaveLength(count);
    expect(all.filter(n => n.tag === "th" && n.props.scope === "col")).toHaveLength(count * 2);
    expect(all.filter(n => n.tag === "th" && n.props.scope === "row")).toHaveLength(count * 2);
    expect(value).toMatchObject({ tag: "div", props: { id: "plans", dir: "rtl", "aria-label": "Plan comparison", style: { maxWidth: 900 } } });
    const serialized = JSON.stringify(value);
    expect(serialized).toContain("Featured tier");
    expect(serialized).toContain("Legend");
    expect(serialized).toContain("None");
    expect(serialized).toContain("All");
    if (count > 1) expect(serialized).toContain("Second 1");
    expect(serialized).toContain(i % 2 === 0 ? "Fixed one" : "Spoken b 0");
    if (i % 2 === 1) expect(serialized).not.toContain("Spoken a 0");
    if (i >= 16) expect(serialized).toContain("text-ink-on-inverse");
  });
});
