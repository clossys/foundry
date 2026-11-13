import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { reviewInput } from "./__fixtures__/review.js";

it("reviews through the public content barrel while every Node builtin is refused", () => {
  const target = new URL("../index.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { builtinModules, register } from 'node:module';
    register('data:text/javascript,' + encodeURIComponent(
      "const builtins = new Set(" + JSON.stringify(builtinModules) + ");" +
      "export async function resolve(specifier, context, next) {" +
      "if (specifier.startsWith('node:') || builtins.has(specifier)) throw new Error('Node builtin reached: ' + specifier);" +
      "if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) specifier = specifier.slice(0, -3) + '.ts';" +
      "return next(specifier, context); }"
    ));
    const content = await import(${JSON.stringify(target)});
    const report = content.reviewCandidate(${JSON.stringify(reviewInput())});
    if (report.findings.length || report.needs.length) throw new Error('Clean Review fixture failed');
    if ('computeContentDigest' in content) throw new Error('Node digest reached content barrel');
  `], { encoding: "utf8" });
  expect(result.stderr).toBe(""); expect(result.status).toBe(0);
});
