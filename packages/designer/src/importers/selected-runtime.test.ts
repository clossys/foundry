// @vitest-environment node
import { describe, expect, it } from "vitest";
import { selectedRuntime } from "./__fixtures__/selected-runtime.js";

describe("complete selected module loader", () => {
  it("refuses the same missing import on every load rather than returning partial exports", () => {
    const runtime = selectedRuntime([{ path: "entry.ts", content: 'export const before = true; import { missing } from "./missing.js"; export { missing };' }]);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => runtime.load("entry.ts")).toThrow("Missing selected import ./missing.js from entry.ts");
    }
  });

  it("retains ordinary module cycles and executes each successful module once", () => {
    const runtime = selectedRuntime([
      { path: "a.ts", content: 'export const name = "a"; import { name as other } from "./b.js"; export const pair = () => name + other;' },
      { path: "b.ts", content: 'export const name = "b"; import { name as other } from "./a.js"; export const pair = () => other + name;' },
    ]);
    const a = runtime.load("a.ts");
    expect((a.pair as () => string)()).toBe("ab");
    expect((runtime.load("b.ts").pair as () => string)()).toBe("ab");
    expect(runtime.load("a.ts")).toBe(a);
  });
});
