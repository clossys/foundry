import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { mainPublisherContent, PUBLISHER_CONTENT_USAGE } from "./index.js";

describe("Publisher Node CLI entry", () => {
  it("describes only the shipped agent commands", async () => {
    expect(await mainPublisherContent(["--help"])).toEqual({ exitCode: 0, findings: [], data: { usage: PUBLISHER_CONTENT_USAGE } });
  });
  it.each([
    [], ["deploy"], ["approve", "--force", "true"], ["release", "--skip-review", "true"],
    ["review", "--root", "one", "--root", "two"], ["review", "--root"],
    ["review", "--root", "one", "--designer", "two", "--catalog", "three", "--input", "four", "--at", "invalid"],
  ].map(argv => ({ argv })))("refuses unavailable commands, bypasses, repeated flags and invalid input $argv", async ({ argv }) => {
    const result = await mainPublisherContent(argv);
    expect(result).toMatchObject({ exitCode: 2, findings: [{ rule: "publisher-cli-input" }] });
    expect(result.data).toBeUndefined();
  });
  it("executes content/node.ts directly as a JSON CLI without a new bin", () => {
    const entry = new URL("../node.ts", import.meta.url);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { register } from 'node:module';
      import { fileURLToPath } from 'node:url';
      register('data:text/javascript,' + encodeURIComponent(
        "export async function resolve(specifier, context, next) {" +
        "if (context.parentURL?.includes('/publisher/src/') && (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) specifier = specifier.slice(0, -3) + '.ts';" +
        "return next(specifier, context); }"
      ));
      process.argv = [process.execPath, fileURLToPath(${JSON.stringify(entry.href)}), '--help'];
      await import(${JSON.stringify(entry.href)});
    `], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ exitCode: 0, findings: [], data: { usage: PUBLISHER_CONTENT_USAGE } });
  });
});
