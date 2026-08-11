import { execFile as execFileCallback } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "infisical", "cli.js");
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

  it("uses a names-only listing for presence checks", async () => {
    const server = createServer((request, response) => {
      expect(request.url).toContain("viewSecretValue=false");
      expect(request.url).toContain("expandSecretReferences=false");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ imports: [], secrets: [{ secretKey: "EXAMPLE_KEY" }] }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind a TCP port");

    try {
      const result = await runCli(
        [
          "get",
          "EXAMPLE_KEY",
          "--base-url",
          `http://127.0.0.1:${address.port}`,
          "--project-id",
          "project-example",
          "--environment",
          "test",
        ],
        { INFISICAL_TOKEN: "access-example" },
      );
      expect(result).toMatchObject({ code: 0 });
      expect(JSON.parse(result.stdout)).toEqual({ key: "EXAMPLE_KEY", present: true });
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
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
