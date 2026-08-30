import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const document = readFileSync(resolve(packageRoot, "documents", "caller-workflow.md"), "utf8");
const npmWorkflow = document.slice(document.indexOf("### npm caller"), document.indexOf("### pnpm caller"));
const pnpmWorkflow = document.slice(document.indexOf("### pnpm caller"), document.indexOf("Set the protected-base request"));

describe("canonical caller workflow templates", () => {
  it("keeps the workflow-run decision blocking and treats missing pre-runtime facts as no verdict", () => {
    expect(document).toContain("The trusted job must begin for every conclusion.");
    expect(document).toContain("no Starter verdict and no invented `1` or `2` receipt");
    expect(document).toContain("github-token: ${{ github.token }}");
    expect(npmWorkflow).not.toMatch(/^\s*if:/m);
    expect(pnpmWorkflow).not.toMatch(/^\s*if:/m);
    expect(document).not.toContain("continue-on-error");
  });

  it("ships complete native templates with fixed direct Starter invocation", () => {
    for (const workflow of [npmWorkflow, pnpmWorkflow]) {
      expect(workflow).toContain("workflow_run:");
      expect(workflow).toContain("Fixed");
      expect(workflow).toContain("node node_modules/@clossys/starter/dist/cli.js decide");
      expect(workflow).toContain("exit \"$status\"");
    }
    expect(npmWorkflow).toContain("npm ci --ignore-scripts");
    expect(npmWorkflow).toContain('packageManager:"npm"');
    expect(pnpmWorkflow).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(pnpmWorkflow).toContain('packageManager:"pnpm"');
    expect(pnpmWorkflow).not.toContain("npm ci");
    expect(pnpmWorkflow).not.toContain("package-lock.json");
    expect(document).not.toContain("PACKAGES_READ_TOKEN");
    expect(document).not.toContain("NODE_AUTH_TOKEN");
  });
});
