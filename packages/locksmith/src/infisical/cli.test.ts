import { execFile as execFileCallback } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "infisical", "cli.js");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

async function runCli(args: string[], environment: NodeJS.ProcessEnv = process.env) {
  try {
    const { stdout, stderr } = await execFile(process.execPath, [cliPath, ...args], { env: environment });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof result.code === "number" ? result.code : -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
}

describe("vespene-secrets-infisical CLI", () => {
  it("prints help when invoked through the built bin entry", async () => {
    const result = await runCli(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: vespene-secrets-infisical");
  });

  it("prints only value-free catalog metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "secrets-infisical-cli-"));
    roots.push(root);
    const path = join(root, "catalog.json");
    writeFileSync(path, JSON.stringify({ version: 1, entries: [{ key: "EXAMPLE_KEY", required: true }] }));

    const result = await runCli(["catalog", "--catalog", path]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ version: 1, entries: [{ key: "EXAMPLE_KEY", required: true }] });
  });

  it("rejects a value-bearing catalog without echoing the attempted value", async () => {
    const root = mkdtempSync(join(tmpdir(), "secrets-infisical-cli-"));
    roots.push(root);
    const path = join(root, "catalog.json");
    writeFileSync(
      path,
      JSON.stringify({ version: 1, entries: [{ key: "EXAMPLE_KEY", required: true, value: "example-value" }] }),
    );

    const result = await runCli(["catalog", "--catalog", path]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("value-free");
    expect(result.stderr).not.toContain("example-value");
  });

  it("qualifies a complete required-name snapshot offline without reading credentials or the network", async () => {
    const root = mkdtempSync(join(tmpdir(), "secrets-infisical-cli-"));
    roots.push(root);
    const catalog = join(root, "catalog.json");
    const available = join(root, "available.json");
    const credentialGuard = join(root, "credential-guard.cjs");
    writeFileSync(catalog, JSON.stringify({ version: 1, entries: [{ key: "REQUIRED_KEY", required: true }] }));
    writeFileSync(available, JSON.stringify({ version: 1, names: ["REQUIRED_KEY"] }));
    writeFileSync(
      credentialGuard,
      [
        "const protectedNames = new Set(['INFISICAL_TOKEN', 'INFISICAL_MACHINE_IDENTITY_ID', 'INFISICAL_JWT']);",
        "const environment = process.env;",
        "process.env = new Proxy(environment, {",
        "  get(target, property) {",
        "    if (typeof property === 'string' && protectedNames.has(property)) throw new Error('credential environment must not be read');",
        "    return target[property];",
        "  },",
        "});",
      ].join("\n"),
    );

    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(500);
      response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind a TCP port");

    try {
      const decoy = "credential-value-that-must-not-be-read-or-printed";
      const result = await runCli(["qualify", "--catalog", catalog, "--available", available], {
        INFISICAL_API_URL: `http://127.0.0.1:${address.port}`,
        INFISICAL_TOKEN: decoy,
        INFISICAL_MACHINE_IDENTITY_ID: decoy,
        INFISICAL_JWT: decoy,
        NODE_OPTIONS: `--require=${credentialGuard}`,
      });
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, missingRequired: [] });
      expect(result.stdout).not.toContain(decoy);
      expect(result.stderr).not.toContain(decoy);
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("reports missing required names with exit 1 and never reports snapshot values", async () => {
    const root = mkdtempSync(join(tmpdir(), "secrets-infisical-cli-"));
    roots.push(root);
    const catalog = join(root, "catalog.json");
    const available = join(root, "available.json");
    writeFileSync(
      catalog,
      JSON.stringify({
        version: 1,
        entries: [
          { key: "REQUIRED_KEY", required: true },
          { key: "OPTIONAL_KEY", required: false },
        ],
      }),
    );
    writeFileSync(available, JSON.stringify({ version: 1, names: ["OPTIONAL_KEY"] }));

    const result = await runCli(["qualify", "--catalog", catalog, "--available", available]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, missingRequired: ["REQUIRED_KEY"] });
    expect(result.stdout).not.toContain("OPTIONAL_KEY");
  });

  it("requires an available-name snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "secrets-infisical-cli-"));
    roots.push(root);
    const catalog = join(root, "catalog.json");
    writeFileSync(catalog, JSON.stringify({ version: 1, entries: [{ key: "REQUIRED_KEY", required: true }] }));

    const result = await runCli(["qualify", "--catalog", catalog]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--available is required");
  });

  it("rejects malformed available snapshots without echoing their contents", async () => {
    const root = mkdtempSync(join(tmpdir(), "secrets-infisical-cli-"));
    roots.push(root);
    const catalog = join(root, "catalog.json");
    const available = join(root, "available.json");
    const decoy = "snapshot-value-that-must-not-be-printed";
    writeFileSync(catalog, JSON.stringify({ version: 1, entries: [{ key: "REQUIRED_KEY", required: true }] }));

    const cases: readonly [string, unknown][] = [
      ["duplicate names", { version: 1, names: ["REQUIRED_KEY", "REQUIRED_KEY"] }],
      ["an empty name", { version: 1, names: [""] }],
      ["a non-string name", { version: 1, names: ["REQUIRED_KEY", 1] }],
      ["an unexpected key", { version: 1, names: ["REQUIRED_KEY"], unexpected: decoy }],
      ["a value-bearing key", { version: 1, names: ["REQUIRED_KEY"], value: decoy }],
    ];
    for (const [label, snapshot] of cases) {
      writeFileSync(available, JSON.stringify(snapshot));
      const result = await runCli(["qualify", "--catalog", catalog, "--available", available]);
      expect(result.code, label).toBe(2);
      expect(result.stdout, label).toBe("");
      expect(result.stderr, label).toContain("secret-name snapshot");
      expect(result.stderr, label).not.toContain(decoy);
    }
  });

  it("delegates catalog validation to the existing strict value-free parser", async () => {
    const root = mkdtempSync(join(tmpdir(), "secrets-infisical-cli-"));
    roots.push(root);
    const catalog = join(root, "catalog.json");
    const available = join(root, "available.json");
    const decoy = "catalog-value-that-must-not-be-printed";
    writeFileSync(
      catalog,
      JSON.stringify({ version: 1, entries: [{ key: "REQUIRED_KEY", required: true, value: decoy }] }),
    );
    writeFileSync(available, JSON.stringify({ version: 1, names: ["REQUIRED_KEY"] }));

    const result = await runCli(["qualify", "--catalog", catalog, "--available", available]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Secret catalog must be value-free version 1 metadata with unique keys.");
    expect(result.stderr).not.toContain(decoy);
  });

  it("runs offline qualification from the packed artifact", async () => {
    const root = mkdtempSync(join(tmpdir(), "secrets-infisical-cli-"));
    roots.push(root);
    const catalog = join(root, "catalog.json");
    const available = join(root, "available.json");
    writeFileSync(catalog, JSON.stringify({ version: 1, entries: [{ key: "REQUIRED_KEY", required: true }] }));
    writeFileSync(available, JSON.stringify({ version: 1, names: ["REQUIRED_KEY"] }));

    const packedDestination = join(root, "packed");
    mkdirSync(packedDestination);
    const { stdout } = await execFile("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packedDestination], {
      cwd: packageRoot,
    });
    const packed = JSON.parse(stdout) as Array<{ filename?: unknown }>;
    const filename = packed[0]?.filename;
    if (typeof filename !== "string") throw new Error("npm pack did not report an artifact filename");
    const consumer = join(root, "consumer");
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
    await execFile("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", join(packedDestination, filename)], {
      cwd: consumer,
    });

    const installedBin = join(consumer, "node_modules", ".bin", "vespene-secrets-infisical");
    const { stdout: output } = await execFile(installedBin, [
      "qualify",
      "--catalog",
      catalog,
      "--available",
      available,
    ], { cwd: consumer });
    expect(JSON.parse(output)).toEqual({ ok: true, missingRequired: [] });
  });

  it("rejects unknown command options instead of silently using other configuration", async () => {
    const result = await runCli(["list", "--environmnt", "production"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown option --environmnt");
  });

  it("rejects repeated options and redacts invalid authentication values", async () => {
    const repeated = await runCli(["list", "--auth", "token", "--auth", "oidc"]);
    expect(repeated.code).toBe(2);
    expect(repeated.stderr).toContain("must not be repeated");

    const invalid = await runCli([
      "list",
      "--base-url",
      "https://secrets.example.test",
      "--project-id",
      "project-example",
      "--environment",
      "test",
      "--auth",
      "attempted-sensitive-value",
    ]);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).not.toContain("attempted-sensitive-value");
  });

  it("normalizes every nonzero child exit to the child-failure code", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ imports: [], secrets: [] }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind a TCP port");

    try {
      const result = await runCli(
        [
          "run",
          "--base-url",
          `http://127.0.0.1:${address.port}`,
          "--project-id",
          "project-example",
          "--environment",
          "test",
          "--",
          process.execPath,
          "-e",
          "process.exit(2)",
        ],
        { INFISICAL_TOKEN: "access-example" },
      );
      expect(result.code).toBe(1);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
