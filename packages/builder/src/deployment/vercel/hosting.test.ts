import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { vercelHostingCommands } from "./hosting.js";

const require = createRequire(import.meta.url);
const builderVersion = (JSON.parse(
  readFileSync(require.resolve("../../../package.json"), "utf8"),
) as { version: string }).version;

describe("Vercel hosting adapter", () => {
  it("names npx invocations of the scoped package for the surface hosting commands", () => {
    const commands = vercelHostingCommands("web");
    expect(commands.installCommand).toBe(
      `npx @clossys/builder@${builderVersion} hosting install --surface web`,
    );
    expect(commands.ignoreCommand).toBe(
      `npx @clossys/builder@${builderVersion} hosting should-build --surface web`,
    );
    expect(commands.installCommand).toContain("@clossys/builder@");
    expect(commands.ignoreCommand).toContain("@clossys/builder@");
    expect(commands.installCommand).not.toMatch(/^builder /);
    expect(commands.ignoreCommand).not.toMatch(/^builder /);
  });

  it("rejects an invalid surface id", () => {
    expect(() => vercelHostingCommands("Bad")).toThrow("surface id must be a lowercase stable identifier");
  });
});
