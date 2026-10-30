// @vitest-environment node
import { expect, it } from "vitest";
import { main } from "./cli.js";
it("keeps whole-library selection and brief unavailable until an engine exists", async () => {
  const error: string[] = [], io = { out: () => {}, error: (t: string) => error.push(t) };
  expect(await main(["select", "--root", "unused", "--starter", "custom"], io)).toBe(2);
  expect(error.join("\n")).toContain("select unavailable until the starter engine ships");
  expect(await main(["select", "--root", "unused", "--starter", "shadcn-base", "--brief"], io)).toBe(2);
});
