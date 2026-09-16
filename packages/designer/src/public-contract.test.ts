import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

const JS_SUBPATHS = [
  "./tokens",
  "./atoms",
  "./atoms/server",
  "./icons",
  "./charts",
  "./charts/server",
  "./blocks",
  "./blocks/server",
  "./shell",
  "./shell/server",
  "./theme",
  "./theme/server",
  "./gate",
  "./render-environment",
] as const;
const CSS_SUBPATHS = ["./tokens.css", "./theme.css", "./compiled.css", "./brand-template.css"] as const;
const COMPONENT_DIRS = ["atoms", "blocks", "charts", "shell", "theme"] as const;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(?:ts|tsx)$/.test(entry) && !entry.includes(".test.")) out.push(path);
  }
  return out;
}

describe("public UI contract", () => {
  it("exports only intentional token, visual, and gate subpaths — never a root barrel or views", () => {
    expect(Object.keys(packageJson.exports)).toEqual([JS_SUBPATHS[0], ...CSS_SUBPATHS, ...JS_SUBPATHS.slice(1)]);
    expect(packageJson.exports["."]).toBeUndefined();
    expect(packageJson.exports["./views"]).toBeUndefined();

    for (const subpath of JS_SUBPATHS) {
      const entry = packageJson.exports[subpath] as { types?: string; import?: string };
      expect(entry.types, `${subpath} needs public types`).toMatch(/^\.\/dist\/.+\.d\.ts$/);
      expect(entry.import, `${subpath} needs an ESM entry`).toMatch(/^\.\/dist\/.+\.js$/);
    }

    for (const subpath of CSS_SUBPATHS) {
      const entry = packageJson.exports[subpath];
      expect(entry, `${subpath} needs a CSS entry`).toMatch(/^\.\/styles\/.+\.css$/);
      expect(existsSync(join(packageRoot, entry as string))).toBe(true);
    }
  });

  it("keeps token-only use free of component runtime installation", () => {
    expect(packageJson.dependencies).toBeUndefined();

    for (const dependency of ["@internationalized/date", "react", "react-dom", "react-aria-components", "tailwind-merge", "tailwindcss"]) {
      expect(packageJson.peerDependencies[dependency]).toBeDefined();
      expect(packageJson.peerDependenciesMeta[dependency]?.optional).toBe(true);
    }
  });

  it("keeps the CSS contract ordered: primitives, optional Tailwind wiring, then consumer brand overrides", () => {
    const tokens = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");
    const theme = readFileSync(join(packageRoot, "styles", "theme.css"), "utf8");
    const brand = readFileSync(join(packageRoot, "styles", "brand-template.css"), "utf8");

    expect(tokens).toContain(":root {");
    expect(theme).toContain('@import "./tokens.css";');
    expect(brand).toContain('@import "@clossys/designer/tokens.css";');
    expect(brand).toContain(":root[data-brand-bound]");
    expect(tokens).toContain(':root[data-theme="dark"]');
  });

  it("does not retain page-level views or reverse runtime dependencies on product packages", () => {
    expect(existsSync(join(packageRoot, "src", "views"))).toBe(false);

    const forbidden = /from\s+["']@clossys\/(?:copy|strategy|surface)(?:\/|["'])/;
    const violations = COMPONENT_DIRS.flatMap((dir) =>
      sourceFiles(join(packageRoot, "src", dir))
        .filter((file) => forbidden.test(readFileSync(file, "utf8")))
        .map((file) => file.slice(packageRoot.length + 1)),
    );
    expect(violations).toEqual([]);
  });

  it("honors reduced-motion preferences for every shipped animation or transition", () => {
    // Scanned, not hand-listed: a hand-written file list can't notice a new
    // motion site (see the package README and #907 — this is that
    // mechanism). Every source file under the component layer directories
    // is checked for a Tailwind `animate-*`/`transition-*` class literal;
    // any file that has one must also carry a `motion-reduce:` override.
    const MOTION_CLASS_RE = /\b(?:animate|transition)-[a-zA-Z[\]-]+/;

    const motionFiles = COMPONENT_DIRS.flatMap((dir) =>
      sourceFiles(join(packageRoot, "src", dir))
        .filter((file) => MOTION_CLASS_RE.test(readFileSync(file, "utf8")))
        .map((file) => file.slice(packageRoot.length + 1)),
    );

    expect(motionFiles.length).toBeGreaterThan(0);

    for (const file of motionFiles) {
      const source = readFileSync(join(packageRoot, file), "utf8");
      expect(source, `${file} must include a motion-reduce override`).toContain("motion-reduce:");
    }
  });
});
