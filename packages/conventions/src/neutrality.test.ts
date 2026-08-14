import { describe, expect, it } from "vitest";
import { scanNeutrality } from "./neutrality.js";

describe("scanNeutrality", () => {
  it("passes content that names no path and no plane-owned name", () => {
    expect(scanNeutrality("Every agent branch states its creating agent.")).toEqual([]);
  });

  it("reports an absolute path", () => {
    const findings = scanNeutrality("Read /etc/hosts before starting.");
    expect(findings.map((f) => f.rule)).toContain("neutrality/absolute-path");
  });

  it("reports a named directory in an operator's home", () => {
    const findings = scanNeutrality("Defaults to ~/code when unset.");
    expect(findings.map((f) => f.rule)).toContain("neutrality/named-home-directory");
  });

  it("permits a product's own dot-directory in a home", () => {
    expect(scanNeutrality("Product mechanics belong in ~/.codex and ~/.claude.")).toEqual([]);
  });

  // The regression that motivated widening the lookbehind. Templating is the
  // fix for a hardcoded default; a scan that reported the fix as a violation
  // would push authors back toward the thing it exists to remove.
  it("does not read a segment after a template token as an absolute path", () => {
    expect(scanNeutrality("Treat ${WORKSPACE_ROOT}/personal as private.")).toEqual([]);
  });

  it("does not read a segment after a prose placeholder as an absolute path", () => {
    expect(scanNeutrality("Worktrees live under <repository>/.claude/worktrees/<slug>.")).toEqual([]);
  });

  it("exempts a shebang but not an absolute path in the script body", () => {
    expect(scanNeutrality("#!/usr/bin/env bash\necho hello\n")).toEqual([]);
    const findings = scanNeutrality("#!/usr/bin/env bash\nexec /opt/somewhere/bin/tool\n");
    expect(findings.map((f) => f.rule)).toContain("neutrality/absolute-path");
  });

  it("permits relative references, versions, and URL schemes", () => {
    expect(scanNeutrality("See config/settings.json, v1.2/3, and https://example.invalid/x")).toEqual([]);
  });

  it("reports a plane-owned name regardless of capitalization", () => {
    const findings = scanNeutrality("Owned by ExampleAccount.", {
      forbiddenNames: ["exampleaccount"],
    });
    expect(findings.map((f) => f.rule)).toContain("neutrality/plane-owned-name");
  });

  it("matches a forbidden name only on a word boundary", () => {
    expect(scanNeutrality("The unexampleaccounted case.", { forbiddenNames: ["exampleaccount"] })).toEqual([]);
  });

  it("permits template tokens by default and reports them when scanning expanded content", () => {
    expect(scanNeutrality("Resolves to ${WORKSPACE_ROOT}.")).toEqual([]);
    const findings = scanNeutrality("Resolves to ${WORKSPACE_ROOT}.", { allowTemplateTokens: false });
    expect(findings.map((f) => f.rule)).toContain("neutrality/template-token");
  });
});
