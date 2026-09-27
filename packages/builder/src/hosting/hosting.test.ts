import { describe, expect, it } from "vitest";
import { defineHostingDeclaration } from "./declaration.js";
import type { HostingSurface } from "./declaration.js";
import { checkBuildEnvironmentNames, childEnvironment, installOmittedNames } from "./environment.js";
import {
  classifyFrozenInstallOutput,
  installErrorMessage,
  runHostingInstall,
} from "./install.js";
import type { FrozenInstallRequest, HostingInstallPorts, UserConfigHandle } from "./install.js";
import { INSTALL_COMMAND_FILE, decideShouldBuild } from "./should-build.js";

const MARKER = "present";
const SCOPE = "@example";
const REGISTRY = "https://npm.example.test";
const CREDENTIAL = "EXAMPLE_REGISTRY_TOKEN";

function surface(overrides: Partial<HostingSurface> = {}): HostingSurface {
  const declaration = defineHostingDeclaration({
    schemaVersion: "1",
    surfaces: [{
      id: "web",
      inputs: ["apps/web"],
      privateScopes: [{ scope: SCOPE, registry: REGISTRY, credentialVariable: CREDENTIAL }],
      buildEnvironment: ["EMAIL_PROVIDER_KEY", "VERCEL_TOKEN", "OTHER_KEY"],
      ...overrides,
    }],
  });
  const found = declaration.surfaces[0];
  if (found === undefined) throw new Error("surface missing");
  return found;
}

function ports(options: {
  route?: string;
  credentialPresent?: boolean;
  userConfigPath?: string;
  status?: "ok" | "auth-rejected" | "failed";
}): {
  ports: HostingInstallPorts;
  requests: FrozenInstallRequest[];
  bodies: string[];
  restores: number;
  reads: number;
} {
  const requests: FrozenInstallRequest[] = [];
  const bodies: string[] = [];
  let restores = 0;
  let reads = 0;
  const installed: HostingInstallPorts = {
    repositoryRoot: "/repo",
    routeFileText: options.route ?? `${SCOPE}:registry=${REGISTRY}\n`,
    hasEnvironmentName: (name) => name === CREDENTIAL ? options.credentialPresent !== false : name === "EMAIL_PROVIDER_KEY" || name === "VERCEL_TOKEN",
    readCredential: () => {
      reads += 1;
      return MARKER;
    },
    parentEnvironment: {
      PATH: "bin",
      [CREDENTIAL]: MARKER,
      VERCEL_TOKEN: MARKER,
      EMAIL_PROVIDER_KEY: "named",
    },
    presentEnvironmentNames: ["PATH", CREDENTIAL, "VERCEL_TOKEN", "EMAIL_PROVIDER_KEY"],
    writeUserConfig: (body) => {
      bodies.push(body);
      const handle: UserConfigHandle = {
        path: options.userConfigPath ?? "/hosting-userconfig",
        restore() {
          restores += 1;
        },
      };
      return handle;
    },
    runFrozenInstall: (request) => {
      requests.push(request);
      return options.status ?? "ok";
    },
  };
  return { ports: installed, requests, bodies, get restores() { return restores; }, get reads() { return reads; } };
}

describe("builder hosting install", () => {
  it("names the scope and says the credential was rejected, without echoing it", () => {
    const harness = ports({ status: "auth-rejected" });
    const result = runHostingInstall(surface(), harness.ports);
    expect(result).toEqual({
      ok: false,
      code: "credential-rejected",
      scope: SCOPE,
      message: installErrorMessage("credential-rejected", SCOPE),
    });
    expect(result.ok === false && result.message).toBe(`scope ${SCOPE}: credential rejected`);
    expect(JSON.stringify(result)).not.toContain(MARKER);
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]?.args).toEqual(["ci"]);
    expect(harness.requests[0]?.env).not.toHaveProperty(CREDENTIAL);
    expect(harness.requests[0]?.env).not.toHaveProperty("VERCEL_TOKEN");
    expect(Object.values(harness.requests[0]?.env ?? {})).not.toContain(MARKER);
    expect(harness.bodies[0]).toContain(REGISTRY);
    expect(harness.bodies[0]).toContain(MARKER);
    expect(harness.restores).toBe(1);
  });

  it("reports a missing credential as a different error and does not install", () => {
    const harness = ports({ credentialPresent: false });
    const result = runHostingInstall(surface(), harness.ports);
    expect(result).toMatchObject({
      ok: false,
      code: "credential-missing",
      scope: SCOPE,
      message: `scope ${SCOPE}: credential missing`,
    });
    expect(harness.requests).toHaveLength(0);
    expect(harness.reads).toBe(0);
    expect(harness.bodies).toHaveLength(0);
  });

  it("reports a mis-routed scope as a different error and does not install", () => {
    const harness = ports({ route: `${SCOPE}:registry=https://other.example.test\n` });
    const result = runHostingInstall(surface(), harness.ports);
    expect(result).toMatchObject({
      ok: false,
      code: "scope-misrouted",
      scope: SCOPE,
      message: `scope ${SCOPE}: mis-routed scope`,
    });
    expect(JSON.stringify(result)).not.toContain("other.example.test");
    expect(harness.requests).toHaveLength(0);
    expect(harness.reads).toBe(0);
  });

  it("uses three different messages for the three errors", () => {
    const messages = [
      installErrorMessage("credential-rejected", SCOPE),
      installErrorMessage("credential-missing", SCOPE),
      installErrorMessage("scope-misrouted", SCOPE),
    ];
    expect(new Set(messages).size).toBe(3);
  });

  it("runs a frozen install when the scope routes and the credential name is present", () => {
    const harness = ports({ status: "ok" });
    const result = runHostingInstall(surface(), harness.ports);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.buildEnvironment.placed).toEqual(["EMAIL_PROVIDER_KEY", "OTHER_KEY"]);
    expect(result.buildEnvironment.present).toEqual(["EMAIL_PROVIDER_KEY"]);
    expect(result.buildEnvironment.absent).toEqual(["OTHER_KEY"]);
    expect(result.buildEnvironment.placed).not.toContain("VERCEL_TOKEN");
    expect(harness.requests[0]?.env.npm_config_userconfig).toBe("/hosting-userconfig");
    expect(harness.restores).toBe(1);
  });

  it("does not install when the user config path is inside the repository", () => {
    const harness = ports({ userConfigPath: "/repo/npmrc" });
    const result = runHostingInstall(surface(), harness.ports);
    expect(result).toMatchObject({ ok: false, code: "user-config-inside-repository" });
    expect(JSON.stringify(result)).not.toContain(MARKER);
    expect(harness.requests).toHaveLength(0);
    expect(harness.restores).toBe(1);
  });

  it("classifies an auth failure without forwarding the installer text", () => {
    expect(classifyFrozenInstallOutput(1, "npm ERR! code E401\nnpm ERR! 401 Unauthorized\n")).toBe("auth-rejected");
    expect(classifyFrozenInstallOutput(0, "")).toBe("ok");
    expect(classifyFrozenInstallOutput(1, "npm ERR! missing lockfile")).toBe("failed");
  });
});

describe("build environment names", () => {
  it("reports presence by name and leaves a provider token out of the build environment", () => {
    const report = checkBuildEnvironmentNames(
      ["EMAIL_PROVIDER_KEY", "VERCEL_TOKEN", "OTHER_KEY"],
      ["EMAIL_PROVIDER_KEY", "VERCEL_TOKEN"],
    );
    expect(report).toEqual({
      placed: ["EMAIL_PROVIDER_KEY", "OTHER_KEY"],
      present: ["EMAIL_PROVIDER_KEY"],
      absent: ["OTHER_KEY"],
    });
  });

  it("does not copy a credential or provider token value into the child environment", () => {
    const child = childEnvironment(
      { PATH: "bin", [CREDENTIAL]: MARKER, VERCEL_TOKEN: MARKER, EMAIL_PROVIDER_KEY: "named" },
      installOmittedNames([CREDENTIAL]),
    );
    expect(child).toEqual({ PATH: "bin", EMAIL_PROVIDER_KEY: "named" });
    expect(Object.values(child)).not.toContain(MARKER);
  });
});

describe("builder hosting should-build", () => {
  it("builds when the only change is the install command and prints that input", () => {
    const decision = decideShouldBuild(surface(), [INSTALL_COMMAND_FILE], true);
    expect(decision).toEqual({ build: true, changedInputs: [INSTALL_COMMAND_FILE] });
  });

  it("builds when a git-root path ends with the install command reference", () => {
    const decision = decideShouldBuild(surface(), ["packages/builder/src/hosting/install.ts"], true);
    expect(decision).toEqual({ build: true, changedInputs: [INSTALL_COMMAND_FILE] });
  });

  it("builds when a git-root path ends with the environment or declaration modules", () => {
    expect(decideShouldBuild(surface(), ["packages/builder/src/hosting/environment.ts"], true)).toEqual({
      build: true,
      changedInputs: ["src/hosting/environment.ts"],
    });
    expect(decideShouldBuild(surface(), ["packages/builder/src/hosting/declaration.ts"], true)).toEqual({
      build: true,
      changedInputs: ["src/hosting/declaration.ts"],
    });
  });

  it("does not treat a path without a reference boundary as a hosting command change", () => {
    expect(decideShouldBuild(surface(), ["notsrc/hosting/install.ts"], true)).toEqual({
      build: false,
      changedInputs: [],
    });
  });

  it("builds when a declared input is already a git-root path equal to the change", () => {
    const declared = surface({ inputs: ["packages/builder/src/hosting/install.ts"] });
    expect(decideShouldBuild(declared, ["packages/builder/src/hosting/install.ts"], true)).toEqual({
      build: true,
      changedInputs: ["packages/builder/src/hosting/install.ts"],
    });
  });

  it("does not build when the changed path is outside the declared inputs and hosting command files", () => {
    expect(decideShouldBuild(surface(), ["README.md"], true)).toEqual({ build: false, changedInputs: [] });
  });

  it("prints a declared input when a file under it changed", () => {
    expect(decideShouldBuild(surface(), ["apps/web/page.tsx"], true).changedInputs).toEqual(["apps/web"]);
  });
});
