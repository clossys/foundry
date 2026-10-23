import { readdirSync, readFileSync } from "node:fs";
import { URL as NodeURL, fileURLToPath } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

interface ExampleModule {
  default?: ComponentType<Record<string, unknown>>;
  smokeProps?: Record<string, unknown>;
  smokeSkip?: string;
}

interface Source {
  file: string | null;
  heading: string;
  ordinal: number;
  reason?: string;
}

const modules = import.meta.glob<ExampleModule>("../examples/**/*.{ts,tsx}", { eager: true });
const examplesRoot = new NodeURL("../examples/", import.meta.url);
const tsxModules = Object.entries(modules).filter(([name]) => name.endsWith(".tsx"));

function exampleFiles(directory: NodeURL, prefix = "examples/"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return exampleFiles(new NodeURL(`${entry.name}/`, directory), `${name}/`);
    return /\.tsx?$/.test(entry.name) ? [name] : [];
  });
}

describe("README examples", () => {
  it("maps every extracted file to a source, with quickstart as the one extra file", () => {
    const sources: Source[] = JSON.parse(readFileSync(new NodeURL("sources.json", examplesRoot), "utf8"));
    expect(sources.length).toBeGreaterThan(0);
    const listed = sources.flatMap((source) => {
      expect(source.heading).toMatch(/^#{2,4} /);
      expect(source.ordinal).toBeGreaterThan(0);
      if (source.file === null) {
        expect(source.reason?.trim()).toBeTruthy();
        return [];
      }
      return [source.file];
    });
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toEqual([...listed].sort());
    expect(exampleFiles(examplesRoot).sort()).toEqual([...listed, "examples/quickstart.tsx"].sort());
    expect(Object.keys(modules).map((name) => name.replace(/^\.\.\//, "")).sort())
      .toEqual(exampleFiles(examplesRoot).sort());
  });

  it("exports a default component from every TSX example", () => {
    expect(tsxModules.length).toBeGreaterThan(0);
    for (const [name, mod] of tsxModules) expect(mod.default, name).toBeDefined();
  });

  it("keeps documented server-only skips within ten percent", () => {
    const skipped = tsxModules.filter(([, mod]) => mod.smokeSkip !== undefined);
    for (const [name, mod] of skipped) {
      expect(typeof mod.smokeSkip, name).toBe("string");
      expect(mod.smokeSkip?.trim(), name).toBeTruthy();
      console.info(`Skipping ${name}: ${mod.smokeSkip}`);
    }
    expect(skipped.length).toBeLessThanOrEqual(tsxModules.length * 0.1);
  });

  for (const [name, mod] of tsxModules) {
    it.skipIf(mod.smokeSkip !== undefined)(`renders ${name}`, () => {
      expect(mod.default, name).toBeDefined();
      const html = renderToString(createElement(mod.default!, mod.smokeProps ?? {}));
      expect(html.trim(), fileURLToPath(new NodeURL(name, import.meta.url))).not.toBe("");
    });
  }
});
