import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..");

/** Every module specifier a source file names: static, re-export, side-effect and dynamic imports. */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^"';]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.add(match[1]!);
  return [...found];
}

function resolveRelative(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`unresolved relative import ${specifier} in ${relative(srcRoot, from)}`);
}

/** The root entry's relative import closure, as paths relative to src/. */
function rootImportGraph(): string[] {
  const entry = join(srcRoot, "index.ts");
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of specifiersOf(file)) {
      const target = resolveRelative(file, specifier);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...seen].map((file) => relative(srcRoot, file).split("\\").join("/")).sort();
}

describe("P-13 root-isolation (O-4, C-1)", () => {
  it("the Observer root import graph reaches no browser-analytics module", () => {
    const graph = rootImportGraph();
    // The walk is real: it reaches the root's own pure modules.
    expect(graph).toContain("index.ts");
    expect(graph).toContain("redaction.ts");
    expect(existsSync(join(here, "transport.ts"))).toBe(true);
    expect(graph.filter((file) => file.startsWith("browser-analytics/"))).toEqual([]);
  });
});

describe("importing the subtree performs no I/O (C-1, C-2)", () => {
  const trapped = [
    "window",
    "document",
    "navigator",
    "localStorage",
    "sessionStorage",
    "location",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "setTimeout",
    "setInterval",
    "crypto",
  ] as const;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    saved.clear();
  });

  it("no browser-analytics module reads a browser global, a timer, the network or randomness at import", async () => {
    const touched: string[] = [];
    for (const name of trapped) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      saved.set(name, descriptor);
      let value: unknown = descriptor && "value" in descriptor ? descriptor.value : descriptor?.get?.call(globalThis);
      Object.defineProperty(globalThis, name, {
        configurable: true,
        set(next: unknown) {
          value = next;
        },
        get() {
          // Only a read made directly by a subtree module counts. Reads made
          // by the test runner while it loads a module are ignored.
          const caller = (new Error().stack ?? "").split("\n")[2] ?? "";
          if (/[\\/]browser-analytics[\\/](?!root-isolation\.test)/.test(caller)) touched.push(name);
          return value;
        },
      });
    }

    const modules = readdirSync(here, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => file.split("\\").join("/"));
    expect(modules).toEqual(expect.arrayContaining(["index.ts", "sanitize.ts", "transport.ts", "types.ts", "providers/posthog.ts"]));

    vi.resetModules();
    for (const file of modules) {
      const specifier = pathToFileURL(join(here, file)).href;
      await import(specifier);
    }
    expect(touched).toEqual([]);
  });
});
