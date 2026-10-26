// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { selectChromium } from "../__fixtures__/chromium-discovery.js";

const selectionHook = selectChromium;
const harnesses = ["blocks/LogoCloud.test.tsx", "blocks/PeopleGrid.test.tsx", "shell/SiteFooter.test.tsx"];
const root = resolve(import.meta.dirname, "..");
function harnessBody(file: string): ts.Block {
  const code = readFileSync(resolve(root, file), "utf8");
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body: ts.Block | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "runInChromium") body = node.body;
    if (file.startsWith("shell/") && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "beforeAll") {
      const callback = node.arguments[0];
      if (callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body)) body = callback.body;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!body) throw new Error(`Missing existing measured harness ${file}`);
  return body;
}
function discover(file: string, explicit: string | undefined, probe: (name: string, args: string[], options: unknown) => { status: number | null }) {
  // Evaluate only the real discovery seam, with an injected spawn probe. No
  // mocked result is evidence of browser rendering or measured geometry.
  const body = harnessBody(file);
  const statements = body.statements.slice(0, 2).map(statement => statement.getText()).join("\n");
  const code = ts.transpileModule(`function discover() { ${statements}; return browser; }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("spawnSync", "process", "selectChromium", `${code}; return discover();`)(probe, { env: { FOUNDRY_TEST_CHROME: explicit } }, selectionHook) as string;
}

describe("test-only Chromium executable discovery", () => {
  it.each(harnesses)("selects the exact explicit argv path with spaces in %s", file => {
    const explicit = "/test browser/Chrome executable", calls: unknown[] = [];
    const selected = discover(file, explicit, (name, args, options) => {
      calls.push([name, args, options]); return { status: name === explicit ? 0 : null };
    });
    expect(selected).toBe(explicit);
    expect(calls).toEqual([[explicit, ["--version"], { stdio: "ignore" }]]);
  });
  it.each(harnesses)("fails an invalid explicit executable without PATH fallback in %s", file => {
    const calls: string[] = [];
    expect(() => discover(file, "/missing explicit Chrome", name => { calls.push(name); return { status: name === "google-chrome" ? 0 : null }; })).toThrow(/FOUNDRY_TEST_CHROME.*executable/);
    expect(calls).toEqual(["/missing explicit Chrome"]);
  });
  it.each(harnesses)("keeps the four-name PATH search when no value is supplied in %s", file => {
    const calls: unknown[] = [];
    expect(discover(file, undefined, (name, args) => { calls.push([name, args]); return { status: name === "chromium-browser" ? 0 : null }; })).toBe("chromium-browser");
    expect(calls).toEqual(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].map(name => [name, ["--version"]]));
  });
  it.each(harnesses)("fails when every available browser probe fails in %s", file => {
    expect(() => discover(file, undefined, () => ({ status: null }))).toThrow(/require.*Chromium.*PATH/);
  });
  it.each(harnesses)("retains ephemeral profile and debug-port isolation in %s", file => {
    const code = readFileSync(resolve(root, file), "utf8");
    expect(code).toContain('"--remote-debugging-port=0"');
    expect(code).toContain("--user-data-dir=${");
    expect(code).toContain('join(directory, "profile")');
    expect(code).toContain("browser.kill()");
    expect(code).not.toContain("--remote-debugging-port=4503");
  });
  for (const failure of [false, true]) it.each(harnesses)(`cleans only its fresh temporary profile after ${failure ? "failure" : "success"} in %s`, file => {
    const parent = mkdtempSync(join(tmpdir(), "chromium-discovery-control-"));
    const sentinel = join(parent, "keep"); writeFileSync(sentinel, "untouched");
    const created: string[] = [], removed: string[] = [], invocations: string[][] = [];
    const body = harnessBody(file);
    let statements: readonly ts.Statement[];
    if (file.startsWith("shell/")) {
      const start = body.statements.findIndex(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "directory"));
      expect(start).toBeGreaterThanOrEqual(0); statements = [...body.statements.slice(0, 2), ...body.statements.slice(start)];
    } else statements = body.statements;
    const code = ts.transpileModule(`function runInChromium(html, steps) { let measurements; ${statements.map(statement => statement.getText()).join("\n")} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const execute = new Function("selectChromium", "spawnSync", "mkdtempSync", "join", "pathToFileURL", "tmpdir", "writeFileSync", "execFileSync", "process", "rmSync", "driveChromium", "INPUT_CAPABILITIES", "fixtures", "css", "safeFixtures", "measure", "readBrowserLayout", `${code}; return runInChromium("<p>local fixture</p>", []);`);
    const run = () => execute(selectionHook, () => ({ status: 0 }), (prefix: string) => { const directory = mkdtempSync(prefix); created.push(directory); return directory; }, join, pathToFileURL, () => parent, writeFileSync,
      (_node: string, args: string[]) => { invocations.push(args); if (failure) throw new Error("injected harness failure"); return "{}"; },
      { execPath: process.execPath, env: {} }, (path: string, options: { recursive: boolean; force: boolean }) => { removed.push(path); rmSync(path, options); },
      async function drive() {}, "test-input-capabilities", "<p>footer fixture</p>", "body{}", [{ width: 375, markup: "<p>safe fixture</p>" }], function measure() {}, async function layout() {});
    try {
      if (failure) expect(run).toThrow("injected harness failure"); else expect(run).not.toThrow();
      expect(created).toHaveLength(1); expect(removed).toEqual(created);
      expect(existsSync(created[0]!)).toBe(false); expect(existsSync(sentinel)).toBe(true);
      expect(invocations).toHaveLength(1); expect(invocations[0]![5]).toBe(join(created[0]!, "profile"));
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
});
