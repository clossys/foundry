import { describe, expect, it } from "vitest";
import { runCli } from "./main.js";
import { COMPILE_USAGE } from "./compile.js";

describe("clossys compile", () => {
  it("prints its own usage and refuses unknown or valueless flags", async () => {
    await expect(runCli(["compile", "--help"])).resolves.toMatchObject({ exitCode: 0, message: COMPILE_USAGE });
    await expect(runCli(["compile", "--model", "x"])).resolves.toMatchObject({ exitCode: 2, message: expect.stringContaining("Unknown compile argument: --model") });
    await expect(runCli(["compile", "--out"])).resolves.toMatchObject({ exitCode: 2, message: expect.stringContaining("--out needs a directory") });
  });
});
