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
    { distRelPath: "tokens/server.js", expectedExports: ["readBrandCss", "assertTailwindMergeVersion"] },
    { distRelPath: "atoms/server.js", expectedExports: ["Avatar", "Badge", "Banner", "Card", "Field", "Icon", "Meter", "Skeleton", "Spinner", "StatusMark", "buttonLinkClassName", "iconButtonClassName", "iconButtonLinkClassName", "mergeUiClasses"] },
    {
      distRelPath: "blocks/server.js",
      expectedExports: [
        "AnatomyCallouts",
        "ArticleBody",
        "CardGrid",
        "Comparison",
        "Matrix",
        "ContentSection",
        "DetailView",
        "EmptyState",
        "Faq",
        "FeatureGrid",
        "FieldGroup",
        "Hero",
        "Item",
        "Items",
        "LinkGrid",
        "LedgerTile",
        "RecordLedger",
        "Scene",
        "layoutScene",
        "sceneRelationText",
        "MarketingChapter",
        "MediaFigure",
        "OrderedStepSequence",
        "PageHeader",
        "PricingTable",
        "SECTION_GROUND_CLASSES",
        "SectionFrame",
        "SectionHeader",
        "SectionIntro",
        "Specimen",
        "SpecimenPanel",
        "Stat",
        "StatusList",
        "TopicList",
      ],
    },
    { distRelPath: "shell/server.js", expectedExports: ["BADGE_INSET_SHARE", "BADGE_RADIUS_SHARE", "Brandmark", "Shell", "SiteFooter", "SiteHeader", "SkipLink", "badgePlatePath"] },
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

describe("pure Item and Items compiled graphs", () => {
  it.each(["Item", "Items"])("imports and calls %s under react-server", (name) => {
    const absolute = join(distDir, "blocks", "items", `${name === "Items" ? "Items.server" : name}.js`);
    const props = name === "Item"
      ? { id: "one", heading: "Title", treatment: "plate", size: "standard", ground: "base", badge: { label: "Beta", tone: "info" }, meta: "Actor", visual: "Visual" }
      : { arrangement: "rows", items: [{ id: "one", heading: "One", badge: { label: "Beta" }, meta: "Actor" }, { id: "two", heading: "Two" }, { id: "three", heading: "Three" }, { id: "four", heading: "Four" }], groups: [{ id: "a", label: "Group A", items: ["one", "two"] }, { id: "b", label: "Group B", items: ["three", "four"] }] };
    const script = `import(${JSON.stringify(absolute)}).then(m => { const tree = m[${JSON.stringify(name)}](${JSON.stringify(props)}); if (!tree || typeof tree !== "object" || !tree.props) throw new Error("missing rendered tree"); process.stdout.write("OK"); }).catch(e => { console.error(e); process.exit(1); });`;
    expect(execFileSync(process.execPath, ["--conditions=react-server", "-e", script], { encoding: "utf8", timeout: 10_000 })).toBe("OK");
  });
  it("keeps ordinary React Aria Items out of the native server graph", () => {
    const result = probeUnderReactServer("blocks/items/Items.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/react|useContext|useState|createContext/i);
  });
  it("calls native disclosure and the FeatureGrid catalog path under react-server", () => {
    const absolute = join(distDir, "blocks", "server.js");
    const script = `import(${JSON.stringify(absolute)}).then(m => { const items = [0,1,2,3].map(i => ({ id: String(i), heading: "Title " + i, description: "Answer " + i })); function nativeNodes(node) { if(Array.isArray(node)) return node.flatMap(nativeNodes); if(!node || typeof node !== "object" || !node.props) return []; if(typeof node.type === "function") return nativeNodes(node.type(node.props)); return [node,...nativeNodes(node.props.children)]; } const rows=nativeNodes(m.Items({arrangement:"rows",reveal:"disclose",items})); if(rows.filter(n=>n.type==="details").length!==4 || rows.filter(n=>n.type==="summary").length!==4) throw new Error("native disclosure anatomy"); const features=nativeNodes(m.FeatureGrid({heading:"Features",columns:3,items:items.slice(0,3)})); if(!features.some(n=>n.props["data-items"]!==undefined) || features.filter(n=>n.props["data-item"]!==undefined).length!==3) throw new Error("static catalog path missing"); process.stdout.write("OK"); }).catch(e => { console.error(e); process.exit(1); });`;
    expect(execFileSync(process.execPath, ["--conditions=react-server", "-e", script], { encoding: "utf8", timeout: 10_000 })).toBe("OK");
  });
});

describe("compiled grouped Items SSR", () => {
  it.each(["Items", "Items.server"])("retains disclosure answers and local references across duplicate compiled %s instances", name => {
    const absolute = join(distDir, "blocks", "items", `${name}.js`);
    const script = `import {createElement as h} from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {Items} from ${JSON.stringify(absolute)}; const props={arrangement:"rows",reveal:"disclose",order:"numbered",items:[0,1,2,3].map(i=>({id:String(i),heading:"Question "+i,description:"Answer "+i})),groups:[{id:"a",label:"A",items:["2","0"]},{id:"b",label:"B",items:["3","1"]}]}; process.stdout.write(renderToStaticMarkup(h("div",null,h(Items,props),h(Items,props))));`;
    const html = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000, cwd: packageRoot });
    const host = document.createElement("div"); host.innerHTML = html;
    const ids = [...host.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(host.querySelectorAll("[data-item-description]")).toHaveLength(8);
    for (const trigger of host.querySelectorAll("[aria-controls]")) {
      const target = host.querySelector(`[id="${trigger.getAttribute("aria-controls")}"]`);
      expect(target).not.toBeNull(); expect(trigger.closest("li")?.contains(target)).toBe(true);
      expect(target).toHaveAttribute("aria-labelledby", trigger.id);
    }
    expect([...host.querySelectorAll("[data-item-ordinal]")].map(node => node.textContent)).toEqual(["1", "2", "3", "4", "1", "2", "3", "4"]);
    if (name === "Items.server") expect(host.querySelectorAll("details:not([open]) > summary:first-child")).toHaveLength(8);
    else expect(host.querySelectorAll("button[aria-expanded=false]")).toHaveLength(8);
  });
  it("gives duplicate instances unique heading IDs and resolves every reference", () => {
    const absolute = join(distDir, "blocks", "items", "Items.server.js");
    const server = join(distDir, "blocks", "server.js");
    const script = `import { createElement as h } from "react"; import { renderToStaticMarkup } from "react-dom/server"; import { Items } from ${JSON.stringify(absolute)}; import * as barrel from ${JSON.stringify(server)}; const props = { arrangement: "rows", items: [0,1,2,3].map(i => ({ id: String(i), heading: "Title " + i, badge: { label: "Beta", tone: "info" }, meta: "Actor" })), groups: [{ id: "a", label: "A", items: ["1","0"] }, { id: "b", label: "B", items: ["3","2"] }] }; if(barrel.Items !== Items) throw new Error("server barrel identity"); process.stdout.write(renderToStaticMarkup(h("div", null, h(Items, props), h(Items, props))));`;
    const html = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000, cwd: packageRoot });
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const references = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(references).toEqual(ids);
    expect(html).toContain("Beta"); expect(html).toContain("Actor");
    expect(html).toContain("inline-flex rounded-pill bg-surface-base");
    expect(html).toContain("bg-status-info-tint");
    expect([...html.matchAll(/<ul[^>]*role="list"/g)]).toHaveLength(4);
    expect([...html.matchAll(/<li\b/g)]).toHaveLength(8);
    expect([...html.matchAll(/<div[^>]*role="group"/g)]).toHaveLength(4);
    expect(html).not.toContain("<section");
  });
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

  it("marks server subpaths server-safe and keeps the pure tokens entry server-safe", () => {
    const serverSubpaths = [...realSubpaths].filter((subpath) => subpath.endsWith("/server"));
    expect(serverSubpaths.length).toBeGreaterThan(0);
    for (const subpath of serverSubpaths) {
      expect(RENDER_ENVIRONMENT[subpath]).toBe("server-safe");
      const original = subpath.slice(0, -"/server".length);
      expect(RENDER_ENVIRONMENT[original]).toBe(original === "./tokens" ? "server-safe" : "client-only");
    }
  });
});
