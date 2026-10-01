import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SiteConformanceError, scanSiteConformance } from "./scan.js";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "site-conformance-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function put(relativePath: string, content: string): void {
  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const MANIFEST = JSON.stringify({ routes: [{ id: "/" }, { id: "/privacy" }] });
const VIEW_PAGE = `import { LandingView } from "@clossys/publisher/web";\nexport default function Page() { return LandingView; }\n`;

function baseSite(): void {
  put("apps/site/web-route-manifest.json", MANIFEST);
}

describe("R1 and R2", () => {
  it("flags a page with no Publisher view and a template route outside the manifest", () => {
    baseSite();
    put("apps/site/app/page.tsx", `export default function Page() { return null; }\n`);
    put("apps/site/app/privacy/page.tsx", `import { show } from "../view";\nexport default show;\n`);
    put("apps/site/app/view.tsx", `import { LegalView } from "@clossys/publisher/web";\nexport const show = LegalView;\n`);
    put("apps/site/app/(legal)/terms-of-use/page.tsx", `import { LegalView } from "@clossys/publisher/web";\nexport default LegalView;\n`);
    const result = scanSiteConformance(root);
    const r1 = result.findings.filter((f) => f.rule === "site/route-not-publisher-view");
    const r2 = result.findings.filter((f) => f.rule === "site/template-route-duplicate");
    expect(r1).toEqual([{ rule: "site/route-not-publisher-view", file: "apps/site/app/page.tsx", line: 1 }]);
    expect(r2).toEqual([{ rule: "site/template-route-duplicate", file: "apps/site/app/(legal)/terms-of-use/page.tsx", line: 1 }]);
    expect(result.findings).toHaveLength(2);
    expect(result.mode).toBe("report");
    expect(result.site).toBe("apps/site");
    expect(result.filesScanned).toBe(4);
  });

  it("follows exactly one relative import and no further", () => {
    baseSite();
    put("apps/site/app/page.tsx", `import { a } from "./one";\nexport default a;\n`);
    put("apps/site/app/one.ts", `import { b } from "./two";\nexport const a = b;\n`);
    put("apps/site/app/two.ts", `import { V } from "@clossys/publisher/web";\nexport const b = V;\n`);
    const result = scanSiteConformance(root);
    expect(result.findings.map((f) => f.rule)).toEqual(["site/route-not-publisher-view"]);
  });

  it("checks not-found and error files and skips node_modules and .next", () => {
    baseSite();
    put("apps/site/app/not-found.tsx", `export default function N() { return null; }\n`);
    put("apps/site/app/error.tsx", `import { ErrorView } from "@clossys/publisher/web";\nexport default ErrorView;\n`);
    put("apps/site/app/node_modules/x/page.tsx", `export default 1;\n`);
    put("apps/site/app/.next/page.tsx", `export default 1;\n`);
    const result = scanSiteConformance(root);
    expect(result.filesScanned).toBe(2);
    expect(result.findings).toEqual([{ rule: "site/route-not-publisher-view", file: "apps/site/app/not-found.tsx", line: 1 }]);
  });

  it("does not flag manifest routes and honours --site", () => {
    put("web/web-route-manifest.json", JSON.stringify({ routes: ["/", "/contact"] }));
    put("web/app/contact/page.tsx", VIEW_PAGE);
    const result = scanSiteConformance(root, { site: "web" });
    expect(result.findings).toEqual([]);
    expect(result.site).toBe("web");
  });

  it("refuses a missing or invalid manifest", () => {
    put("apps/site/app/page.tsx", VIEW_PAGE);
    expect(() => scanSiteConformance(root)).toThrow(SiteConformanceError);
    put("apps/site/web-route-manifest.json", "{");
    expect(() => scanSiteConformance(root)).toThrow(SiteConformanceError);
    put("apps/site/web-route-manifest.json", JSON.stringify({ routes: [{ nope: 1 }] }));
    expect(() => scanSiteConformance(root)).toThrow(SiteConformanceError);
  });

  it("refuses a missing site dir and a site with zero files", () => {
    expect(() => scanSiteConformance(root)).toThrow(SiteConformanceError);
    baseSite();
    mkdirSync(join(root, "apps/site/app"), { recursive: true });
    expect(() => scanSiteConformance(root)).toThrow(/no .ts\/.tsx files/);
  });
});

describe("R3 and no echo", () => {
  it("flags hex and colour functions, honours the ignore marker, skips comments and anchors", () => {
    baseSite();
    put(
      "apps/site/app/page.tsx",
      [
        `import { V } from "@clossys/publisher/web";`,
        `const a = "#a1b2c3";`,
        `const b = "rgb(1, 2, 3)";`,
        `const c = "#d4e5f6"; // token-gate:ignore brand asset`,
        `const d = "#section";`,
        `// "#ffffff" in a comment`,
        ` * "#eeeeee" in a block comment`,
        `const e = 'hsl(10 20% 30%)';`,
        `const f = "oklch(0.5 0.1 20)";`,
        `const g = "#abcd";`,
        `export default V;`,
      ].join("\n") + "\n",
    );
    const result = scanSiteConformance(root);
    expect(result.findings.map((f) => [f.rule, f.line])).toEqual([
      ["site/raw-style-literal", 2],
      ["site/raw-style-literal", 3],
      ["site/raw-style-literal", 8],
      ["site/raw-style-literal", 9],
      ["site/raw-style-literal", 10],
    ]);
    const json = JSON.stringify(result);
    for (const literal of ["a1b2c3", "rgb(1", "hsl(10", "oklch(0.5", "abcd", "d4e5f6"]) {
      expect(json).not.toContain(literal);
    }
  });
});

describe("waivers", () => {
  const WAIVER = "clossys/conformance-waivers.json";
  function page(): void {
    baseSite();
    put("apps/site/app/page.tsx", `import { V } from "@clossys/publisher/web";\nconst a = "#a1b2c3";\nexport default V;\n`);
  }

  it("moves a matched finding to waived with its reason and reports an unmatched waiver", () => {
    page();
    put(
      WAIVER,
      JSON.stringify({
        version: 1,
        waivers: [
          { rule: "site/raw-style-literal", path: "apps/site/app/page.tsx", reason: "brand asset" },
          { rule: "site/raw-style-literal", path: "apps/site/app/gone.tsx", reason: "stale" },
        ],
      }),
    );
    const result = scanSiteConformance(root);
    expect(result.waived).toEqual([{ rule: "site/raw-style-literal", file: "apps/site/app/page.tsx", line: 2, reason: "brand asset" }]);
    expect(result.findings).toEqual([{ rule: "site/waiver-unused", file: "apps/site/app/gone.tsx", line: 1 }]);
  });

  it("rejects an empty reason, an unknown rule, a duplicate and bad JSON", () => {
    page();
    const bad = (body: string) => {
      put(WAIVER, body);
      expect(() => scanSiteConformance(root)).toThrow(SiteConformanceError);
    };
    bad(JSON.stringify({ version: 1, waivers: [{ rule: "site/raw-style-literal", path: "apps/site/app/page.tsx", reason: "  " }] }));
    bad(JSON.stringify({ version: 1, waivers: [{ rule: "site/nope", path: "apps/site/app/page.tsx", reason: "x" }] }));
    const w = { rule: "site/raw-style-literal", path: "apps/site/app/page.tsx", reason: "x" };
    bad(JSON.stringify({ version: 1, waivers: [w, { ...w, reason: "y" }] }));
    bad("{");
    bad(JSON.stringify({ version: 2, waivers: [] }));
  });
});

describe("import detection reads tokens, not text", () => {
  const rules = () => scanSiteConformance(root).findings.map((f) => f.rule);

  it("does not let a commented-out, quoted or member-call import satisfy R1", () => {
    baseSite();
    const cases: Record<string, string> = {
      line: `// import { V } from "@clossys/publisher/web";\nexport default 1;\n`,
      block: `/* import { V } from "@clossys/publisher/web"; */\nexport default 1;\n`,
      "block-multiline": `/*\n import { V }\n   from "@clossys/publisher/web";\n*/\nexport default 1;\n`,
      "trailing-block": `export default 1; /* from "@clossys/publisher/web" */\n`,
      string: `const s = 'import x from "@clossys/publisher/web"';\nexport default s;\n`,
      template: "const s = `import x from \"@clossys/publisher/web\"`;\nexport default s;\n",
      member: `export default loader.from("@clossys/publisher/web");\n`,
    };
    for (const [name, source] of Object.entries(cases)) {
      put("apps/site/app/page.tsx", source);
      expect(rules(), name).toEqual(["site/route-not-publisher-view"]);
    }
  });

  it("still accepts every real import shape, including after comments", () => {
    baseSite();
    const cases = [
      `import { V } from "@clossys/publisher/web";\nexport default V;\n`,
      `import "@clossys/publisher/web";\nexport default 1;\n`,
      `import {\n  V,\n} from '@clossys/publisher/web/landing';\nexport default V;\n`,
      `export { V } from "@clossys/publisher/web";\n`,
      `const m = await import("@clossys/publisher/web");\nexport default m;\n`,
      `const m = import /* lazy */ ( "@clossys/publisher/web" );\nexport default m;\n`,
      `// import nothing here\nimport { V } from "@clossys/publisher/web"; // real\nexport default V;\n`,
      "const t = `${1}`;\nimport { V } from \"@clossys/publisher/web\";\nexport default V;\n",
    ];
    for (const source of cases) {
      put("apps/site/app/page.tsx", source);
      expect(rules(), source).toEqual([]);
    }
  });

  it("does not follow a commented-out relative import", () => {
    baseSite();
    put("apps/site/app/page.tsx", `// import { a } from "./one";\nexport default 1;\n`);
    put("apps/site/app/one.ts", `import { V } from "@clossys/publisher/web";\nexport const a = V;\n`);
    expect(rules()).toEqual(["site/route-not-publisher-view"]);
  });

  it("scans long whitespace runs in linear time", () => {
    baseSite();
    const gap = " ".repeat(100_000);
    put("apps/site/app/page.tsx", `import${gap}\nfrom${gap}x;\nimport${gap}(${gap}x);\nexport default 1;\n`);
    const started = Date.now();
    expect(rules()).toEqual(["site/route-not-publisher-view"]);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("reaches the end of an unterminated string or comment without hanging or crashing", () => {
    baseSite();
    for (const source of [`const s = "never closed\nexport default 1;\n`, "const s = `never closed ${\n", `/* never closed\n`, `import "@clossys/publisher/web`]) {
      put("apps/site/app/page.tsx", source);
      expect(rules(), source).toEqual(["site/route-not-publisher-view"]);
    }
  });
});

describe("symlinks", () => {
  it("reports a symlinked page, file or directory, and a broken link, as unscanned", () => {
    baseSite();
    put("apps/site/app/page.tsx", VIEW_PAGE);
    put("elsewhere/page.tsx", `export default 1;\n`);
    mkdirSync(join(root, "elsewhere/dir"), { recursive: true });
    mkdirSync(join(root, "apps/site/app/about"), { recursive: true });
    symlinkSync(join(root, "elsewhere/page.tsx"), join(root, "apps/site/app/about/page.tsx"));
    symlinkSync(join(root, "elsewhere/dir"), join(root, "apps/site/app/linked"));
    symlinkSync(join(root, "elsewhere/missing"), join(root, "apps/site/app/dangling"));
    const result = scanSiteConformance(root);
    expect(result.findings).toEqual([
      { rule: "site/symlink-unscanned", file: "apps/site/app/about/page.tsx", line: 1 },
      { rule: "site/symlink-unscanned", file: "apps/site/app/dangling", line: 1 },
      { rule: "site/symlink-unscanned", file: "apps/site/app/linked", line: 1 },
    ]);
    expect(result.filesScanned).toBe(1);
  });

  it("ignores a symlink to a non-source file", () => {
    baseSite();
    put("apps/site/app/page.tsx", VIEW_PAGE);
    put("elsewhere/logo.png", "x");
    symlinkSync(join(root, "elsewhere/logo.png"), join(root, "apps/site/app/logo.png"));
    expect(scanSiteConformance(root).findings).toEqual([]);
  });

  it("cannot be waived away", () => {
    baseSite();
    put("apps/site/app/page.tsx", VIEW_PAGE);
    put("elsewhere/x.ts", `export default 1;\n`);
    symlinkSync(join(root, "elsewhere/x.ts"), join(root, "apps/site/app/x.ts"));
    put("clossys/conformance-waivers.json", JSON.stringify({ version: 1, waivers: [{ rule: "site/symlink-unscanned", path: "apps/site/app/x.ts", reason: "r" }] }));
    expect(() => scanSiteConformance(root)).toThrow(SiteConformanceError);
  });

  it("refuses a symlinked site directory, inside or outside the repository", () => {
    put("outside/web-route-manifest.json", MANIFEST);
    put("outside/app/page.tsx", VIEW_PAGE);
    put("repo/real/web-route-manifest.json", MANIFEST);
    put("repo/real/app/page.tsx", VIEW_PAGE);
    symlinkSync(join(root, "outside"), join(root, "repo/out-link"));
    symlinkSync(join(root, "repo/real"), join(root, "repo/in-link"));
    expect(() => scanSiteConformance(join(root, "repo"), { site: "out-link" })).toThrow(/symlink/);
    expect(() => scanSiteConformance(join(root, "repo"), { site: "in-link" })).toThrow(/symlink/);
    expect(scanSiteConformance(join(root, "repo"), { site: "real" }).findings).toEqual([]);
  });

  it("refuses a site reached through a symlinked parent directory", () => {
    put("outside/site/web-route-manifest.json", MANIFEST);
    put("outside/site/app/page.tsx", VIEW_PAGE);
    mkdirSync(join(root, "repo"), { recursive: true });
    symlinkSync(join(root, "outside"), join(root, "repo/apps"));
    expect(() => scanSiteConformance(join(root, "repo"), { site: "apps/site" })).toThrow(/symlink/);
  });

  it("names the symlink, not a missing app directory, when the symlinked site has no app", () => {
    put("outside/web-route-manifest.json", MANIFEST);
    mkdirSync(join(root, "repo"), { recursive: true });
    symlinkSync(join(root, "outside"), join(root, "repo/site"));
    expect(() => scanSiteConformance(join(root, "repo"), { site: "site" })).toThrow(/symlink/);
  });

  it("refuses a symlinked app directory", () => {
    put("apps/site/web-route-manifest.json", MANIFEST);
    put("elsewhere/page.tsx", VIEW_PAGE);
    symlinkSync(join(root, "elsewhere"), join(root, "apps/site/app"));
    expect(() => scanSiteConformance(root)).toThrow(/symlink/);
  });

  it("accepts a repository root that is itself reached through a symlink", () => {
    put("real/apps/site/web-route-manifest.json", MANIFEST);
    put("real/apps/site/app/page.tsx", VIEW_PAGE);
    symlinkSync(join(root, "real"), join(root, "link"));
    expect(scanSiteConformance(join(root, "link")).findings).toEqual([]);
  });
});
