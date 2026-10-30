import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSurfaceSourceScanner } from "../../scripts/lib/surface-source-scan.mjs";
import type { CompositeResolved } from "../catalog-core/types.js";
import { Button } from "../components/Button.js";
import { bindComponentSpecimen } from "./component-specimens.js";

describe("selected component binding without sample rendering", () => {
  it("binds the exact selected module and preserves missing-module refusals", () => {
    const profile = { components: { components: { "components.button": {
      impl: { kind: "package", module: "@clossys/designer/components", export: "Button" },
      descriptor: { members: [] }, propMap: {}, origin: { kind: "adopted", source: "foundry" },
    } } } } as unknown as CompositeResolved;
    const namespace = { Button };
    const result = bindComponentSpecimen({ modules: { "@clossys/designer/components": namespace } }, "components.button", profile);
    expect(result).toMatchObject({ binding: { Component: Button, source: "foundry", exports: namespace, members: [], unbound: [] } });
    expect(bindComponentSpecimen({ modules: {} }, "components.button", profile)).toEqual({ refusal: { leaf: "components.button", code: "module-unavailable", detail: "@clossys/designer/components" } });
    expect(bindComponentSpecimen({ modules: {} }, "components.absent", profile)).toMatchObject({ refusal: { code: "not-chosen" } });
  });

  it("keeps sample datasets outside the actual binding source closure", () => {
    const root = resolve(process.cwd(), "../..");
    const scanner = createSurfaceSourceScanner({
      packages: { "@clossys/designer": "packages/designer/src" },
      read(path: string) { try { return readFileSync(resolve(root, path), "utf8"); } catch { return undefined; } },
    });
    const scan = scanner.scan({ fill: "binding-control", packageName: "@clossys/designer", pointer: "./studio/component-specimens#bindComponentSpecimen" });
    expect(scan.files.some((file: { path: string }) => file.path.endsWith("studio/component-specimens.tsx"))).toBe(true);
    expect(scan.files.map((file: { path: string }) => file.path).join("\n")).not.toMatch(/component-specimen-samples|specimen-dataset|__fixtures__/);
  });
});
