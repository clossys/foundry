import { describe, expect, it } from "vitest";
import { planNewPackage } from "./index.js";

describe("planNewPackage", () => {
  it("returns a reviewable, no-write package plan", () => {
    const plan = planNewPackage({ name: "@example/widgets", description: "Example widgets." });
    expect(plan.directory).toBe("packages/widgets");
    expect(plan.readiness).toBe("starter");
    expect(plan.requiredActions).not.toHaveLength(0);
    expect(plan.files.map((file) => file.path)).toEqual(["package.json", "src/index.ts", "README.md"]);
    expect(plan.files.find((file) => file.path === "package.json")?.content).toContain('"name": "@example/widgets"');
    expect(plan.files.find((file) => file.path === "package.json")?.content).toContain('"private": true');
    expect(plan.files.some((file) => file.path === "LICENSE" || file.path === "CHANGELOG.md")).toBe(false);
  });

  it("creates complete files only from a repository-owned profile", () => {
    const plan = planNewPackage({
      name: "@example/widgets",
      description: "Example widgets.",
      profile: {
        manifest: {
          private: false,
          author: "Example Maintainers",
          license: "MIT",
          repository: { type: "git", url: "https://example.test/widgets.git" },
          bugs: "https://example.test/widgets/issues",
          homepage: "https://example.test/widgets",
          engines: { node: ">=24" },
          scripts: { build: "tsc -p tsconfig.json", test: "vitest run" },
          devDependencies: { typescript: "~6.0.0", vitest: "^4.0.0" },
          publishConfig: { registry: "https://registry.example.test" },
          type: "module",
        },
        files: {
          tsconfig: '{ "compilerOptions": { "strict": true } }',
          testConfig: { path: "vitest.config.ts", content: "export default {};" },
          sourceIndex: "export const widgets = true;",
          sourceTest: "export {};",
          readme: "# Widgets",
          licenseText: "MIT License",
        },
        changelog: { date: "2026-08-11", initialEntry: "Initial release." },
      },
    });
    expect(plan.readiness).toBe("profiled");
    expect(plan.requiredActions).toEqual([]);
    expect(plan.files.map((file) => file.path)).toContain("LICENSE");
    expect(plan.files.find((file) => file.path === "CHANGELOG.md")?.content).toContain("2026-08-11");
    expect(plan.files.find((file) => file.path === "package.json")?.content).toContain('"publishConfig"');
  });

  it("rejects incomplete public profiles", () => {
    expect(() => planNewPackage({
      name: "@example/widgets",
      description: "Example.",
      profile: {
        manifest: {
          private: false,
          author: "Example",
          license: "MIT",
          repository: { type: "git", url: "https://example.test/widgets.git" },
          bugs: "https://example.test/widgets/issues",
          homepage: "https://example.test/widgets",
          engines: { node: ">=24" },
          scripts: { build: "build" },
          devDependencies: { typescript: "~6.0.0" },
        },
        files: {
          tsconfig: "{}",
          testConfig: { path: "vitest.config.ts", content: "export default {};" },
          sourceIndex: "export {};",
          sourceTest: "export {};",
          readme: "# Widgets",
          licenseText: "MIT License",
        },
        changelog: { date: "2026-08-11", initialEntry: "Initial release." },
      },
    })).toThrow("publishConfig");
  });

  it("rejects placeholder changelog dates in profiled plans", () => {
    const profile = {
      manifest: {
        private: true,
        author: "Example",
        license: "MIT",
        repository: { type: "git", url: "https://example.test/widgets.git" },
        bugs: "https://example.test/widgets/issues",
        homepage: "https://example.test/widgets",
        engines: { node: ">=24" },
        scripts: { build: "build" },
        devDependencies: { typescript: "~6.0.0" },
      },
      files: {
        tsconfig: "{}",
        testConfig: { path: "vitest.config.ts", content: "export default {};" },
        sourceIndex: "export {};",
        sourceTest: "export {};",
        readme: "# Widgets",
        licenseText: "MIT License",
      },
      changelog: { date: "YYYY-MM-DD", initialEntry: "Initial release." },
    };
    expect(() => planNewPackage({ name: "@example/widgets", description: "Example.", profile })).toThrow("YYYY-MM-DD");
  });

  it("rejects unsafe names, empty descriptions, and traversal", () => {
    expect(() => planNewPackage({ name: "widgets", description: "Example." })).toThrow("scoped npm package name");
    expect(() => planNewPackage({ name: "@example/widgets", description: " " })).toThrow("non-empty");
    expect(() => planNewPackage({ name: "@example/widgets", description: "Example.", directory: "../outside" })).toThrow("without traversal");
  });
});
