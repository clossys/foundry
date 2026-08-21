import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RENDER_ENVIRONMENT } from "./render-environment.js";

/**
 * Real subprocess integration tests, the same shape
 * `controller/src/release/pack-round-trip.test.ts` uses for its own
 * "does the real compiled output resolve" assertions: no mocking of
 * Node's module resolution, because that would defeat the entire point —
 * issue #375 asks for the REAL compiled module, resolved under the REAL
 * `react-server` condition, not a simulation of one. This needs
 * `npm run build` to have already produced `dist/` (gitignored, same as
 * `check:contrast` and `check:package-governance` in the repo root's own
 * `package.json` — see those scripts' own comments); the root `npm run
 * check` pipeline always builds before it tests, and `beforeAll` below
 * fails loudly, not silently, if `dist/` is missing.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");

if (!existsSync(distDir)) {
  throw new Error(
    `render-environment.test.ts requires a built dist/ (run "npm run build" in ${packageRoot} first) — ` +
      "this suite spawns node against the REAL compiled output, per issue #375's own requirement that " +
      "server-safety be proven against reality, not simulated.",
  );
}

type ProbeResult = { ok: true } | { ok: false; message: string };

/** Spawns a real `node --conditions=react-server` subprocess importing `distRelPath`, and reports what actually happened — never "did not throw" alone. */
function probeUnderReactServer(distRelPath: string): ProbeResult {
  const absolute = join(distDir, distRelPath);
  const script = `import(${JSON.stringify(absolute)}).then(() => { process.stdout.write("OK"); process.exit(0); }).catch((e) => { process.stdout.write("ERR:" + e.message); process.exit(1); });`;
  try {
    const stdout = execFileSync(process.execPath, ["--conditions=react-server", "-e", script], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return stdout.trim() === "OK" ? { ok: true } : { ok: false, message: `unexpected stdout: ${stdout}` };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? "";
    return { ok: false, message: stdout.startsWith("ERR:") ? stdout.slice(4) : String(error) };
  }
}

/** Spawns a plain `node` subprocess (no condition override) importing `distRelPath` and returns its exported keys, proving normal resolution still works. */
function importKeysNormally(distRelPath: string): string[] {
  const absolute = join(distDir, distRelPath);
  const script = `import(${JSON.stringify(absolute)}).then((m) => { process.stdout.write(JSON.stringify(Object.keys(m))); process.exit(0); }).catch((e) => { process.stdout.write("ERR:" + e.message); process.exit(1); });`;
  const stdout = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 10_000 });
  if (stdout.startsWith("ERR:")) throw new Error(`normal import of ${distRelPath} failed: ${stdout.slice(4)}`);
  return JSON.parse(stdout) as string[];
}

describe("server-safe entry points resolve under react-server (test 1)", () => {
  const serverEntries: Array<{ distRelPath: string; expectedExports: string[] }> = [
    { distRelPath: "atoms/server.js", expectedExports: ["Badge", "Banner", "Card", "Field", "Icon", "Skeleton", "Spinner", "mergeUiClasses"] },
    {
      distRelPath: "blocks/server.js",
      expectedExports: [
        "ArticleBody",
        "DetailView",
        "EmptyState",
        "FeatureGrid",
        "FieldGroup",
        "Hero",
        "PageHeader",
        "PricingTable",
        "SectionHeader",
        "Stat",
      ],
    },
    { distRelPath: "shell/server.js", expectedExports: ["Shell", "SiteFooter", "SiteHeader", "SkipLink"] },
    { distRelPath: "charts/server.js", expectedExports: ["ChartFrame", "Sparkline"] },
    { distRelPath: "theme/server.js", expectedExports: ["getThemeInitScript"] },
  ];

  for (const { distRelPath, expectedExports } of serverEntries) {
    it(`${distRelPath} imports cleanly under --conditions=react-server`, () => {
      const result = probeUnderReactServer(distRelPath);
      expect(result.ok, result.ok ? undefined : result.message).toBe(true);
    });

    it(`${distRelPath} exports exactly its verified-safe members under normal resolution`, () => {
      const keys = importKeysNormally(distRelPath).sort();
      expect(keys).toEqual([...expectedExports].sort());
    });
  }
});

describe("negative control: the original barrels still fail under react-server (test 2)", () => {
  const originalBarrels = ["atoms/index.js", "blocks/index.js", "shell/index.js", "charts/index.js", "theme/index.js"];

  for (const distRelPath of originalBarrels) {
    it(`${distRelPath} still fails under --conditions=react-server (proves the server entry is doing real work)`, () => {
      const result = probeUnderReactServer(distRelPath);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Real cause every time: a client-only React API read at module
        // scope by a dependency (react-aria-components, or this
        // package's own theme/charts client code) — never "module not
        // found", which would just mean a bad path, not an unsafe one.
        expect(result.message).toMatch(/react|useContext|useState|createContext/i);
      }
    });
  }
});

describe("no regression: every existing subpath still resolves normally (test 3)", () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    exports: Record<string, { import?: string } | string>;
  };

  const jsSubpaths = Object.entries(manifest.exports).filter(
    (entry): entry is [string, { import: string }] => typeof entry[1] === "object" && typeof entry[1].import === "string",
  );

  for (const [subpath, entry] of jsSubpaths) {
    it(`${subpath} still imports without throwing (no regression)`, () => {
      const distRelPath = entry.import.replace(/^\.\/dist\//, "");
      expect(() => importKeysNormally(distRelPath)).not.toThrow();
    });
  }

  // One `it` per barrel, not one `it` spanning all five. `importKeysNormally`
  // spawns a subprocess per call, so the single combined spot check paid five
  // module-graph imports against one 5s timeout: ~1s on an idle machine but
  // over 6s under load, which made it fail on machine load rather than on
  // a missing export (issue #434). Split, each case sits with its siblings at
  // roughly 200ms, and a failure names the barrel that actually regressed.
  const barrelSpotChecks: Array<[string, string]> = [
    ["atoms/index.js", "Button"],
    ["blocks/index.js", "DataTable"],
    ["shell/index.js", "NavShell"],
    ["charts/index.js", "BarChart"],
    ["theme/index.js", "ThemeProvider"],
  ];

  for (const [distRelPath, expectedExport] of barrelSpotChecks) {
    it(`${distRelPath} still exports ${expectedExport} (spot check)`, () => {
      expect(importKeysNormally(distRelPath)).toContain(expectedExport);
    });
  }
});

describe("render-environment declaration exhaustiveness (test 4)", () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  const realSubpaths = new Set(Object.keys(manifest.exports));
  const declaredSubpaths = new Set(Object.keys(RENDER_ENVIRONMENT));

  it("every package.json#exports subpath has a declared render environment", () => {
    const missing = [...realSubpaths].filter((s) => !declaredSubpaths.has(s));
    expect(missing).toEqual([]);
  });

  it("declares no subpath that isn't a real export", () => {
    const phantom = [...declaredSubpaths].filter((s) => !realSubpaths.has(s));
    expect(phantom).toEqual([]);
  });

  it("declares only the two allowed values", () => {
    for (const value of Object.values(RENDER_ENVIRONMENT)) {
      expect(["server-safe", "client-only"]).toContain(value);
    }
  });

  it("marks every new */server subpath server-safe, and its original barrel client-only", () => {
    for (const layer of ["atoms", "blocks", "shell", "charts", "theme"]) {
      expect(RENDER_ENVIRONMENT[`./${layer}/server`]).toBe("server-safe");
      expect(RENDER_ENVIRONMENT[`./${layer}`]).toBe("client-only");
    }
  });
});
