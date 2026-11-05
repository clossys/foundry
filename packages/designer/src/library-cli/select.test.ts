// @vitest-environment node
import { expect, it } from "vitest";
import { main } from "./cli.js";
it("keeps whole-library selection and brief unavailable until an engine exists", async () => {
  const error: string[] = [], io = { out: () => {}, error: (t: string) => error.push(t) };
  expect(await main(["select", "--root", "unused", "--starter", "custom"], io)).toBe(2);
  // Public diagnostics are closed strings (cli-remedies.ts): the private "select unavailable" reason stays internal.
  expect(error.join("\n")).toContain("designer-library: invalid input or unavailable operation; check accepted inputs");
  expect(error.join("\n")).not.toContain("select unavailable until the starter engine ships");
  expect(await main(["select", "--root", "unused", "--starter", "shadcn-base", "--brief"], io)).toBe(2);
});
