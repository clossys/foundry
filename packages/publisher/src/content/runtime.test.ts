import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Exercise this checkout's source, including focused runs without a package build.
describe("content runtime boundaries", () => {
  it("loads the public structural barrel with every Node built-in refused", () => {
    const target = new URL("./index.ts", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { register } from 'node:module';
      register('data:text/javascript,' + encodeURIComponent(
        "export async function resolve(specifier, context, next) {" +
        "if (specifier.startsWith('node:')) throw new Error('Node builtin reached: ' + specifier);" +
        "if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) specifier = specifier.slice(0, -3) + '.ts';" +
        "return next(specifier, context); }"
      ));
      const content = await import(${JSON.stringify(target)});
      if (typeof content.validateContentRegistry !== 'function') throw new Error('Missing validator');
      if (typeof content.checkContentLibraryReferences !== 'function') throw new Error('Missing library check');
      if ('computeContentDigest' in content) throw new Error('Digest leaked into structural barrel');
      if ('checkContentApproval' in content) throw new Error('Approval leaked into structural barrel');
    `], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
