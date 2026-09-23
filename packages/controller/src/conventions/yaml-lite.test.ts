import { describe, expect, it } from "vitest";
import { YamlLiteParseError, parseYamlLite } from "./yaml-lite.js";

describe("parseYamlLite", () => {
  it("parses a flat mapping of scalars", () => {
    expect(parseYamlLite("name: CI\nversion: 2\nenabled: true\nempty:\nnullish: ~\n")).toEqual({
      name: "CI",
      version: 2,
      enabled: true,
      empty: null,
      nullish: null,
    });
  });

  it("parses nested mappings by indentation", () => {
    expect(parseYamlLite("permissions:\n  contents: read\n  issues: write\n")).toEqual({
      permissions: { contents: "read", issues: "write" },
    });
  });

  it("parses a block sequence of scalars", () => {
    expect(parseYamlLite("labels:\n  - a\n  - b\n  - c\n")).toEqual({ labels: ["a", "b", "c"] });
  });

  it("parses a block sequence of mappings, including multi-key entries", () => {
    const doc = ["steps:", "  - uses: actions/checkout@sha", "    with:", "      fetch-depth: 0", "  - run: echo hi"].join(
      "\n",
    );
    expect(parseYamlLite(doc)).toEqual({
      steps: [{ uses: "actions/checkout@sha", with: { "fetch-depth": 0 } }, { run: "echo hi" }],
    });
  });

  it("parses flow sequences and flow mappings, including quoted commas", () => {
    expect(parseYamlLite('branches: [main, "release, candidate"]')).toEqual({
      branches: ["main", "release, candidate"],
    });
    expect(parseYamlLite("group: {a: 1, b: 2}")).toEqual({ group: { a: 1, b: 2 } });
  });

  it("parses single- and double-quoted scalars, unescaping doubled single quotes", () => {
    expect(parseYamlLite(`a: "hi \\"there\\""\nb: 'it''s fine'\n`)).toEqual({
      a: 'hi "there"',
      b: "it's fine",
    });
  });

  it("parses a literal block scalar, preserving internal newlines and stripping the indent", () => {
    const doc = ["run: |", "  set +e", "  node script.mjs", "  status=$?", "  set -e", "after: true"].join("\n");
    const parsed = parseYamlLite(doc) as Record<string, unknown>;
    expect(parsed.run).toBe("set +e\nnode script.mjs\nstatus=$?\nset -e\n");
    expect(parsed.after).toBe(true);
  });

  it("strips a literal block scalar's trailing newline with the '-' chomping indicator", () => {
    const doc = ["run: |-", "  one", "  two"].join("\n");
    expect((parseYamlLite(doc) as Record<string, unknown>).run).toBe("one\ntwo");
  });

  it("ignores comments and blank lines", () => {
    const doc = ["# top comment", "name: CI # trailing", "", "jobs:", "  build: {}", ""].join("\n");
    expect(parseYamlLite(doc)).toEqual({ name: "CI", jobs: { build: {} } });
  });

  it("does not treat a '#' inside a quoted string as a comment", () => {
    expect(parseYamlLite('msg: "a #b"')).toEqual({ msg: "a #b" });
  });

  it("parses a realistic workflow fragment end to end", () => {
    const doc = [
      "name: CI",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches: [main]",
      "permissions:",
      "  contents: read",
      "concurrency:",
      "  group: ci-${{ github.ref }}",
      "  cancel-in-progress: true",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 10",
      "    needs: [safety, scope]",
      "    if: always()",
      "    steps:",
      "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
      "      - name: Build",
      "        run: |",
      "          npm run build",
    ].join("\n");

    expect(parseYamlLite(doc)).toEqual({
      name: "CI",
      on: { pull_request: null, push: { branches: ["main"] } },
      permissions: { contents: "read" },
      concurrency: { group: "ci-${{ github.ref }}", "cancel-in-progress": true },
      jobs: {
        build: {
          "runs-on": "ubuntu-latest",
          "timeout-minutes": 10,
          needs: ["safety", "scope"],
          if: "always()",
          steps: [
            { uses: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262" },
            { name: "Build", run: "npm run build\n" },
          ],
        },
      },
    });
  });

  it("returns null for an empty document", () => {
    expect(parseYamlLite("")).toBeNull();
    expect(parseYamlLite("\n\n  \n")).toBeNull();
  });

  it("throws YamlLiteParseError, naming the line, on a line that is neither a mapping entry nor a sequence item", () => {
    expect(() => parseYamlLite("jobs:\n  build:\n    not a mapping entry at all\n")).toThrow(YamlLiteParseError);
    try {
      parseYamlLite("a: 1\nnot valid\n");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(YamlLiteParseError);
      expect((error as YamlLiteParseError).message).toContain("line 2");
    }
  });
});
