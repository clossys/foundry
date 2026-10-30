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

  it("awaits complete transitive selected modules and shares one evaluation between concurrent loads", async () => {
    const runtime = selectedRuntime([
      { path: "entry.ts", content: 'export { answer, identity } from "./middle.js";' },
      { path: "middle.ts", content: 'export { answer, identity } from "./value.js";' },
      { path: "value.ts", content: 'export const identity = {}; export const answer = await Promise.resolve(42);' },
    ]);
    const [first, second] = await Promise.all([runtime.loadAsync("entry.ts"), runtime.loadAsync("entry.ts")]);
    expect(first).toBe(second);
    expect(first.answer).toBe(42);
    expect(first.identity).toBe((await runtime.loadAsync("value.ts")).identity);
    expect(await runtime.loadAsync("entry.ts")).toBe(first);
  });

  it("evicts asynchronous failures and refuses the actual missing selected import on every load", async () => {
    const runtime = selectedRuntime([{ path: "entry.ts", content: 'export const before = await Promise.resolve(true); import { missing } from "./missing.js"; export { missing };' }]);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(runtime.loadAsync("entry.ts")).rejects.toThrow("Missing selected import ./missing.js from entry.ts");
    }
  });

  it("keeps ordinary cycles on the asynchronous boundary without eagerly evaluating conditional optional imports", async () => {
    const runtime = selectedRuntime([
      { path: "a.ts", content: 'export const name = "a"; import { name as other } from "./b.js"; export const pair = () => name + other;' },
      { path: "b.ts", content: 'export const name = "b"; import { name as other } from "./a.js"; export const pair = () => other + name;' },
      { path: "optional.ts", content: 'export const present = await (async () => { try { return await import("./absent.js"); } catch { return false; } })();' },
    ]);
    const a = await runtime.loadAsync("a.ts");
    expect((a.pair as () => string)()).toBe("ab");
    expect(((await runtime.loadAsync("b.ts")).pair as () => string)()).toBe("ab");
    expect((await runtime.loadAsync("optional.ts")).present).toBe(false);
  });

  it("executes top-level-await modules against actual installed native peers", async () => {
    const runtime = selectedRuntime([{ path: "entry.ts", content: 'import { clsx } from "clsx"; export const value = await Promise.resolve(clsx("first", { second: true }));' }]);
    expect((await runtime.loadAsync("entry.ts")).value).toBe("first second");
    expect(runtime.peer("clsx").clsx("first", { second: true })).toBe("first second");
  });
});
