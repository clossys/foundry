import { describe, expect, it } from "vitest";
import {
  checkCredentialInventory,
  checkCredentialSurfaceDrift,
  checkLocalSecretFiles,
  checkProviderResourceNames,
  checkSecretName,
  checkSecretReadiness,
  checkValueFreeSecretCatalog,
  detectRawSecretReads,
} from "./secret-gates.js";

const catalog = {
  version: 1,
  entries: [
    { key: "REQUIRED_KEY", required: true },
    { key: "OPTIONAL_KEY", required: false },
  ],
};

const inventory = {
  version: 1,
  credentials: [
    {
      id: "example-service",
      secretKey: "EXAMPLE_SERVICE_KEY",
      provider: "example-provider",
      surfaces: ["worker", "web"],
    },
  ],
};

describe("secret naming and raw reads", () => {
  it("enforces a public uppercase naming grammar", () => {
    expect(checkSecretName("APP_SIGNING_KEY")).toEqual([]);
    expect(checkSecretName("app-signing-key").map((item) => item.rule)).toContain("secrets/name-format");
  });

  it("detects dot and bracket raw reads while honoring explicit exemptions", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "const first = process.env.APP_SIGNING_KEY;",
        "const second = process.env['DATABASE_URL'];",
        "const safe = process.env.NODE_ENV;",
        "const publicValue = process.env.NEXT_PUBLIC_EXAMPLE_KEY;",
        "const computed = process.env[name];",
        "const optional = process.env?.APP_TOKEN;",
        "const optionalComputed = process.env?.[name];",
        "const optionalProcess = process?.env?.APP_SECRET;",
        "const environment = process.env;",
        "const multiline = process.env",
        "  .MULTILINE_SECRET;",
      ].join("\n"),
    });
    expect(findings).toHaveLength(8);
    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:1",
      "src/config.ts:2",
      "src/config.ts:5",
      "src/config.ts:6",
      "src/config.ts:7",
      "src/config.ts:8",
      "src/config.ts:9",
      "src/config.ts:10",
    ]);
    expect(detectRawSecretReads({ filePath: "src/adapter.ts", body: "process.env.APP_SIGNING_KEY" }, { exempt: true })).toEqual([]);
    expect(
      detectRawSecretReads({ filePath: "README.md", body: "```ts\nprocess.env.APP_SIGNING_KEY;\n```" }),
    ).toEqual([]);
    expect(
      detectRawSecretReads({ filePath: "README.md", body: "~~~ts\nprocess.env.APP_SIGNING_KEY;\n~~~" }),
    ).toEqual([]);
    expect(
      detectRawSecretReads({ filePath: "README.md", body: "- `process.env.APP_SIGNING_KEY` must not be read." }),
    ).toEqual([]);
  });

  it("scans executable MDX regions while ignoring its prose and examples", () => {
    const findings = detectRawSecretReads({
      filePath: "guide.mdx",
      body: [
        "# Guide",
        "Mention `process.env.APP_SECRET` in prose.",
        "{process.env.APP_TOKEN}",
        "<Example value={process.env.APP_PASSWORD} />",
        "~~~tsx",
        "{process.env.DATABASE_URL}",
        "~~~",
        "export const value = process.env.EXTRA_TOKEN;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual([
      "guide.mdx:3",
      "guide.mdx:4",
      "guide.mdx:8",
    ]);
  });

  it("does not let an unmatched MDX backtick mask a later expression", () => {
    const findings = detectRawSecretReads({
      filePath: "guide.mdx",
      body: ["A literal ` remains prose.", "{process.env.APP_TOKEN}"].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual(["guide.mdx:2"]);
  });

  it("preserves JavaScript template literals inside MDX expressions", () => {
    const findings = detectRawSecretReads({
      filePath: "guide.mdx",
      body: '{`${process.env.APP_TOKEN}`}',
    });

    expect(findings.map((item) => item.path)).toEqual(["guide.mdx:1"]);
  });

  it("preserves regular-expression braces inside MDX expressions", () => {
    const findings = detectRawSecretReads({
      filePath: "guide.mdx",
      body: '{/}/.test("}") && process.env.APP_TOKEN}',
    });

    expect(findings.map((item) => item.path)).toEqual(["guide.mdx:1"]);
  });

  it("preserves regular-expression braces after binary operators in MDX expressions", () => {
    const findings = detectRawSecretReads({
      filePath: "guide.mdx",
      body: [
        "{(prefix + /}/.source) && process.env.APP_TOKEN}",
        "{value / divisor && process.env.APP_SECRET}",
      ].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual(["guide.mdx:1", "guide.mdx:2"]);
  });

  it("scans complete multiline MDX module statements", () => {
    const findings = detectRawSecretReads({
      filePath: "guide.mdx",
      body: [
        "import {",
        "  env as runtimeEnvironment,",
        '} from "node:process";',
        "export const signingKey =",
        "  runtimeEnvironment.APP_SIGNING_KEY;",
      ].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual(["guide.mdx:5"]);
  });

  it("excludes writes in unrelated function bodies from alias resolution", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let runtime = mockRuntime;",
        "runtime.env.APP_TOKEN;",
        "function later() { runtime = process; }",
      ].join("\n"),
    });
    expect(findings).toEqual([]);
  });

  it("detects standalone sensitive environment names", () => {
    expect(
      detectRawSecretReads({
        filePath: "src/config.ts",
        body: "process.env.PASSWORD; process.env.TOKEN; process.env.SECRET; process.env.MONKEY;",
      }).map((item) => item.message),
    ).toEqual([
      expect.stringContaining('"PASSWORD"'),
      expect.stringContaining('"TOKEN"'),
      expect.stringContaining('"SECRET"'),
    ]);
  });

  it("detects bracket access to the environment object", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        'process["env"].APP_TOKEN;',
        "process['env']['APP_SECRET'];",
        'process?.["env"]?.APP_PASSWORD;',
        'process["env"][name];',
        'const environment = process["env"];',
        'process["env"].NODE_ENV;',
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:1",
      "src/config.ts:2",
      "src/config.ts:3",
      "src/config.ts:4",
      "src/config.ts:5",
    ]);
  });

  it("fails closed for computed members of a known process object", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        'const slot = "env";',
        "process[slot].APP_TOKEN;",
        'process["e" + "nv"].APP_SECRET;',
        'process["versions"].node;',
      ].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:2", "src/config.ts:3"]);
  });

  it("detects globally qualified process environment reads", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "globalThis.process.env.APP_TOKEN;",
        "global.process.env.APP_SECRET;",
        'globalThis["process"]["env"].APP_PASSWORD;',
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:1",
      "src/config.ts:2",
      "src/config.ts:3",
    ]);
  });

  it("detects process environment reads through static module bindings", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        'import { env as importedEnv } from "node:process";',
        'import processModule from "process";',
        'const requiredProcess = require("node:process");',
        'const { env: requiredEnv } = require("process");',
        "importedEnv.APP_TOKEN;",
        "processModule.env.APP_SECRET;",
        "requiredProcess.env.APP_PASSWORD;",
        "requiredEnv.DATABASE_URL;",
        'require("node:process").env.EXTRA_TOKEN;',
        "const copiedEnvironment = importedEnv;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:5",
      "src/config.ts:6",
      "src/config.ts:7",
      "src/config.ts:8",
      "src/config.ts:9",
      "src/config.ts:10",
    ]);
  });

  it("detects reads through static process aliases", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "const firstRuntime = process;",
        "const secondRuntime = firstRuntime;",
        "firstRuntime.env.APP_TOKEN;",
        "secondRuntime.env.APP_SECRET;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:3", "src/config.ts:4"]);
  });

  it("detects process aliases created by simple assignment", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: ["let runtime;", "runtime = process;", "runtime.env.APP_TOKEN;"].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:3"]);
  });

  it("tracks process aliases through comma-expression results", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "const runtime = (instrument(), process);",
        "runtime.env.APP_TOKEN;",
        "const mockRuntime = (process, globalThis);",
        "mockRuntime.env.APP_SECRET;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:2"]);
  });

  it("invalidates and restores process aliases as their bindings change", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let runtime = process;",
        "runtime.env.APP_TOKEN;",
        "runtime = mockRuntime;",
        "runtime.env.APP_SECRET;",
        "runtime = process;",
        "runtime.env.APP_PASSWORD;",
        "const copiedRuntime = runtime;",
        "copiedRuntime.env.DATABASE_URL;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:2",
      "src/config.ts:6",
      "src/config.ts:8",
    ]);
  });

  it("retains possible process aliases across conditional writes", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let runtime = process;",
        "if (useMock) runtime = mockRuntime;",
        "runtime.env.APP_TOKEN;",
        "runtime = mockRuntime;",
        "runtime.env.APP_SECRET;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:3"]);
  });

  it("tracks logical-assignment process aliases conservatively", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let coalesced; coalesced ??= process; coalesced.env.APP_TOKEN;",
        "let fallback; fallback ||= process; fallback.env.APP_SECRET;",
        "let guarded; guarded &&= process; guarded.env.APP_PASSWORD;",
      ].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:1",
      "src/config.ts:2",
      "src/config.ts:3",
    ]);
  });

  it("follows every potentially selected process initializer branch", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "const selected = useReal ? process : mockRuntime;",
        "selected.env.APP_TOKEN;",
        "const guarded = useReal && process;",
        "guarded.env.APP_SECRET;",
        "const fallback = mockRuntime || process;",
        "fallback.env.APP_PASSWORD;",
        "const coalesced = mockRuntime ?? process;",
        "coalesced.env.DATABASE_URL;",
      ].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:2",
      "src/config.ts:4",
      "src/config.ts:6",
      "src/config.ts:8",
    ]);
  });

  it("tracks process aliases declared by parameter defaults", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "function read(runtime = process) { return runtime.env.APP_TOKEN; }",
        "const readSelected = (runtime = useReal ? process : mockRuntime) => runtime.env.APP_SECRET;",
        "function readMock(runtime = mockRuntime) { return runtime.env.APP_PASSWORD; }",
      ].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:1", "src/config.ts:2"]);
  });

  it("detects awaited dynamic process module imports", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        'const runtime = await import("node:process");',
        "runtime.env.APP_TOKEN;",
        'const { env: environment } = await import("process");',
        "environment.APP_SECRET;",
        'const unresolved = import("node:process");',
        "unresolved.env.APP_PASSWORD;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:2",
      "src/config.ts:4",
    ]);
  });

  it("detects default bindings destructured from awaited dynamic process imports", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        'const { default: runtime } = await import("node:process");',
        "runtime.env.APP_TOKEN;",
        'const { default: otherRuntime } = await import("node:fs");',
        "otherRuntime.env.APP_SECRET;",
        "let assignedRuntime;",
        '({ default: assignedRuntime } = await import("process"));',
        "assignedRuntime.env.APP_SECRET;",
        'const { default: deferredRuntime } = import("process");',
        "deferredRuntime.env.APP_PASSWORD;",
      ].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:2", "src/config.ts:7"]);
  });

  it("applies writes made by directly invoked hoisted helpers at the call site", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let runtime = mockRuntime;",
        "installRuntime();",
        "runtime.env.APP_TOKEN;",
        "function installRuntime() { runtime = process; }",
        "function unusedRuntimeHelper() { runtime = process; }",
      ].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:3"]);
  });

  it("honors directly invoked hoisted helpers that clear a process alias", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let runtime = process;",
        "clearRuntime();",
        "runtime.env.APP_TOKEN;",
        "function clearRuntime() { runtime = mockRuntime; }",
      ].join("\n"),
    });

    expect(findings).toEqual([]);
  });

  it("preserves write order for aliases changed by a hoisted helper", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let runtime = mockRuntime;",
        "installRuntime();",
        "runtime.env.APP_TOKEN;",
        "function installRuntime() { runtime = mockRuntime; runtime = process; }",
      ].join("\n"),
    });

    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:3"]);
  });

  it("resolves environment aliases at each use after reassignment", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let environment = process.env;",
        "environment.APP_TOKEN;",
        "environment = mockEnvironment;",
        "environment.APP_SECRET;",
        "({ env: environment } = process);",
        "environment.APP_PASSWORD;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:1",
      "src/config.ts:2",
      "src/config.ts:6",
    ]);
  });

  it("retains destructured environment aliases across conditional writes", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let environment;",
        "({ env: environment } = process);",
        "if (useMock) environment = mockEnvironment;",
        "environment.APP_TOKEN;",
        "environment = mockEnvironment;",
        "environment.APP_SECRET;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:4"]);
  });

  it("does not mistake shadowed process bindings for the Node global", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "function read(process: { env: Record<string, string> }) { return process.env.APP_TOKEN; }",
        "const runtime = process;",
        "function nested(runtime: { env: Record<string, string> }) { return runtime.env.APP_SECRET; }",
        "runtime.env.APP_PASSWORD;",
        "function qualified(globalThis: { process: { env: Record<string, string> } }) { return globalThis.process.env.APP_TOKEN; }",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:4"]);
  });

  it("detects nested process destructuring and case-folded sensitive reads", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "const { env: { APP_TOKEN } } = process;",
        "process.env.app_secret;",
        "process.env.node_env;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:1", "src/config.ts:2"]);
  });

  it("detects environment reads through destructuring assignments", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "let APP_TOKEN, APP_SECRET, environment;",
        "({ env: { APP_TOKEN } } = process);",
        "({ APP_SECRET } = process.env);",
        "({ env: environment } = process);",
        "environment.APP_PASSWORD;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual([
      "src/config.ts:2",
      "src/config.ts:3",
      "src/config.ts:5",
    ]);
  });

  it("ignores write-only accesses while retaining read-modify-write findings", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "process.env.APP_TOKEN = fixture;",
        "delete process.env.APP_SECRET;",
        "process.env.APP_PASSWORD += suffix;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:3"]);
  });

  it("treats comments as token trivia while ignoring commented-out reads", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "process /* block comment */ .env /* another comment */ .APP_TOKEN;",
        "process // line comment",
        "  .env[name];",
        "// process.env.APP_SECRET;",
        "/* process.env.APP_PASSWORD; */",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:1", "src/config.ts:2"]);
  });

  it("distinguishes executable reads from regex and literal text", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        String.raw`if (/https?:\/\//.test(url)) process.env.APP_TOKEN;`,
        'const message = "Do not use process.env.APP_SECRET here";',
        "const interpolated = `${process.env.APP_PASSWORD}`;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:1", "src/config.ts:3"]);
  });

  it("recognizes suppression directives only in comment trivia", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        'const note = "// secrets-allow:"; const token = process.env.APP_TOKEN;',
        "process.env.APP_SECRET; // secrets-allow: injected compatibility boundary",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:1"]);
  });

  it("retains aliases declared on suppressed lines for later analysis", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: [
        "const runtime = process; // secrets-allow: compatibility declaration",
        "runtime.env.APP_TOKEN;",
      ].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:2"]);
  });

  it("does not interpret Markdown fences inside source files", () => {
    const findings = detectRawSecretReads({
      filePath: "src/config.ts",
      body: ["/*", "```", "*/", "process.env.APP_TOKEN;"].join("\n"),
    });
    expect(findings.map((item) => item.path)).toEqual(["src/config.ts:4"]);
  });
});

describe("catalog and readiness", () => {
  it("rejects values, unknown fields, duplicates, and malformed keys", () => {
    const findings = checkValueFreeSecretCatalog({
      version: 1,
      entries: [
        { key: "bad-key", required: true, value: "example-value" },
        { key: "bad-key", required: false },
      ],
    });
    expect(findings.map((item) => item.rule)).toEqual(
      expect.arrayContaining(["secrets/catalog-value-free", "secrets/name-format", "secrets/catalog-duplicate"]),
    );
  });

  it("fails closed for an empty catalog", () => {
    expect(checkValueFreeSecretCatalog({ version: 1, entries: [] })).toEqual([
      expect.objectContaining({ rule: "secrets/catalog-empty", severity: "error" }),
    ]);
  });

  it("fails required readiness, warns for optional readiness, and rejects unregistered observations", () => {
    const findings = checkSecretReadiness(catalog, [
      { key: "REQUIRED_KEY", present: false },
      { key: "UNREGISTERED_KEY", present: true },
    ]);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "secrets/readiness-required", severity: "error" }),
        expect.objectContaining({ rule: "secrets/readiness-optional", severity: "warning" }),
        expect.objectContaining({ rule: "secrets/readiness-unregistered", severity: "error" }),
      ]),
    );
    expect(JSON.stringify(findings)).not.toContain("example-value");
  });

  it("rejects value-bearing readiness observations", () => {
    const findings = checkSecretReadiness(catalog, [
      { key: "REQUIRED_KEY", present: true, value: "example-value" },
    ]);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "secrets/readiness-value-free", severity: "error" }),
      ]),
    );
    expect(JSON.stringify(findings)).not.toContain("example-value");
  });
});

describe("credential inventory and drift", () => {
  it("keeps inventory value-free and validates identifiers and surfaces", () => {
    expect(checkCredentialInventory(inventory)).toEqual([]);
    expect(
      checkCredentialInventory({
        version: 1,
        credentials: [{ ...inventory.credentials[0], value: "example-value", surfaces: ["web", "web"] }],
      }).map((item) => item.rule),
    ).toEqual(expect.arrayContaining(["secrets/credential-inventory-value-free", "secrets/credential-surfaces"]));
    expect(checkCredentialInventory({ ...inventory, token: "example-value" })).toEqual([
      expect.objectContaining({ rule: "secrets/credential-inventory-value-free", path: "token" }),
    ]);
  });

  it("fails closed for an empty credential inventory", () => {
    expect(checkCredentialInventory({ version: 1, credentials: [] })).toEqual([
      expect.objectContaining({ rule: "secrets/credential-inventory-empty", severity: "error" }),
    ]);
  });

  it("reports both undeclared observations and declared-but-unobserved surfaces", () => {
    const findings = checkCredentialSurfaceDrift(inventory, [
      { credentialId: "example-service", surface: "web" },
      { credentialId: "example-service", surface: "job" },
    ]);
    expect(findings.map((item) => item.rule)).toEqual(
      expect.arrayContaining(["secrets/credential-surface-undeclared", "secrets/credential-surface-missing"]),
    );
    expect(
      checkCredentialSurfaceDrift(inventory, [
        { credentialId: "example-service", surface: "web", value: "example-value" },
      ]).map((item) => item.rule),
    ).toContain("secrets/credential-surface-observation-shape");
  });

  it("compares credential and surface names without delimiter collisions", () => {
    const findings = checkCredentialSurfaceDrift(
      {
        version: 1,
        credentials: [
          { id: "a", secretKey: "EXAMPLE_KEY", provider: "example-provider", surfaces: ["b\u0000c"] },
        ],
      },
      [{ credentialId: "a\u0000b", surface: "c" }],
    );
    expect(findings.map((item) => item.rule)).toEqual([
      "secrets/credential-surface-undeclared",
      "secrets/credential-surface-missing",
    ]);
  });
});

describe("local files and provider resource names", () => {
  it("blocks tracked and untracked secret env files while allowing value-free examples", () => {
    expect(
      checkLocalSecretFiles([
        { path: ".env", tracked: true },
        { path: ".envrc", tracked: true },
        { path: "apps/web/.env.local", tracked: false },
        { path: "apps/web/.ENV", tracked: true },
        { path: "apps/web/.Env.Local", tracked: false },
        { path: ".env.example", tracked: true },
        { path: ".ENV.EXAMPLE", tracked: true },
      ]).map((item) => item.rule),
    ).toEqual([
      "secrets/local-file-tracked",
      "secrets/local-file-tracked",
      "secrets/local-file-present",
      "secrets/local-file-tracked",
      "secrets/local-file-present",
    ]);
    expect(
      checkLocalSecretFiles([{ path: ".env", tracked: true, content: "example-value" }]).map((item) => item.rule),
    ).toEqual(["secrets/local-file-shape"]);
  });

  it("uses consumer-supplied provider/kind patterns and fails closed when no rule exists", () => {
    const findings = checkProviderResourceNames(
      [
        { provider: "example", kind: "project", name: "app-production" },
        { provider: "example", kind: "folder", name: "wrong" },
        { provider: "uncovered", kind: "project", name: "anything" },
      ],
      [
        { provider: "example", kind: "project", pattern: "[a-z]+-(?:development|production)" },
        { provider: "example", kind: "folder", pattern: "apps/[a-z]+" },
      ],
    );
    expect(findings.map((item) => item.rule)).toEqual([
      "secrets/provider-resource-name",
      "secrets/provider-resource-rule-missing",
    ]);
  });

  it("reports malformed provider rules and observations instead of throwing", () => {
    expect(
      checkProviderResourceNames(
        [null as unknown as { provider: string; kind: string; name: string }],
        [null as unknown as { provider: string; pattern: string }],
      ).map((item) => item.rule),
    ).toEqual(["secrets/provider-resource-rule-shape", "secrets/provider-resource-shape"]);
    expect(
      checkProviderResourceNames(
        [{ provider: "example", kind: "project", name: "app-production", value: "example-value" }],
        [{ provider: "example", kind: "project", pattern: "[a-z-]+", value: "example-value" }],
      ).map((item) => item.rule),
    ).toEqual(["secrets/provider-resource-rule-shape", "secrets/provider-resource-shape"]);
  });

  it("rejects duplicate provider and kind rule identities", () => {
    expect(
      checkProviderResourceNames(
        [{ provider: "example", kind: "project", name: "app-production" }],
        [
          { provider: "example", kind: "project", pattern: ".*" },
          { provider: "example", kind: "project", pattern: "app-production" },
        ],
      ).map((item) => item.rule),
    ).toEqual(["secrets/provider-resource-rule-duplicate"]);
  });
});
