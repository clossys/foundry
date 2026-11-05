import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import * as review from "./index.js";
import { validateReviewEvidence } from "./pure.js";

const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

describe("review runtime entry boundaries", () => {
  it("retains pure validation while the review namespace excludes CLI adapters", () => {
    expect(review.validateReviewEvidence).toBe(validateReviewEvidence);
    expect(review).not.toHaveProperty("main");
    expect(review).not.toHaveProperty("run");
    expect(review).not.toHaveProperty("CliInputError");
  });

  it("exposes the CLI to Node and refuses browser resolution", async () => {
    const specifier = `${manifest.name}/review/cli`;
    const cli = await import(/* @vite-ignore */ specifier);
    expect(typeof cli.main).toBe("function");
    expect(typeof cli.run).toBe("function");
    expect(cli.main(["--unknown"])).toBe(2);
    await expect(build({ stdin: { contents: `import * as cli from ${JSON.stringify(specifier)}; console.log(cli);`, resolveDir: process.cwd() },
      bundle: true, platform: "browser", write: false, logLevel: "silent" })).rejects.toThrow(/Could not resolve/);
  });
});
