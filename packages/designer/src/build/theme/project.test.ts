import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultThemeCss, isEmptyProjection, projectTheme, stockShadcnVars, themeHash, toCss, toShadcnVars, type ResolvedThemePins } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "..", "..");
/** Goldens: the Studio server's theme CSS (`studioTheme`) on the int2 fixture, captured before the move. */
const golden = (name: string) => readFileSync(join(here, "__fixtures__", name), "utf8");

// The same two candidates the producer test pins into a copy of the int2 fixture consumer.
const CANDIDATES: Record<string, { name: string; item: Record<string, unknown> }> = {
  "themes.primary": {
    name: "primary-v1.json",
    item: { name: "tally-primary", type: "registry:theme", cssVars: { theme: { radius: "0.5rem" }, light: { primary: "oklch(0.45 0.09 160)", "primary-foreground": "oklch(0.985 0 0)" }, dark: { primary: "oklch(0.78 0.11 160)" } } },
  },
  "themes.font-sans": {
    name: "font-sans-v1.json",
    item: { name: "tally-sans", type: "registry:font", font: { family: "\"Inter\", sans-serif", variable: "--font-sans" } },
  },
};
const pins = (): ResolvedThemePins => Object.fromEntries(Object.entries(CANDIDATES).map(([slot, { name, item }]) => {
  const sha256 = createHash("sha256").update(`${JSON.stringify(item, null, 2)}\n`, "utf8").digest("hex");
  return [slot, { slot, candidate: name, sha256, sample: false, content: item }];
}));

describe("theme projection (designer.md 9.8)", () => {
  it("projects the int2 fixture's consumer pins to the server's CSS bytes", () => {
    const projection = projectTheme(pins());
    expect(projection.schema).toBe("clossys.theme/1");
    expect(toCss(projection.vars)).toBe(golden("int2-pinned.css"));
  });

  it("uses the consumer pin's values in both modes and records where each came from", () => {
    const projection = projectTheme(pins());
    expect(projection.vars.light["--primary"]).toBe("oklch(0.45 0.09 160)");
    expect(projection.vars.dark["--primary"]).toBe("oklch(0.78 0.11 160)");
    expect(projection.vars.light["--font-sans"]).toBe("\"Inter\", sans-serif");
    expect(projection.sources["--primary"]).toMatchObject({ slot: "themes.primary", candidate: "primary-v1.json", sample: false });
    expect(projection.sources["--primary"]).not.toHaveProperty("content");
    const css = toCss(projection.vars);
    expect(css).toMatch(/\n\.dark \{\n {2}--primary: oklch\(0\.78 0\.11 160\);\n\}\n$/);
  });

  it("is the package default theme when the consumer pins no theme slot", () => {
    expect(isEmptyProjection(projectTheme({}))).toBe(true);
    expect(defaultThemeCss()).toBe(golden("int2-default.css"));
    expect(themeHash(defaultThemeCss())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("hashes its inputs, not the content's formatting", () => {
    const a = projectTheme(pins()), b = projectTheme(pins());
    expect(a.inputsSha256).toBe(b.inputsSha256);
    const changed = pins(); changed["themes.primary"]!.sha256 = "0".repeat(64);
    expect(projectTheme(changed).inputsSha256).not.toBe(a.inputsSha256);
  });

  it("drops declarations that are not plain custom-property text", () => {
    const projection = projectTheme({ "themes.primary": { slot: "themes.primary", candidate: "primary-v1.json", sha256: "0".repeat(64), sample: false, content: { name: "x", type: "registry:theme", cssVars: { light: { primary: "red; } body { color: red", "Bad Name": "red", ok: "blue" } } } } });
    expect(projection.vars.light).toEqual({ "--ok": "blue" });
  });

  it("fills unset shadcn variables from stock and keeps the consumer's", () => {
    const stock = stockShadcnVars();
    expect(stock.light["--background"]).toBeDefined();
    expect(stock.dark["--background"]).toBeDefined();
    const vars = toShadcnVars(projectTheme(pins()), stock);
    expect(vars.light["--primary"]).toBe("oklch(0.45 0.09 160)");
    expect(vars.dark["--primary"]).toBe("oklch(0.78 0.11 160)");
    expect(vars.light["--background"]).toBe(stock.light["--background"]);
    expect(vars.dark["--background"]).toBe(stock.dark["--background"]);
  });
});

describe("dependency direction (system.md 14.2)", () => {
  it("never imports @clossys/producer anywhere in the designer package source or manifest", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(?:[cm]?[jt]sx?)$/.test(entry)) files.push(full);
      }
    };
    walk(join(packageRoot, "src"));
    const self = fileURLToPath(import.meta.url);
    const offenders = files.filter(file => file !== self && /["']@clossys\/producer(?:\/[^"']*)?["']/.test(readFileSync(file, "utf8"))).map(file => relative(packageRoot, file));
    expect(offenders).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) expect(Object.keys(manifest[field] ?? {})).not.toContain("@clossys/producer");
  });
});
