import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

type AgentPackages = Readonly<Record<string, readonly string[]>>;
type Manifest = { name: string; version: string; dependencies?: Record<string, string> };

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

const { scope } = readJson<{ scope: string }>(new URL("../../../package-scope.json", import.meta.url));
const packageName = (name: string) => `${scope}/${name}`;
const agentContract: AgentPackages = {
  director: [packageName("director"), packageName("strategist")],
  designer: [packageName("designer")],
  writer: [packageName("writer")],
  publisher: [packageName("publisher")],
};
const workspaceVersions = new Map<string, string>();
const packagesRoot = new URL("../../", import.meta.url);
for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestUrl = new URL(`${entry.name}/package.json`, packagesRoot);
  if (!existsSync(manifestUrl)) continue;
  const manifest = readJson<Manifest>(manifestUrl);
  workspaceVersions.set(manifest.name, manifest.version);
}
const lock = readJson<{ packages: Record<string, { version?: string }> }>(
  new URL("../../../package-lock.json", import.meta.url),
);
const esbuildVersion = lock.packages["node_modules/esbuild"]?.version;
if (!esbuildVersion) throw new Error("Root lockfile has no resolved esbuild version");

// This is the manifest gate itself: the same check grades the real package and
// the changed declarations below, so a green fixture alone cannot prove it works.
function pinFindings(
  dependencies: Readonly<Record<string, string>> | undefined,
  versions: ReadonlyMap<string, string>,
  agents: AgentPackages,
  expectedEsbuild: string,
): string[] {
  const findings: string[] = [];
  const selected = new Set<string>();
  for (const [agent, candidates] of Object.entries(agents)) {
    const name = candidates.find((candidate) => versions.has(candidate));
    if (!name) {
      findings.push(`${agent}: no workspace package`);
      continue;
    }
    selected.add(name);
    if (dependencies?.[name] !== versions.get(name)) findings.push(`${name}: exact workspace version required`);
  }
  for (const name of new Set(Object.values(agents).flat())) {
    if (dependencies?.[name] !== undefined && !selected.has(name)) findings.push(`${name}: unselected agent dependency`);
  }
  if (dependencies?.esbuild !== expectedEsbuild) findings.push("esbuild: exact root lockfile version required");
  return findings;
}

function exactDependencies(versions: ReadonlyMap<string, string> = workspaceVersions): Record<string, string> {
  const dependencies: Record<string, string> = { esbuild: esbuildVersion! };
  for (const candidates of Object.values(agentContract)) {
    const name = candidates.find((candidate) => versions.has(candidate));
    if (!name) throw new Error(`No fixture workspace package for ${candidates.join(", ")}`);
    dependencies[name] = versions.get(name)!;
  }
  return dependencies;
}

describe("Producer dependency pins", () => {
  it("pins the actual mapped agents to their workspace versions and esbuild to the root lock", async () => {
    // Read inside the test: the initial missing scaffold is an honest ENOENT
    // failure, while the independent negative controls can still execute.
    const manifest = readJson<Manifest>(new URL("../package.json", import.meta.url));
    const agentsPath = "./agents.js";
    const { AGENT_PACKAGES } = await import(agentsPath);
    expect(AGENT_PACKAGES).toEqual(agentContract);
    expect(pinFindings(manifest.dependencies, workspaceVersions, AGENT_PACKAGES, esbuildVersion!)).toEqual([]);
  });

  it("accepts the exact workspace declarations as its control", () => {
    expect(pinFindings(exactDependencies(), workspaceVersions, agentContract, esbuildVersion!)).toEqual([]);
  });

  for (const name of Object.keys(exactDependencies()).filter((name) => name !== "esbuild")) {
    for (const prefix of ["^", "~", "workspace:"]) {
      it(`rejects ${prefix} on ${name}`, () => {
        const dependencies = exactDependencies();
        dependencies[name] = `${prefix}${dependencies[name]}`;
        expect(pinFindings(dependencies, workspaceVersions, agentContract, esbuildVersion!)).toEqual([
          `${name}: exact workspace version required`,
        ]);
      });
    }

    it(`rejects a different exact version on ${name}`, () => {
      const dependencies = exactDependencies();
      dependencies[name] = "999.0.0";
      expect(pinFindings(dependencies, workspaceVersions, agentContract, esbuildVersion!)).toEqual([
        `${name}: exact workspace version required`,
      ]);
    });

    it(`rejects a missing ${name} dependency`, () => {
      const dependencies = exactDependencies();
      delete dependencies[name];
      expect(pinFindings(dependencies, workspaceVersions, agentContract, esbuildVersion!)).toEqual([
        `${name}: exact workspace version required`,
      ]);
    });
  }

  it.each(["^", "~", "workspace:"])("rejects an esbuild %s range", (prefix) => {
    expect(pinFindings({ ...exactDependencies(), esbuild: `${prefix}${esbuildVersion}` }, workspaceVersions, agentContract, esbuildVersion!))
      .toEqual(["esbuild: exact root lockfile version required"]);
  });

  it("rejects a dependency on an unavailable Director", () => {
    const versions = new Map(workspaceVersions);
    versions.delete(packageName("director"));
    const dependencies = { ...exactDependencies(versions), [packageName("director")]: "1.0.0" };
    expect(pinFindings(dependencies, versions, agentContract, esbuildVersion!)).toEqual([
      `${packageName("director")}: unselected agent dependency`,
    ]);
  });

  it("prefers the Director pin when both Director and Strategist exist", () => {
    const versions = new Map(workspaceVersions);
    versions.set(packageName("director"), "1.0.0");
    const dependencies = exactDependencies(versions);
    expect(dependencies[packageName("director")]).toBe("1.0.0");
    expect(dependencies[packageName("strategist")]).toBeUndefined();
    expect(pinFindings(dependencies, versions, agentContract, esbuildVersion!)).toEqual([]);
    dependencies[packageName("strategist")] = versions.get(packageName("strategist"))!;
    expect(pinFindings(dependencies, versions, agentContract, esbuildVersion!)).toEqual([
      `${packageName("strategist")}: unselected agent dependency`,
    ]);
  });
});
