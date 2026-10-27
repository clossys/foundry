// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { importShadcnAriaComponents, type ShadcnComponentInput } from "./shadcn-aria-components.js";

const here = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const read = (name: string): string => readFileSync(resolve(here, name), "utf8");
const pinned = (): ShadcnComponentInput => ({
  items: readdirSync(here).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
  styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") },
});
// Consumer-emitted sibling leaves, reduced to their public types. The Button leaf is a member-dispatch
// facade, so its exported type is exactly what the emitter's `forwardRef<unknown, Record<string, unknown>>` produces.
const leaves: Readonly<Record<string, string>> = {
  "components/button/index.ts": 'import { forwardRef } from "react";\nexport declare const Button: ReturnType<typeof forwardRef<unknown, Record<string, unknown>>>;\n',
  "components/icon/index.ts": 'export declare function Icon(props: { asset: string; className?: string; "data-slot"?: string }): null;\n',
};

/** Typecheck the materialized selected fill closure with the real React Aria and class-name types. */
function diagnostics(items: readonly string[]): string[] {
  const result = importShadcnAriaComponents(pinned());
  const root = resolve(import.meta.dirname, "__selected_fill_types__");
  const files = items.flatMap(item => result.rewrites[item]!.files).filter(file => /\.tsx?$/.test(file.path));
  const virtual = new Map([...files.map(file => [file.path, file.content] as const), ...Object.entries(leaves)].map(([path, content]) => [resolve(root, path), content]));
  const options: ts.CompilerOptions = { noEmit: true, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"] };
  const host = ts.createCompilerHost(options);
  const originalFile = host.fileExists.bind(host), originalRead = host.readFile.bind(host), originalSource = host.getSourceFile.bind(host), originalDirectory = host.directoryExists!.bind(host);
  host.fileExists = path => virtual.has(path) || originalFile(path);
  host.readFile = path => virtual.get(path) ?? originalRead(path);
  host.directoryExists = path => path.startsWith(root) || originalDirectory(path);
  host.getSourceFile = (path, version, onError, create) => virtual.has(path) ? ts.createSourceFile(path, virtual.get(path)!, version) : originalSource(path, version, onError, create);
  const program = ts.createProgram([...virtual.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).map(item => `${item.file ? item.file.fileName.slice(root.length + 1) : ""}: ${ts.flattenDiagnosticMessageText(item.messageText, "\n").split("\n")[0]}`);
}

describe("selected shadcn fills typecheck against their rebound sibling leaves", () => {
  it("passes only class strings to cn when a fill derives props from the open Button facade", () => {
    expect(diagnostics(["dialog", "combobox"])).toEqual([]);
  });
  it("composes the Menu render-prop className with React Aria's composeRenderProps", () => {
    expect(diagnostics(["dropdown-menu"])).toEqual([]);
  });
});
