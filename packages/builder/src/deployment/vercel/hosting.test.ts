import { describe, expect, it } from "vitest";
import { vercelHostingCommands } from "./hosting.js";

describe("Vercel hosting adapter", () => {
  it("names the package commands a hosting config calls for the surface", () => {
    expect(vercelHostingCommands("web")).toEqual({
      installCommand: "builder hosting install --surface web",
      ignoreCommand: "builder hosting should-build --surface web",
    });
  });
});
