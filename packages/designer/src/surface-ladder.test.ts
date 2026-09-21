import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSurfaceLadder, collectRouteSourceFiles } from "./surface-ladder.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "designer-surface-ladder-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("checkSurfaceLadder", () => {
  it("flags @clossys/designer/tokens.css and theme.css together", () => {
    writeFileSync(
      join(dir, "app.css"),
      '@import "@clossys/designer/tokens.css";\n@import "@clossys/designer/theme.css";\n',
      "utf8",
    );
    const result = checkSurfaceLadder(["app.css"], dir);
    expect(result.findings.some((f) => f.rule === "surface:dual-designer-css-root")).toBe(true);
  });

  it("flags designer blocks beside a foreign atom entrypoint", () => {
    writeFileSync(
      join(dir, "page.tsx"),
      `import { Hero } from "@clossys/designer/blocks";
import { Button } from "@acme/ui/atoms";
`,
      "utf8",
    );
    const result = checkSurfaceLadder(["page.tsx"], dir);
    expect(result.findings.some((f) => f.rule === "surface:dual-primitive-stack")).toBe(true);
  });

  it("collects route sources for surface walk", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "View.tsx"), "export {};\n", "utf8");
    writeFileSync(join(dir, "ignored.txt"), "x", "utf8");
    expect(collectRouteSourceFiles(dir)).toEqual(["src/View.tsx"]);
  });
});
