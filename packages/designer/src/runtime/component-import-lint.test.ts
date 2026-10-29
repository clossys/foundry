import { describe, expect, it } from "vitest";
import { componentImportFindings } from "../component-import-lint.js";

describe("component injection import rule", () => {
  it.each(["../../components/Button.js", "../../../components/Button.js", "../components/index.js", "@clossys/designer/components"])("refuses direct runtime values from %s", specifier => {
    expect(componentImportFindings("runtime/sections/example.tsx", `import { Button } from ${JSON.stringify(specifier)};`)).toHaveLength(1);
  });
  it("refuses reexports and dynamic imports as well as ordinary imports", () => {
    expect(componentImportFindings("blocks/example.tsx", 'export { Button } from "../components/Button.js"; import("../components/Button.js");')).toHaveLength(2);
  });
  it("resolves aliased imports before checking their implementation location", () => {
    expect(componentImportFindings("blocks/example.tsx", 'import { Button } from "@controls/action";', () => "/consumer/src/components/Button.tsx")).toHaveLength(1);
  });
  it("permits erased type-only references and the selected component facade", () => {
    expect(componentImportFindings("runtime/sections/example.tsx", 'import type { ButtonProps } from "../../components/Button.js"; import { type ButtonSize } from "../../components/Button.js"; import { Button } from "../../selected-components/Button.js";')).toEqual([]);
  });
});
