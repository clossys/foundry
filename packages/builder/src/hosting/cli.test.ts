import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "./cli.js";
import type { HostingCliPort } from "./cli.js";
import { INSTALL_COMMAND_FILE } from "./should-build.js";

const declaration = JSON.stringify({
  schemaVersion: "1",
  surfaces: [{
    id: "web",
    inputs: ["apps/web"],
    privateScopes: [{
      scope: "@example",
      registry: "https://npm.example.test",
      credentialVariable: "EXAMPLE_REGISTRY_TOKEN",
    }],
    buildEnvironment: ["EMAIL_PROVIDER_KEY", "VERCEL_TOKEN"],
  }],
});

function cliPort(files: Record<string, string>, changed: readonly string[]): {
  port: HostingCliPort;
  out: string[];
  err: string[];
  requests: { env: Readonly<Record<string, string>> }[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const requests: { env: Readonly<Record<string, string>> }[] = [];
  const port: HostingCliPort = {
    repositoryRoot: "/repo",
    routeFileText: "",
    readTextFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    hasEnvironmentName: (name) => name === "EXAMPLE_REGISTRY_TOKEN" || name === "EMAIL_PROVIDER_KEY" || name === "VERCEL_TOKEN",
    readCredential: () => "marker",
    parentEnvironment: {
      PATH: "bin",
      EXAMPLE_REGISTRY_TOKEN: "marker",
      VERCEL_TOKEN: "marker",
      EMAIL_PROVIDER_KEY: "named",
    },
    presentEnvironmentNames: ["EXAMPLE_REGISTRY_TOKEN", "VERCEL_TOKEN", "EMAIL_PROVIDER_KEY"],
    writeUserConfig: () => ({ path: "/hosting-userconfig", restore() {} }),
    runFrozenInstall: (request) => {
      requests.push(request);
      return "ok";
    },
    writeOut: (text) => out.push(text),
    writeErr: (text) => err.push(text),
    listChangedPaths: () => changed,
    hasPreviousRevision: () => true,
  };
  return { port, out, err, requests };
}

describe("builder hosting CLI", () => {
  it("prints the install command when that file is the only change and exits 1", () => {
    const harness = cliPort({ "builder.hosting.json": declaration }, [INSTALL_COMMAND_FILE]);
    const code = main(["hosting", "should-build", "--surface", "web"], harness.port);
    expect(code).toBe(1);
    expect(harness.out.join("")).toBe(`changed: ${INSTALL_COMMAND_FILE}\n`);
  });

  it("exits 0 when no relevant input changed", () => {
    const harness = cliPort({ "builder.hosting.json": declaration }, ["README.md"]);
    expect(main(["hosting", "should-build", "--surface", "web"], harness.port)).toBe(0);
    expect(harness.out.join("")).toBe("");
  });

  it("prints build-environment names and omits the provider token and the credential", () => {
    const files = {
      "builder.hosting.json": declaration,
      ".npmrc": "@example:registry=https://npm.example.test\n",
    };
    const harness = cliPort(files, []);
    expect(main(["hosting", "install", "--surface", "web"], harness.port)).toBe(0);
    const stdout = harness.out.join("");
    expect(stdout).toContain("build-environment EMAIL_PROVIDER_KEY present");
    expect(stdout).not.toContain("VERCEL_TOKEN");
    expect(stdout).not.toContain("marker");
    expect(harness.err.join("")).not.toContain("marker");
    expect(harness.requests[0]?.env).not.toHaveProperty("EXAMPLE_REGISTRY_TOKEN");
    expect(harness.requests[0]?.env).not.toHaveProperty("VERCEL_TOKEN");
  });

  it("prints usage for --help and exits 0", () => {
    const harness = cliPort({}, []);
    expect(main(["--help"], harness.port)).toBe(0);
    expect(harness.out.join("")).toContain("builder hosting install --surface <id>");
    expect(harness.out.join("")).toContain("builder hosting should-build --surface <id>");
  });

  it("runs the compiled bin --help", () => {
    const bin = join(dirname(fileURLToPath(import.meta.url)), "../../dist/hosting/bin.js");
    const stdout = execFileSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
    expect(stdout).toContain("builder hosting install --surface <id>");
  });
});
