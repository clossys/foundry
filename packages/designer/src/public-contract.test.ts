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
const CSS_SUBPATHS = ["./tokens.css", "./theme.css", "./theme-keys.css", "./compiled.css", "./brand-template.css"] as const;
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
    expect(Object.keys(packageJson.exports)).toEqual([
      JS_SUBPATHS[0],
      ...CSS_SUBPATHS,
      ...JS_SUBPATHS.slice(1),
    ]);
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
    expect(theme).toContain('@import "./theme-keys.css";');
    expect(existsSync(join(packageRoot, "styles", "theme-keys.css"))).toBe(true);
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

  it("marks ArticleBody as requiring a SectionFrame parent", () => {
    const source = readFileSync(join(packageRoot, "src/blocks/ArticleBody.tsx"), "utf8");
    expect(source).toContain('data-designer-requires-section-frame');
    expect(source).not.toContain("UI_WIDTH_PROSE_MAX");
  });

  it("positions every component with logical inline utilities, never physical left/right ones", () => {
    // #687 is why this exists. Five shell components positioned themselves
    // with physical direction classes (`border-r`, `border-l`, `left-0`,
    // `right-md`, `focus:left-sm`) and landed on the wrong side under a
    // right-to-left locale. Each was replaced with its logical equivalent
    // in 0.2.6 — but nothing then stopped a sixth from being written, and a
    // per-instance fix without a gate only defers the next instance.
    //
    // Scanned, not hand-listed, for the same reason the reduced-motion test
    // above is (#907): the CHECK is fully derived from the tree, so a new
    // component, or a new physical class in an existing one, cannot escape
    // it by not being on a list someone forgot to update.
    //
    // Block-direction utilities are deliberately NOT matched. `border-t`
    // and `border-b` on `SiteHeader`, `SiteFooter`, `Shell.Header`,
    // `Shell.Footer`, `Tabs` and `Table` are correct exactly as written:
    // block direction does not flip under a right-to-left locale, and
    // rewriting them would be the over-correction #687 explicitly refuses.
    // Nor are axis utilities (`overflow-x-auto`, `inset-x-0`, `px-*`,
    // `mx-*`), which address both inline sides at once and so are already
    // direction-neutral.
    const PHYSICAL_INLINE_RE = new RegExp(
      "(?:^|[\\s\"'`:])(" +
        [
          "(?:scroll-)?[mp][lr]-[a-z0-9[\\]./%-]+", // ml-auto, pr-2xl, scroll-pl-md
          "(?:left|right)-[a-z0-9[\\]./%-]+", // left-0, right-md
          "border-[lr](?![a-z])(?:-[0-9[][a-z0-9[\\]./%-]*)?", // border-l, border-r-2 — never border-line-base
          "text-(?:left|right)(?![a-z-])",
          "float-(?:left|right)(?![a-z-])",
          "clear-(?:left|right)(?![a-z-])",
          "origin-(?:(?:top|bottom)-)?(?:left|right)(?![a-z-])",
          "rounded-(?:[tb]?[lr])(?![a-z])(?:-[a-z0-9[\\]./%-]+)?",
        ].join("|") +
        ")",
      "g",
    );

    /**
     * Instances that exist TODAY, outside #687's declared scope (that issue
     * is five shell components, and says in as many words that it is "not a
     * general RTL audit"). This is a record of known debt, NOT a list of
     * approved exceptions — every entry below is a real right-to-left
     * defect in `atoms/` or `blocks/` awaiting its own change. Two rules
     * keep it from rotting into an approval list: nothing may be ADDED to
     * it (a new instance fails this test), and an entry that no longer
     * matches fails too — so the list can only ever shrink.
     */
    const KNOWN_PHYSICAL_INLINE: string[] = [];

    const found = new Set<string>();
    for (const dir of COMPONENT_DIRS) {
      for (const file of sourceFiles(join(packageRoot, "src", dir))) {
        const relative = file.slice(packageRoot.length + 1);
        for (const match of readFileSync(file, "utf8").matchAll(PHYSICAL_INLINE_RE)) {
          found.add(`${relative} :: ${match[1]}`);
        }
      }
    }

    // #951 cleared the last known-debt entries; an empty scan is the goal.
    // If this regresses to zero matches while debt reappears, `added` below
    // still fails — this assertion only guards the "scan ran" case when debt
    // remains listed in KNOWN_PHYSICAL_INLINE.
    if (KNOWN_PHYSICAL_INLINE.length > 0) {
      expect(found.size).toBeGreaterThan(0);
    }

    const added = [...found].filter((hit) => !KNOWN_PHYSICAL_INLINE.includes(hit)).sort();
    expect(
      added,
      "New physical inline-direction class(es). Use the logical equivalent so the component follows the document writing direction: " +
        "ml-/mr- to ms-/me-, pl-/pr- to ps-/pe-, left-/right- to start-/end-, border-l/border-r to border-s/border-e, " +
        "text-left/text-right to text-start/text-end, rounded-l*/rounded-r* to rounded-s*/rounded-e*.",
    ).toEqual([]);

    const stale = KNOWN_PHYSICAL_INLINE.filter((hit) => !found.has(hit)).sort();
    expect(
      stale,
      "Known-debt entr(ies) no longer in the tree — delete them from KNOWN_PHYSICAL_INLINE so the list keeps shrinking.",
    ).toEqual([]);

    // Shell carries none of this debt: #687's five are fixed and the list
    // above names only `atoms/` and `blocks/`. Asserted rather than left
    // implied, so a shell regression fails HERE with the issue named,
    // instead of as one anonymous line in the `added` diff above.
    expect([...found].filter((hit) => hit.startsWith("src/shell/")), "#687 regression in src/shell/").toEqual([]);
  });
});
