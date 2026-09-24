import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const document = readFileSync(resolve(packageRoot, "documents", "caller-workflow.md"), "utf8");
const npmWorkflow = document.slice(document.indexOf("### npm caller"), document.indexOf("### pnpm caller"));
const pnpmWorkflow = document.slice(document.indexOf("### pnpm caller"), document.indexOf("Set the protected-base request"));
const headSection = document.slice(document.indexOf("## Proving the pull-request head's install"), document.indexOf("## Required result behaviour"));
const headJob = headSection.slice(headSection.indexOf("```yaml"), headSection.indexOf("```", headSection.indexOf("```yaml") + 7));

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

  it("states the one-merge lag and what each proof covers (issue #1474)", () => {
    expect(document).toContain("proved by the decision job only on the\nnext pull request after it merges");
    expect(document).toContain("so their behaviour still lags one merge");
    expect(headSection).toContain("It does not cover:");
  });

  it("proves the head install from the base-pinned Starter, reading three head files as data", () => {
    expect(headJob).toContain("prove-head-install:");
    expect(headJob).toContain("ref: ${{ github.event.workflow_run.pull_requests[0].base.sha }}");
    expect(headJob).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(headJob).toContain("path: .starter-head");
    expect(headJob).toContain("sparse-checkout-cone-mode: false");
    for (const path of ["/package.json", "/package-lock.json", "/.starter/request.json"]) expect(headJob).toContain(path);
    expect(headJob.match(/persist-credentials: false/g)).toHaveLength(2);
    expect(headJob).toContain("node node_modules/@clossys/starter/dist/cli.js prove-head");
    expect(headJob).toContain("exit \"$status\"");
    expect(headJob).not.toMatch(/^\s*if:/m);
    expect(headJob).not.toContain("actions: read");
    // The head checkout comes after the base install, so nothing from the head
    // is present while npm installs the Starter that runs.
    expect(headJob.indexOf("npm ci --ignore-scripts")).toBeLessThan(headJob.indexOf("head_sha"));
    expect(headJob).not.toContain("pnpm");
  });
});
