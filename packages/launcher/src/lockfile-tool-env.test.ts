import { readFileSync, statSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LOCKFILE_TOOL_ENV_KEYS, lockfileToolEnv, prepareLockfileScratch, type LockfileScratch, type LockfileTool } from "./lockfile-tool-env.js";

/*
 * The model this file holds itself to is sanitizedEnv() in
 * scripts/lib/candidate-runner.mjs: a child environment built from a
 * literal, never by spreading a parent that may carry publish credentials,
 * a registry override, a proxy, or an injected NODE_OPTIONS. Every scenario
 * below runs a hostile parent through lockfileToolEnv() and checks that
 * none of it survives except the two fields the contract says are
 * forwarded on purpose: PATH and COREPACK_HOME.
 */
const HOSTILE_VALUES: Readonly<Record<string, string>> = {
  NPM_TOKEN: "secret-npm-token",
  NODE_AUTH_TOKEN: "secret-node-auth-token",
  GH_TOKEN: "secret-gh-token",
  GITHUB_TOKEN: "secret-github-token",
  npm_config__authToken: "secret-npmrc-authtoken",
  NPM_CONFIG_REGISTRY: "https://hostile-registry.example/",
  NODE_OPTIONS: "--require /x/sentinel.js",
  NODE_EXTRA_CA_CERTS: "/x/hostile-ca.pem",
  HTTPS_PROXY: "https://hostile-proxy.example",
  https_proxy: "https://hostile-proxy-lower.example",
  HTTP_PROXY: "http://hostile-proxy-plain.example",
  YARN_NPM_AUTH_TOKEN: "secret-yarn-auth-token",
  COREPACK_NPM_TOKEN: "secret-corepack-token",
  GH_PACKAGES_TOKEN: "secret-gh-packages-token",
  GITHUB_ACTIONS: "hostile-github-actions-marker",
  npm_config_registry: "https://hostile-lowercase-registry.example/",
  NPM_CONFIG_USERCONFIG: "/x/hostile-userconfig",
};
const FORWARDED_PATH = "/x/bin";
const FORWARDED_COREPACK_HOME = "/x/corepack";
const HOSTILE_PARENT: Readonly<Record<string, string>> = {
  PATH: FORWARDED_PATH,
  COREPACK_HOME: FORWARDED_COREPACK_HOME,
  ...HOSTILE_VALUES,
};

const SCRATCH = "/scratch/launcher-lockfile-test";
const REGISTRY = "https://registry.example/api";

const BASE_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "npm_config_userconfig",
  "npm_config_globalconfig",
  "npm_config_cache",
  "npm_config_ignore_scripts",
  "npm_config_audit",
  "npm_config_fund",
  "npm_config_update_notifier",
].sort();
const PNPM_KEYS = ["pnpm_config_update_notifier"];
const YARN_KEYS = ["YARN_ENABLE_SCRIPTS", "YARN_ENABLE_TELEMETRY", "YARN_ENABLE_GLOBAL_CACHE", "YARN_CACHE_FOLDER"].sort();
const COREPACK_KEYS_WITH_HOME = ["COREPACK_ENABLE_DOWNLOAD_PROMPT", "COREPACK_NPM_REGISTRY", "COREPACK_HOME"].sort();

const PATH_VALUED_KEYS = [
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "npm_config_userconfig",
  "npm_config_globalconfig",
  "npm_config_cache",
];

describe("lockfileToolEnv", () => {
  const scenarios: { tool: LockfileTool; corepack: boolean; expectedKeys: string[] }[] = [
    { tool: "npm", corepack: false, expectedKeys: [...BASE_KEYS].sort() },
    { tool: "pnpm", corepack: true, expectedKeys: [...BASE_KEYS, ...PNPM_KEYS, ...COREPACK_KEYS_WITH_HOME].sort() },
    { tool: "yarn", corepack: true, expectedKeys: [...BASE_KEYS, ...YARN_KEYS, ...COREPACK_KEYS_WITH_HOME].sort() },
  ];

  for (const { tool, corepack, expectedKeys } of scenarios) {
    describe(`${tool}, corepack=${corepack}`, () => {
      const env = lockfileToolEnv({ tool, scratch: SCRATCH, registry: REGISTRY, corepack, parent: HOSTILE_PARENT });

      it("produces exactly the expected allow-listed keys and nothing else", () => {
        expect(Object.keys(env).sort()).toEqual(expectedKeys);
        // every key it can ever produce is drawn from the exported allow-list
        for (const key of Object.keys(env)) expect(LOCKFILE_TOOL_ENV_KEYS).toContain(key);
      });

      it("forwards PATH and (when corepack) COREPACK_HOME, verbatim, from the parent", () => {
        expect(env.PATH).toBe(FORWARDED_PATH);
        if (corepack) expect(env.COREPACK_HOME).toBe(FORWARDED_COREPACK_HOME);
      });

      it("carries none of the hostile parent's other values into any produced value", () => {
        const values = Object.values(env);
        for (const [name, value] of Object.entries(HOSTILE_VALUES)) {
          for (const produced of values) expect(produced, `${name} leaked into "${produced}"`).not.toContain(value);
        }
      });

      it("keeps every path-valued key inside the scratch directory", () => {
        for (const key of PATH_VALUED_KEYS) expect(env[key]!.startsWith(`${SCRATCH}${sep}`), key).toBe(true);
        if (tool === "yarn") expect(env.YARN_CACHE_FOLDER!.startsWith(`${SCRATCH}${sep}`)).toBe(true);
      });

      it("points npm's user and global config at two distinct files, which npm 11 requires", () => {
        expect(env.npm_config_userconfig).not.toBe(env.npm_config_globalconfig);
      });
    });
  }

  it("never forwards COREPACK_HOME for npm, even though the parent has it, because corepack is false", () => {
    const env = lockfileToolEnv({ tool: "npm", scratch: SCRATCH, registry: REGISTRY, corepack: false, parent: HOSTILE_PARENT });
    expect(env.COREPACK_HOME).toBeUndefined();
  });

  it("falls back to /usr/bin:/bin when the parent has no PATH", () => {
    const env = lockfileToolEnv({ tool: "npm", scratch: SCRATCH, registry: REGISTRY, corepack: false, parent: {} });
    expect(env.PATH).toBe("/usr/bin:/bin");
  });

  it("falls back to /usr/bin:/bin when the parent's PATH is empty", () => {
    const env = lockfileToolEnv({ tool: "npm", scratch: SCRATCH, registry: REGISTRY, corepack: false, parent: { PATH: "" } });
    expect(env.PATH).toBe("/usr/bin:/bin");
  });

  it.each([
    [":/usr/bin", "/usr/bin"],
    [".:/usr/bin", "/usr/bin"],
    ["node_modules/.bin:/usr/bin", "/usr/bin"],
    ["/usr/bin:node_modules/.bin:/opt/bin", "/usr/bin:/opt/bin"],
    [".", "/usr/bin:/bin"],
    ["", "/usr/bin:/bin"],
  ])("keeps only absolute PATH entries, in order, for parent PATH %j", (parentPath, expected) => {
    const env = lockfileToolEnv({ tool: "npm", scratch: SCRATCH, registry: REGISTRY, corepack: false, parent: { PATH: parentPath } });
    expect(env.PATH).toBe(expected);
  });

  it("omits COREPACK_HOME when corepack is true but the parent has none", () => {
    const env = lockfileToolEnv({ tool: "pnpm", scratch: SCRATCH, registry: REGISTRY, corepack: true, parent: { PATH: "/usr/bin" } });
    expect("COREPACK_HOME" in env).toBe(false);
  });

  it("omits COREPACK_HOME when corepack is true but the parent's value is empty", () => {
    const env = lockfileToolEnv({ tool: "pnpm", scratch: SCRATCH, registry: REGISTRY, corepack: true, parent: { PATH: "/usr/bin", COREPACK_HOME: "" } });
    expect("COREPACK_HOME" in env).toBe(false);
  });

  it("carries the given registry into COREPACK_NPM_REGISTRY, verbatim", () => {
    const env = lockfileToolEnv({ tool: "pnpm", scratch: SCRATCH, registry: REGISTRY, corepack: true, parent: {} });
    expect(env.COREPACK_NPM_REGISTRY).toBe(REGISTRY);
  });
});

describe("prepareLockfileScratch", () => {
  let scratch: LockfileScratch | undefined;
  afterEach(async () => {
    await scratch?.remove();
    scratch = undefined;
  });

  it("returns a realpath, freshly created, outside the current working directory", async () => {
    scratch = await prepareLockfileScratch();
    const { realpathSync } = await import("node:fs");
    expect(scratch.path).toBe(realpathSync(scratch.path));
    expect(scratch.path.startsWith(`${process.cwd()}${sep}`)).toBe(false);
    expect(scratch.path).not.toBe(process.cwd());
  });

  it("creates every directory lockfileToolEnv's path-valued keys can point to", async () => {
    scratch = await prepareLockfileScratch();
    const env = lockfileToolEnv({ tool: "yarn", scratch: scratch.path, registry: REGISTRY, corepack: true, parent: {} });
    for (const key of [...PATH_VALUED_KEYS.filter((k) => k !== "npm_config_userconfig" && k !== "npm_config_globalconfig"), "YARN_CACHE_FOLDER"]) {
      expect(statSync(env[key]!).isDirectory(), key).toBe(true);
    }
  });

  it("creates the empty user and global config files, 0 bytes, before any tool runs", async () => {
    scratch = await prepareLockfileScratch();
    const env = lockfileToolEnv({ tool: "npm", scratch: scratch.path, registry: REGISTRY, corepack: false, parent: {} });
    for (const key of ["npm_config_userconfig", "npm_config_globalconfig"]) {
      const stat = statSync(env[key]!);
      expect(stat.isFile(), key).toBe(true);
      expect(stat.size, key).toBe(0);
      expect(readFileSync(env[key]!, "utf8"), key).toBe("");
    }
  });

  it("removes the directory, and remove() is safe to call twice", async () => {
    scratch = await prepareLockfileScratch();
    const { path, remove } = scratch;
    await remove();
    expect(() => statSync(path)).toThrow();
    await expect(remove()).resolves.toBeUndefined();
    scratch = undefined;
  });
});

describe("source guard: the parent environment is never spread", () => {
  const source = readFileSync(fileURLToPath(new URL("./lockfile-tool-env.ts", import.meta.url)), "utf8");

  it("contains no spread of process.env or the parent input", () => {
    expect(source).not.toMatch(/\.\.\.\s*process\.env/);
    expect(source).not.toMatch(/\.\.\.\s*input\.parent/);
    expect(source).not.toMatch(/\.\.\.\s*parent\b/);
  });

  it("never builds the child environment with Object.assign", () => {
    expect(source).not.toMatch(/Object\.assign\(/);
  });
});
