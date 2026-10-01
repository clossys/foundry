import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "site-conformance-cli-"));
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
  put("apps/site/app/page.tsx", `export default function Page() { return null; }\nconst a = "#a1b2c3";\n`);
}

describe("site-conformance-check exit codes", () => {
  it("returns 0 on --help", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main(["--help"])).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain("Usage: site-conformance-check");
  });

  it("returns 0 and prints the JSON report when findings exist", () => {
    site();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([root])).toBe(0);
    const out = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(out.mode).toBe("report");
    expect(out.findings).toHaveLength(2);
    expect(log.mock.calls[0]?.[0]).not.toContain("a1b2c3");
  });

  it("returns 2 for a missing site dir, --enforce, an unknown flag, no repo and a bad waiver", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main([root])).toBe(2);
    site();
    expect(main([root, "--site", "nope"])).toBe(2);
    expect(main([root, "--enforce"])).toBe(2);
    expect(main([root, "--bogus"])).toBe(2);
    expect(main([])).toBe(2);
    expect(main([join(root, "missing")])).toBe(2);
    put("clossys/conformance-waivers.json", "{");
    expect(main([root])).toBe(2);
  });

  it("accepts --site and prints the chosen site", () => {
    put("web/web-route-manifest.json", JSON.stringify({ routes: [] }));
    put("web/app/page.tsx", `import { V } from "@clossys/publisher/web";\nexport default V;\n`);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main([root, "--site", "web"])).toBe(0);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string).site).toBe("web");
  });
});
