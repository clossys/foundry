// consent-port-conformance.test.mjs -- proof P-31 for C-53 in
// docs/browser-consent-analytics.md (unit E).
//
// Publisher's consent assembly declares its lifecycle, storage and
// transport ports structurally and never imports Butler or Observer (O-3).
// Nothing inside any one package can therefore prove that the real
// implementations still fit those mirrors. This suite does: it type-checks
// scripts/fixtures/consent-port-conformance/ with no emit, under the
// fixture's own strict tsconfig (including exactOptionalPropertyTypes),
// against the BUILT declarations of
//
//   @clossys/butler/browser-consent
//   @clossys/butler/browser-consent/local-storage
//   @clossys/observer/browser-analytics
//   @clossys/observer/browser-analytics/posthog
//   @clossys/publisher/web/consent
//
// each resolved by package name through its export map, exactly as a host
// resolves it. A renamed or retyped snapshot field, a narrowed factory
// option or a missing export key fails here. AST checks reject fixture escape
// hatches, and built relative-import graphs keep adapters out of both roots.
//
// It needs `npm ci` (typescript) and `npm run build` (the declarations), so
// it is excluded from check:gates by name in scripts/lib/gate-test-set.mjs
// and run by `npm run check:consent-port-conformance` after the build, in
// the root `check` chain and in ci.yml's `build and test` job.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(repoRoot, "scripts", "fixtures", "consent-port-conformance");

// The built declaration each public specifier must resolve to.
const SPECIFIER_DECLARATIONS = {
  "@clossys/butler/browser-consent": "packages/butler/dist/browser-consent/index.d.ts",
  "@clossys/butler/browser-consent/local-storage": "packages/butler/dist/browser-consent/adapters/local-storage.d.ts",
  "@clossys/observer/browser-analytics": "packages/observer/dist/browser-analytics/index.d.ts",
  "@clossys/observer/browser-analytics/posthog": "packages/observer/dist/browser-analytics/providers/posthog.d.ts",
  "@clossys/publisher/web/consent": "packages/publisher/dist/web/consent/index.d.ts",
};

function loadProgram() {
  const configPath = join(fixtureDir, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(read.error, undefined, read.error && ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, fixtureDir, undefined, configPath);
  assert.deepEqual(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  return { parsed, program: ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options }) };
}

function format(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) return `TS${diagnostic.code}: ${message}`;
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const file = relative(repoRoot, diagnostic.file.fileName).split(sep).join("/");
  return `${file}:${line + 1}:${character + 1} TS${diagnostic.code}: ${message}`;
}

test("the fixture pins strict and exactOptionalPropertyTypes on and skipLibCheck off", () => {
  const { parsed } = loadProgram();
  assert.equal(parsed.options.strict, true, "fixture tsconfig must keep strict on");
  assert.equal(parsed.options.exactOptionalPropertyTypes, true, "fixture tsconfig must keep exactOptionalPropertyTypes on");
  assert.equal(parsed.options.skipLibCheck, false, "fixture tsconfig must check the declarations it imports");
  assert.ok(parsed.fileNames.length > 0, "fixture tsconfig includes no file");
});

function fixtureSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? fixtureSources(path) : /\.(?:[cm]?ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("the fixture uses no cast, no any and no compiler directive", () => {
  const offenders = [];
  for (const path of fixtureSources(fixtureDir)) {
    const name = relative(fixtureDir, path);
    if (/\.d\.[cm]?ts$/.test(name)) offenders.push(`${name} declaration file`);
    const text = readFileSync(path, "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      const report = (kind) => offenders.push(`${name}:${line + 1} ${kind}`);
      if (ts.isAsExpression(node) && !(ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(source) === "const")) report("cast");
      if (ts.isTypeAssertionExpression(node)) report("cast");
      if (ts.isNonNullExpression(node)) report("non-null assertion");
      if (node.kind === ts.SyntaxKind.AnyKeyword) report("any");
      if (ts.isModuleDeclaration(node)) report("module declaration");
      ts.forEachChild(node, visit);
    }
    visit(source);
    text.split("\n").forEach((line, index) => {
      if (/[@]ts[-](ignore|expect-error|nocheck)\b/.test(line)) offenders.push(`${name}:${index + 1} directive`);
    });
  }
  assert.deepEqual(offenders, []);
});

function assertAdapterFreeGraph(entry) {
  const visited = new Set();
  function visit(path) {
    if (visited.has(path)) return;
    visited.add(path);
    const name = relative(repoRoot, path).split(sep).join("/");
    assert.ok(!name.split("/").includes("adapters") && !name.endsWith("/providers/posthog.js"), `root module graph reaches adapter: ${name}`);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function imports(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) visit(resolve(dirname(path), specifier.text));
      ts.forEachChild(node, imports);
    }
    imports(source);
  }
  visit(entry);
}

test("O-5: neither root subpath's built module graph reaches an adapter module", () => {
  assertAdapterFreeGraph(join(repoRoot, "packages/butler/dist/browser-consent/index.js"));
  assertAdapterFreeGraph(join(repoRoot, "packages/observer/dist/browser-analytics/index.js"));
});

test("each public specifier resolves to its built declaration through the export map", () => {
  const { program } = loadProgram();
  const files = new Set(program.getSourceFiles().map((file) => relative(repoRoot, file.fileName).split(sep).join("/")));
  for (const [specifier, declaration] of Object.entries(SPECIFIER_DECLARATIONS)) {
    assert.ok(files.has(declaration), `${specifier} did not resolve to ${declaration} -- missing export key, or no build?`);
  }
});

test("C-53: the real implementations assign to Publisher's structural ports, and the reference host factory needs no cast", () => {
  const { program } = loadProgram();
  const diagnostics = ts.getPreEmitDiagnostics(program).map(format);
  assert.deepEqual(diagnostics, [], `consent port conformance failed:\n${diagnostics.join("\n")}`);
});

test("O-5: each root subpath exposes no adapter, and each adapter subpath exposes only its adapter", async () => {
  const consent = await import("@clossys/butler/browser-consent");
  const localStorage = await import("@clossys/butler/browser-consent/local-storage");
  const analytics = await import("@clossys/observer/browser-analytics");
  const posthog = await import("@clossys/observer/browser-analytics/posthog");

  assert.equal(typeof consent.createConsentLifecycle, "function");
  assert.equal("createLocalStorageConsentPort" in consent, false, "the browser-consent entry must not expose the storage adapter");
  assert.deepEqual(Object.keys(localStorage).sort(), ["createLocalStorageConsentPort"]);

  assert.equal(typeof analytics.createAnalyticsTransport, "function");
  assert.equal(typeof analytics.sanitizeAnalyticsEvent, "function");
  assert.equal("createPostHogProvider" in analytics, false, "the browser-analytics entry must not expose the provider adapter");
  assert.equal(typeof posthog.createPostHogProvider, "function");
  assert.deepEqual(Object.keys(posthog).sort(), ["ANALYTICS_ELEMENT_ATTRIBUTE", "AUTOCAPTURE_ELEMENT_SELECTOR", "BLOCK_SELECTOR_GRAMMAR", "MASKED_TEXT_PATTERN", "POSTHOG_AUTOCAPTURE_PROPERTIES", "POSTHOG_EVENT_FIELDS", "POSTHOG_INSTANCE_PREFIX", "POSTHOG_PROPERTY_ALLOWLIST", "POSTHOG_REPLAY_PROPERTIES", "PRIVATE_SUBTREE_SELECTORS", "REPLAY_RECORDING_OPTIONS", "REPLAY_RECORD_KINDS", "createPostHogProvider"]);
});
