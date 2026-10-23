import { existsSync, readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

const modules = import.meta.glob<ExampleModule>("../examples/**/*.{ts,tsx}", {
  eager: true,
});
const examplesDirectory = new URL("../examples/", import.meta.url);
const sourcesFile = new URL("sources.json", examplesDirectory);

// The README's conformance-test fences need only a parser; SSR stays in Node.
const parserWindow = new JSDOM("").window;
beforeAll(() => vi.stubGlobal("DOMParser", parserWindow.DOMParser));
afterAll(() => {
  vi.unstubAllGlobals();
  parserWindow.close();
});

// Only add the exact quickstart here after observing its server-render failure.
const SERVER_RENDER_EXCEPTIONS: { file: string; message: string }[] = [];

describe("Publisher README examples", () => {
  it("maps README fences and example files in both directions", () => {
    expect(existsSync(sourcesFile), "sources.json must exist").toBe(true);
    const sources = JSON.parse(readFileSync(sourcesFile, "utf8")) as Source[];
    const readme = readFileSync(new URL("../README.md", examplesDirectory), "utf8");
    const fences = readme.match(/^```tsx?\s*$/gm) ?? [];
    expect(fences.length).toBeGreaterThan(0);
    expect(sources).toHaveLength(fences.length);
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
    const onDisk = readdirSync(examplesDirectory, { recursive: true })
      .filter((file): file is string => typeof file === "string" && /\.tsx?$/.test(file))
      .map((file) => `examples/${file}`)
      .sort();
    expect(onDisk).toEqual([...listed, "examples/quickstart.tsx"].sort());
    expect(Object.keys(modules).map((file) => file.replace(/^\.\.\//, "")).sort())
      .toEqual(onDisk);
  });

  it("renders every TSX default export, with at most ten percent reasoned skips", () => {
    const components = Object.entries(modules).filter(([file]) => file.endsWith(".tsx"));
    expect(components.length).toBeGreaterThan(0);
    let skipped = 0;
    for (const [file, example] of components) {
      expect(typeof example.default, `${file} default export`).toBe("function");
      if (!example.default) throw new Error(`${file} has no default export`);
      const exception = SERVER_RENDER_EXCEPTIONS.find((entry) => entry.file === file);
      if (example.smokeSkip !== undefined) {
        expect(example.smokeSkip.trim(), `${file} skip reason`).not.toBe("");
        console.info(`Skipping ${file}: ${example.smokeSkip}`);
        skipped += 1;
      } else if (exception) {
        expect(() => renderToString(createElement(example.default!, example.smokeProps ?? {})))
          .toThrow(exception.message);
        console.info(`Skipping ${file}: ${exception.message}`);
        skipped += 1;
      } else {
        expect(renderToString(createElement(example.default, example.smokeProps ?? {})), file)
          .not.toBe("");
      }
    }
    expect(skipped / components.length).toBeLessThanOrEqual(0.1);
    for (const exception of SERVER_RENDER_EXCEPTIONS) {
      expect(components.some(([file]) => file === exception.file), exception.file).toBe(true);
    }
  });
});
