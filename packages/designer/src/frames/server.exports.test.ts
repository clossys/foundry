// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "../..");
const publisherWeb = resolve(packageRoot, "../publisher/src/web");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : /\.[cm]?tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

/** Read imported names (including aliases and re-exports), never local names or type-only declarations. */
function frameValues(source: string): string[] {
  const file = ts.createSourceFile("consumer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return file.statements.flatMap(statement => {
    if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@clossys/designer/frames") return [];
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) return [];
      // A new namespace/default import needs a corresponding parity assertion.
      if (clause.name || clause.namedBindings && !ts.isNamedImports(clause.namedBindings)) throw new Error("Frames parity requires named value imports");
      return clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements.filter(specifier => !specifier.isTypeOnly).map(specifier => (specifier.propertyName ?? specifier.name).text) : [];
    }
    if (statement.isTypeOnly) return [];
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) throw new Error("Frames parity requires named value re-exports");
    return statement.exportClause.elements.filter(specifier => !specifier.isTypeOnly).map(specifier => (specifier.propertyName ?? specifier.name).text);
  });
}

function probe(entry = "@clossys/designer/frames") {
  const script = `
    import { registerHooks } from "node:module";
    import * as react from "react";
    import ts from "typescript";
    const dist = new URL("../", import.meta.resolve("@clossys/designer/frames")).href;
    const evaluated = [], hooks = [];
    registerHooks({ load(url, context, next) {
      const result = next(url, context);
      if (!url.startsWith(dist) || !url.endsWith(".js")) return result;
      const module = url.slice(dist.length);
      evaluated.push(module);
      const source = ts.createSourceFile(module, String(result.source), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const names = new Map(), namespaces = new Set();
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "react") continue;
        const clause = statement.importClause;
        if (clause?.name) namespaces.add(clause.name.text);
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements)
          names.set(specifier.name.text, (specifier.propertyName ?? specifier.name).text);
      }
      function visit(node) {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const hook = ts.isIdentifier(callee) ? names.get(callee.text)
            : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) ? callee.name.text : undefined;
          if (hook && (hook === "use" || /^use[A-Z]/.test(hook))) hooks.push({ module, hook, supported: typeof react[hook] === "function" });
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      return result;
    }});
    let exports = [], error;
    try { exports = Object.keys(await import(${JSON.stringify(entry)})); } catch (caught) { error = caught.message; }
    console.log(JSON.stringify({ exports, evaluated, hooks, error }));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "--eval", script], {
    cwd: packageRoot, encoding: "utf8", timeout: 15_000,
  })) as { exports: string[]; evaluated: string[]; hooks: { module: string; hook: string; supported: boolean }[]; error?: string };
}

it("reads aliases and excludes type-only imports and re-exports in the parity scan", () => {
  expect(frameValues(`import type { AppFrameProps } from "@clossys/designer/frames";
    import { AppFrame as Frame, type SiteFrameProps } from "@clossys/designer/frames";
    export { surfaceRuntimeCallbacks as callbacks, type SiteFrameInput } from "@clossys/designer/frames";
    import { unrelated } from "other";`)).toEqual(["AppFrame", "surfaceRuntimeCallbacks"]);
});

it("exports every actual Publisher web Frames value under the react-server condition", () => {
  const imported = [...new Set(sources(publisherWeb).flatMap(path => frameValues(readFileSync(path, "utf8"))))].sort();
  expect(imported.length).toBeGreaterThan(0);
  const observed = probe();
  expect(observed.error).toBeUndefined();
  expect(imported.filter(name => !observed.exports.includes(name))).toEqual([]);
});

it("evaluates the real server graph without client hooks or the interactive runtime modules", () => {
  const observed = probe();
  expect(observed.error).toBeUndefined();
  expect(observed.evaluated).toContain("runtime/server-registry.js");
  // Supported RSC hooks (e.g. useId) already used by static primitives remain valid.
  expect(observed.hooks.filter(hook => !hook.supported)).toEqual([]);
  expect(observed.hooks.some(hook => hook.hook === "useId" && hook.supported)).toBe(true);
  expect(observed.evaluated).not.toEqual(expect.arrayContaining(["runtime/index.js"]));
  for (const client of ["runtime/SurfaceRuntime.client.js", "frames/AppFrame.js", "shell/FrameSlots.js", "frames/FrameStage.js", "components/Banner.copy-context.js", "frames/site-frame/SkipLink.client.js"])
    expect(observed.evaluated).not.toContain(client);
  expect(observed.evaluated.filter(path => path.startsWith("runtime/"))).toEqual(expect.not.arrayContaining(["runtime/frames/app-sidebar.js", "runtime/frames/command.js", "runtime/sections/group-b-parts.js"]));
});

it("detects the original hook-calling runtime graph as a negative control", () => {
  const observed = probe(new URL("../../dist/runtime/index.js", import.meta.url).href);
  expect(observed.error).toBeTruthy();
  expect(observed.hooks.some(hook => !hook.supported)).toBe(true);
});

it.each(["default", "react-server"])("resolves the %s skip island binding and preserves the server skip target", condition => {
  const script = `
    const target = import.meta.resolve("#designer-frame-skip-link");
    let anchor;
    if (${JSON.stringify(condition)} === "react-server") {
      const { SiteSkipLink } = await import("#designer-frame-skip-link");
      const node = SiteSkipLink({ targetId: "example-main", label: "Jump to content", followHeaderGround: true });
      const link = node.type(node.props);
      anchor = { componentLeaf: link.type.displayName, href: link.props.href, label: link.props.children, className: link.props.className };
    }
    console.log(JSON.stringify({ target, anchor }));
  `;
  const observed = JSON.parse(execFileSync(process.execPath, [
    ...(condition === "react-server" ? ["--conditions=react-server"] : []), "--input-type=module", "--eval", script,
  ], { cwd: packageRoot, encoding: "utf8", timeout: 10_000 }));
  expect(observed.target).toMatch(condition === "react-server" ? /SkipLink\.server\.js$/ : /SkipLink\.client\.js$/);
  if (condition === "react-server") {
    expect(observed.anchor).toMatchObject({ componentLeaf: "components.link", href: "#example-main", label: "Jump to content" });
    expect(observed.anchor.className).toContain("focus:not-sr-only");
  }
});

it("streams the real consumer-selected server skip anchor with its href, accessible name and focus styling", () => {
  const script = `
    import { createElement } from 'react';
    import { renderToPipeableStream } from 'react-dom/server';
    import { Writable } from 'node:stream';
    const { SiteSkipLink } = await import('./dist/frames/site-frame/SkipLink.server.js');
    const { ConsumerComponentProvider } = await import('./dist/runtime/component-leaf.client.js');
    const { fixtureConsumerComponents } = await import('./dist/catalog-core/__fixtures__/surface-consumer-components.js');
    const value = fixtureConsumerComponents();
    const node = createElement(ConsumerComponentProvider, {value}, createElement(SiteSkipLink,{targetId:'example-main',label:'Jump to content'}));
    const html = await new Promise((resolve,reject)=>{
      let output=''; const destination=new Writable({write(chunk,encoding,done){output+=chunk.toString();done()}});
      destination.on('finish',()=>resolve(output)); destination.on('error',reject);
      const stream=renderToPipeableStream(node,{onAllReady(){stream.pipe(destination)},onError:reject});
    });
    console.log(JSON.stringify({html}));
  `;
  const observed = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: packageRoot, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
  }));
  expect(observed.html).toMatch(/<a\b[^>]*href="#example-main"/);
  expect(observed.html).toContain("Jump to content</a>");
  expect(observed.html).toContain("sr-only focus:not-sr-only");
});
