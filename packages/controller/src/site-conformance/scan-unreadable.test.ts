import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Running as a privileged user, a chmod cannot make a file unreadable, so the
// read failure is injected at the module boundary instead.
const unreadable = vi.hoisted(() => ({ names: new Set<string>() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const fail = (path: unknown): void => {
    if (typeof path === "string" && unreadable.names.has(path.slice(path.lastIndexOf("/") + 1))) {
      throw Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: "EACCES" });
    }
  };
  return {
    ...actual,
    readFileSync: ((path: never, ...rest: never[]) => {
      fail(path);
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.readFileSync,
    readdirSync: ((path: never, ...rest: never[]) => {
      fail(path);
      return (actual.readdirSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.readdirSync,
  };
});

const { SiteConformanceError, scanSiteConformance } = await import("./scan.js");
const { main } = await import("./cli.js");

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "site-conformance-unreadable-"));
  unreadable.names.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function put(relativePath: string, content: string): void {
  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function site(): void {
  put("apps/site/web-route-manifest.json", JSON.stringify({ routes: [{ id: "/" }] }));
  put("apps/site/app/page.tsx", `import { V } from "@clossys/publisher/web";\nexport default V;\n`);
  put("apps/site/app/other.ts", `export const a = 1;\n`);
}

describe("an unreadable input never reports clean", () => {
  it("refuses an unreadable source file with a SiteConformanceError, not a raw fs error", () => {
    site();
    unreadable.names.add("other.ts");
    expect(() => scanSiteConformance(root)).toThrow(SiteConformanceError);
  });

  it("refuses an unreadable directory", () => {
    site();
    put("apps/site/app/nested/page.tsx", `export default 1;\n`);
    unreadable.names.add("nested");
    expect(() => scanSiteConformance(root)).toThrow(SiteConformanceError);
  });

  it("does not echo the path or the system error text", () => {
    site();
    unreadable.names.add("other.ts");
    expect(() => scanSiteConformance(root)).toThrow(/^(?!.*EACCES)(?!.*other\.ts).*could not be read/s);
  });

  it("exits 2, not 1, when a source file cannot be read", () => {
    site();
    unreadable.names.add("other.ts");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([root])).toBe(2);
    expect(error.mock.calls.join("\n")).toContain("site-conformance-check:");
  });

  it("still exits 0 once the file is readable again", () => {
    site();
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([root])).toBe(0);
  });
});
