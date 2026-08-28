import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./singular-authority-cli.js";

const roots: string[] = [];

afterEach(() => { while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true }); });

function invoke(packages: Record<string, unknown>, declarations: unknown): { readonly code: 0 | 1 | 2; readonly output: readonly string[] } {
  const root = mkdtempSync(join(tmpdir(), "singular-authority-cli-"));
  roots.push(root);
  const lockPath = join(root, "package-lock.json");
  const declarationsPath = join(root, "declarations.json");
  writeFileSync(lockPath, JSON.stringify({ lockfileVersion: 3, packages }));
  writeFileSync(declarationsPath, JSON.stringify(declarations));
  const output: string[] = [];
  return { code: main([lockPath, declarationsPath], (line) => output.push(line)), output };
}

const declaration = {
  declarations: [{ packageName: "@scope/controller", authority: "controller" }],
  target: { authority: "controller", version: "0.8.19" },
};

describe("singular-authority-check", () => {
  it("maps direct CLI convergence, required update, and indeterminacy to 0/1/2", () => {
    const converged = invoke({
      "": { devDependencies: { "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
    }, declaration);
    expect(converged.code).toBe(0);
    expect(converged.output[0]).toBe("controller: converged");
    const update = invoke({
      "": { dependencies: { "@scope/builder": "^0.7.0", "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/builder": { version: "0.7.1", dependencies: { "@scope/controller": "^0.7.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
    }, declaration);
    expect(update.code).toBe(1);
    expect(update.output[0]).toBe("controller: compatibility-update-required");
    const malformed = invoke({
      "": { devDependencies: { "@scope/controller": "^0.8.0" } },
    }, declaration);
    expect(malformed.code).toBe(2);
    expect(malformed.output[0]).toBe("controller: indeterminate");
    const undeclaredTarget = invoke({
      "": { devDependencies: { "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
    }, { ...declaration, target: { authority: "typo", version: "0.8.19" } });
    expect(undeclaredTarget.code).toBe(2);
    expect(undeclaredTarget.output[0]).toContain("target-undeclared:");
  });
});
