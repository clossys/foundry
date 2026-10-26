import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const { ComboBox, Label, SearchField, TextField } = createRequire(import.meta.url)("react-aria-components") as typeof import("react-aria-components");
import slots from "../catalog/slots/components.json" with { type: "json" };
import foundryTextField from "../catalog/fills/foundry/components.text-field.json" with { type: "json" };
import { importShadcnAriaComponents, type ShadcnComponentInput } from "./shadcn-aria-components.js";
import { rewriteShadcnAria } from "./rewrite.js";
import ts from "typescript";

const fixture = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const bytes = (name: string) => readFileSync(resolve(fixture, name), "utf8");
const input = (): ShadcnComponentInput => ({
  items: readdirSync(fixture).filter(name => name.endsWith(".json")).map(name => JSON.parse(bytes(name))).filter(item => item.type === "registry:ui"),
  styles: { path: "apps/v4/registry/styles/style-nova.css", content: bytes("style-nova.css") },
  notice: { path: "LICENSE.md", content: bytes("LICENSE.md") },
});
const imported = () => importShadcnAriaComponents(input());
const partSource = 'import { Input } from "@/registry/bases/aria/ui/input"\nimport { Textarea } from "@/registry/bases/aria/ui/textarea"\nexport const part = <><Input {...props} /><Textarea {...props} /></>';
const partRewrite = (content = partSource, leafByItem: Record<string, string> = { input: "text-field", textarea: "text-field" }) => rewriteShadcnAria({
  item: "select", leaf: "select", files: [{ path: "components/_parts/input-group/input-group.tsx", content }], styles: "", leafByItem,
});

afterEach(cleanup);

describe("select and combo-box source closure", () => {
  it("keeps the selected text-field structurally complete without claiming observations", () => {
    const fill = foundryTextField.components["text-field"];
    const contract = slots.find(slot => slot.id === fill.slot)!.contract;
    expect(fill.members.slice().sort()).toEqual(contract.members.names!.slice().sort());
    expect(foundryTextField.$extensions["com.clossys.fill"].evidence).toEqual([]);
    expect(foundryTextField.$extensions["com.clossys.fill"].status).toBe("draft");
  });
  it("maps exactly every supported select and combo-box member to observed source", () => {
    const result = imported();
    for (const leaf of ["select", "combo-box"]) {
      const fill = result.fills.find(doc => doc.components[leaf])!.components[leaf]!;
      const contract = slots.find(slot => slot.id === fill.slot)!.contract;
      expect(fill.members.slice().sort()).toEqual(contract.members.names!.slice().sort());
      expect(Object.keys(fill.propMap).sort()).toEqual(fill.members.slice().sort());
    }
    expect(result.rewrites.select!.files.find(file => file.path === "components/select/select.tsx")!.content).toContain('size?: "sm" | "default" | "lg"');
  });
  it("binds labels to the selected field leaves and select heights to control-size", () => {
    const result = imported();
    const labelLeaves = (reads: readonly string[]) => [...new Set(reads.filter(read => /(?:body-size|caption-size|typeface|font-size)(?:\.|$)/.test(read)).map(read => read.split(".").slice(0, 2).join(".")))].sort();
    for (const item of ["select", "combobox"]) {
      expect(labelLeaves(result.rewrites[item]!.reads.tokens)).toEqual(labelLeaves(foundryTextField.components["text-field"].reads.tokens));
      expect(result.rewrites[item]!.reads.tokens).toContain("tokens.elevation.floating");
    }
    const source = result.rewrites.select!.files.find(file => file.path === "components/select/select.tsx")!.content;
    for (const size of ["sm", "md", "lg"]) {
      expect(result.rewrites.select!.reads.tokens).toContain(`tokens.control-size.h-${size}`);
      expect(source).toContain(`--ui-control-h-${size}`);
    }
  });
  it("uses RAC Input and TextArea for InputGroup without introducing a TextField root", () => {
    const result = partRewrite();
    expect(result.files[0]!.content).toContain('import { Input } from "react-aria-components"');
    expect(result.files[0]!.content).toContain('import { TextArea as Textarea } from "react-aria-components"');
    expect(result.files[0]!.content).not.toMatch(/<TextField\b|text-field\/index/);
    expect(result.reads.components).not.toContain("components.text-field");
    expect(result.issues).toEqual([]);
    const whole = imported();
    for (const item of ["select", "combobox"]) expect(whole.rewrites[item]!.issues.filter(issue => issue.code === "K9")).toEqual([]);
    expect(whole.receipt.find(row => row.item === "input")).toMatchObject({ status: "rejected" });
    expect(whole.receipt.find(row => row.item === "textarea")).toMatchObject({ status: "rejected" });
  });
  it("keeps K9 when the selected leaf mapping is absent or an input export is unsupported", () => {
    expect(partRewrite(partSource, { textarea: "text-field" }).issues).toContainEqual(expect.objectContaining({ code: "K9", value: "input" }));
    expect(partRewrite(partSource.replace("{ Input }", "{ MissingInput }" )).issues).toContainEqual(expect.objectContaining({ code: "K9", value: "input" }));
  });
  it("runs the actual rewritten InputGroup inputs under RAC field contexts", async () => {
    const result = imported();
    const part = result.rewrites.select!.files.find(file => file.path === "components/_parts/input-group/input-group.tsx")!;
    const utils = result.rewrites.select!.files.find(file => file.path === "components/_parts/utils/index.ts")!;
    const parsed = ts.createSourceFile("input-group.tsx", part.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const names = ["InputGroup", "InputGroupInput", "InputGroupTextarea"];
    // Compile the tested declarations verbatim, without unrelated cva button/addon code.
    const contextSource = parsed.statements.filter(statement =>
      ts.isImportDeclaration(statement) && /^(?:react|react-aria-components)$|utils\/index\.js$/.test((statement.moduleSpecifier as ts.StringLiteral).text)
      || ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? "")
    ).map(statement => statement.getFullText(parsed)).join("\n") + "\nexport { " + names.join(", ") + " };";
    // Compile in Node: jsdom's Uint8Array realm is incompatible with esbuild.
    const bundled = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { readFileSync } from "node:fs";
      import { build } from "esbuild";
      const data = JSON.parse(readFileSync(0, "utf8"));
      const result = await build({ stdin: { contents: data.source, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "cjs", platform: "node", packages: "external", plugins: [{
        name: "generated-input-group",
        setup(builder) {
          builder.onResolve({ filter: /_parts\\/utils\\/index\\.js$/ }, () => ({ path: "utils", namespace: "generated" }));
          builder.onLoad({ filter: /.*/, namespace: "generated" }, () => ({ contents: data.utils, loader: "ts", resolveDir: process.cwd() }));
          builder.onResolve({ filter: /\\/button\\/index\\.js$/ }, (args) => ({ path: args.path, external: true }));
        },
      }] });
      process.stdout.write(result.outputFiles[0].text);
    `], { input: JSON.stringify({ source: contextSource, utils: utils.content }), encoding: "utf8" });
    const module = { exports: {} as Record<string, React.ComponentType<Record<string, unknown>>> };
    new Function("require", "exports", "module", bundled)(createRequire(import.meta.url), module.exports, module);
    const InputGroup = module.exports.InputGroup!;
    const InputGroupInput = module.exports.InputGroupInput!;
    const InputGroupTextarea = module.exports.InputGroupTextarea!;
    const changed = vi.fn();
    render(<ComboBox aria-label="Choice" onInputChange={changed}><Label>Choice</Label><InputGroup><InputGroupInput /></InputGroup></ComboBox>);
    const combo = screen.getByRole("combobox");
    fireEvent.change(combo, { target: { value: "Typed" } });
    expect(changed).toHaveBeenLastCalledWith("Typed");
    expect(combo.getAttribute("aria-labelledby")).toBeTruthy();
    expect(combo.closest('[data-rac][data-slot="text-field"]')).toBeNull();
    cleanup();
    render(<SearchField aria-label="Search"><InputGroup><InputGroupInput /></InputGroup></SearchField>);
    expect(screen.getByRole("searchbox")).toBeTruthy();
    cleanup();
    render(<TextField aria-label="Notes"><InputGroup><InputGroupTextarea /></InputGroup></TextField>);
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });
});
