import { describe, expect, it } from "vitest";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { editReleaseAgeExemption, verifyReleaseAgeExemption } from "./release-age-edit.js";
import type { ExemptionSurfaceKind } from "./change-set-contract.js";

/*
 * Issue #1178. Adding the publishing scope to a repository's release-age
 * exemption file (code rule C12) by editing one YAML list in place: only the
 * one scope entry is added under the surface's key, every other byte is kept,
 * and any shape the restricted reader does not fully recognise is refused.
 * Golden bytes here are literal, never computed by the module.
 */
const SCOPE = PACKAGE_SCOPE.scope;
const VALUE = `${SCOPE}/*`;
const UNPARSEABLE = { kind: "refused", reason: "release-age-surface-unparseable" };
const CONFLICT = { kind: "refused", reason: "release-age-surface-conflict" };

interface Surface {
  readonly surface: ExemptionSurfaceKind;
  readonly key: string;
  /** How an inserted entry is quoted on this surface. */
  readonly q: string;
  /** The other quoting, which an edit must never produce. */
  readonly wrongQ: string;
}
const SURFACES: readonly Surface[] = [
  { surface: "pnpm-workspace", key: "minimumReleaseAgeExclude", q: `'${VALUE}'`, wrongQ: `"${VALUE}"` },
  { surface: "yarnrc", key: "npmPreapprovedPackages", q: `"${VALUE}"`, wrongQ: `'${VALUE}'` },
];

function edit(surface: ExemptionSurfaceKind, text: string | null, npmrc?: string | null) {
  return editReleaseAgeExemption(npmrc === undefined ? { surface, text } : { surface, text, npmrc });
}
function verify(surface: ExemptionSurfaceKind, before: string | null, after: string, npmrc?: string | null) {
  return verifyReleaseAgeExemption(npmrc === undefined ? { surface, before, after } : { surface, before, after, npmrc });
}

interface Case {
  readonly name: string;
  readonly before: string | null;
  readonly after: string;
}
/** Every create, insert and append golden case for one surface. */
function goldenCases({ key: k, q }: Surface): readonly Case[] {
  return [
    { name: "create from null", before: null, after: `${k}:\n  - ${q}\n` },
    { name: "create from the empty string", before: "", after: `${k}:\n  - ${q}\n` },
    {
      name: "insert at indent 2 among other keys, comments and a blank line",
      before: `# header comment\npackages:\n  - 'apps/*'\n\n${k}:\n  - foo\n  - "bar"\n# comment right after the list\n\nnodeLinker: node-modules\n`,
      after: `# header comment\npackages:\n  - 'apps/*'\n\n${k}:\n  - foo\n  - "bar"\n  - ${q}\n# comment right after the list\n\nnodeLinker: node-modules\n`,
    },
    { name: "insert at indent 0 (non-indented list)", before: `${k}:\n- a\n- b\nother: 1\n`, after: `${k}:\n- a\n- b\n- ${q}\nother: 1\n` },
    { name: "insert at indent 4", before: `top: 1\n${k}:\n    - a\n    - b\n`, after: `top: 1\n${k}:\n    - a\n    - b\n    - ${q}\n` },
    { name: "insert with no final newline, adding none", before: `top: 1\n${k}:\n  - a`, after: `top: 1\n${k}:\n  - a\n  - ${q}` },
    { name: "insert before trailing blank and comment lines with no final newline", before: `${k}:\n  - a\n\n# end`, after: `${k}:\n  - a\n  - ${q}\n\n# end` },
    { name: "insert under a double-quoted key", before: `"${k}":\n  - a\n`, after: `"${k}":\n  - a\n  - ${q}\n` },
    { name: "insert under a single-quoted key", before: `'${k}':\n  - a\n`, after: `'${k}':\n  - a\n  - ${q}\n` },
    { name: "insert after the last of several items, ahead of a following key", before: `${k}:\n  - 'a b'\n  - c-d\nz: 1`, after: `${k}:\n  - 'a b'\n  - c-d\n  - ${q}\nz: 1` },
    { name: "append the key to a file with a final newline", before: "a: 1\n", after: `a: 1\n${k}:\n  - ${q}\n` },
    { name: "append the key to a file with no final newline", before: "a: 1", after: `a: 1\n${k}:\n  - ${q}` },
    { name: "append the key to a comment-only file", before: "# only a comment\n", after: `# only a comment\n${k}:\n  - ${q}\n` },
    { name: "append the key to a comment-only file with no final newline", before: "# only a comment", after: `# only a comment\n${k}:\n  - ${q}` },
    { name: "append the key after a nested map and a blank line", before: "a:\n  b:\n    c: 1\n\n", after: `a:\n  b:\n    c: 1\n\n${k}:\n  - ${q}\n` },
  ];
}

describe.each(SURFACES)("editReleaseAgeExemption ($surface)", (s) => {
  const { surface, key: k, q } = s;

  it("gives the quoted entry its own value, scoped to the publishing scope", () => {
    expect(VALUE).toBe("@clossys/*");
    expect(edit(surface, null)).toEqual({ kind: "edited", text: `${k}:\n  - ${q}\n` });
  });

  it.each(goldenCases(s))("$name", ({ before, after }) => {
    expect(edit(surface, before)).toEqual({ kind: "edited", text: after });
  });

  it("never inserts the other surface's quoting", () => {
    const result = edit(surface, `${k}:\n  - a\n`);
    expect(result.kind === "edited" && result.text.includes(s.wrongQ)).toBe(false);
  });

  it.each([
    ["single-quoted", `'${VALUE}'`],
    ["double-quoted", `"${VALUE}"`],
  ])("reports an already-present %s entry as unchanged", (_name, entry) => {
    expect(edit(surface, `${k}:\n  - ${entry}\n`)).toEqual({ kind: "unchanged" });
  });

  it("reports an entry present in the middle of a list as unchanged", () => {
    expect(edit(surface, `a: 1\n${k}:\n  - x\n  - '${VALUE}'\n  - y\n# c\nb: 2\n`)).toEqual({ kind: "unchanged" });
  });

  it("reports an entry in a non-indented list as unchanged", () => {
    expect(edit(surface, `${k}:\n- "${VALUE}"\n- y\n`)).toEqual({ kind: "unchanged" });
  });

  it("does not take a scope-like entry for the scope entry", () => {
    const text = `${k}:\n  - '${SCOPE}/foo'\n  - '${SCOPE}*'\n`;
    expect(edit(surface, text)).toEqual({ kind: "edited", text: `${k}:\n  - '${SCOPE}/foo'\n  - '${SCOPE}*'\n  - ${q}\n` });
  });

  it("keeps every other byte of a realistic workspace file", () => {
    const before = [
      "# Workspace layout -- keep this comment",
      "packages:",
      "  - 'apps/*'",
      '  - "packages/*"',
      "",
      "catalog:",
      "  react: ^19.0.0",
      "  '@types/node': ^22.0.0   # pinned on purpose",
      "",
      "overrides:",
      "  foo>bar: 1.2.3",
      "  nested:",
      "    deep: value",
      "    list:",
      "      - one",
      "",
      "# release-age exemptions",
      `${k}:`,
      "  - lodash",
      "  - 'left-pad'",
      "",
      "# keep this exact",
      "onlyBuiltDependencies:",
      "  - esbuild",
      "",
    ].join("\n");
    const after = [
      "# Workspace layout -- keep this comment",
      "packages:",
      "  - 'apps/*'",
      '  - "packages/*"',
      "",
      "catalog:",
      "  react: ^19.0.0",
      "  '@types/node': ^22.0.0   # pinned on purpose",
      "",
      "overrides:",
      "  foo>bar: 1.2.3",
      "  nested:",
      "    deep: value",
      "    list:",
      "      - one",
      "",
      "# release-age exemptions",
      `${k}:`,
      "  - lodash",
      "  - 'left-pad'",
      `  - ${q}`,
      "",
      "# keep this exact",
      "onlyBuiltDependencies:",
      "  - esbuild",
      "",
    ].join("\n");
    expect(edit(surface, before)).toEqual({ kind: "edited", text: after });
    expect(verify(surface, before, after)).toEqual({ verified: true, value: VALUE });
  });

  it("does not refuse ordinary constructs elsewhere in the file", () => {
    const before = `a: "x # y"\nb: don't\nlist:\n- one\n- two\nc:\n  nested:\n    - x\n  url: https://example.test/p?a=1&b=2\n`;
    expect(edit(surface, before)).toEqual({ kind: "edited", text: `${before}${k}:\n  - ${q}\n` });
  });

  describe("refuses a shape it does not fully recognise", () => {
    const refusals: ReadonlyArray<readonly [string, string]> = [
      ["flow sequence with an item", `${k}: ['a']\n`],
      ["empty flow sequence", `${k}: []\n`],
      ["flow sequence, plain item", `${k}: [a]\n`],
      ["inline scalar value", `${k}: a\n`],
      ["inline null", `${k}: ~\n`],
      ["anchored flow sequence", `${k}: &x [a]\n`],
      ["alias value", `${k}: *x\n`],
      ["anchor on a target item", `${k}:\n  - &a foo\n`],
      ["alias as a target item", `${k}:\n  - *a\n`],
      ["tag on a target item", `${k}:\n  - !!str foo\n`],
      ["anchor elsewhere in the file", `x: &a 1\n${k}:\n  - a\n`],
      ["alias elsewhere in the file", `x: *a\n${k}:\n  - a\n`],
      ["tag elsewhere in the file", `x: !!str y\n${k}:\n  - a\n`],
      ["tag on a nested item elsewhere", `x:\n  - !t a\n`],
      ["anchor in a file that lacks the key", `x: &a 1\ny: 2\n`],
      ["merge key with an alias", `x: 1\n<<: *a\n`],
      ["anchor inside a flow collection", `x: [&a b]\n`],
      ["comment before the first item", `${k}:\n  # c\n  - a\n`],
      ["comment between items", `${k}:\n  - a\n  # c\n  - b\n`],
      ["trailing comment on an item", `${k}:\n  - a # c\n`],
      ["trailing comment on a quoted item", `${k}:\n  - 'a' # c\n`],
      ["trailing comment on the key line", `${k}: # c\n  - a\n`],
      ["trailing space on the key line", `${k}: \n  - a\n`],
      ["blank line between items", `${k}:\n  - a\n\n  - b\n`],
      ["blank line before the first item", `${k}:\n\n  - a\n`],
      ["blank line then an item after the list", `${k}:\n  - a\n\n- b\n`],
      ["document start after content", "a: 1\n---\nb: 2\n"],
      ["document start at the top", "---\na: 1\n"],
      ["document end marker", "a: 1\n...\n"],
      ["document start with trailing text", "a: 1\n--- x\n"],
      ["tab indentation", "a:\n\t- b\n"],
      ["tab inside a value", "a: b\tc\n"],
      ["CRLF line endings", `a: 1\r\n${k}:\r\n  - a\r\n`],
      ["bare CR", "a: 1\rb: 2"],
      ["byte order mark", "\uFEFFa: 1\n"],
      ["byte order mark mid-file", "a: 1\n\uFEFFb: 2\n"],
      ["next-line character", "a: b\u0085c\n"],
      ["line separator", "a: b\u2028c\n"],
      ["paragraph separator", "a: b\u2029c\n"],
      ["control character", "a: b\u0001c\n"],
      ["delete character", "a: b\u007fc\n"],
      ["repeated target key", `${k}:\n  - a\n${k}:\n  - b\n`],
      ["repeated target key, one quoted", `${k}:\n  - a\n"${k}":\n  - b\n`],
      ["repeated other key", "a: 1\na: 2\n"],
      ["repeated other key, one quoted", "a: 1\n'a': 2\n"],
      ["target key with no body", `x: 1\n${k}:\n`],
      ["target key with no body at the end of a file with no final newline", `x: 1\n${k}:`],
      ["target key followed directly by another key", `${k}:\nx: 1\n`],
      ["mapping body", `${k}:\n  a: b\n`],
      ["nested sequence item", `${k}:\n  - - a\n`],
      ["deeper item after the list", `${k}:\n  - a\n    - b\n`],
      ["item with a different indent", `${k}:\n  - a\n   - b\n`],
      ["non-indented item after an indented list", `${k}:\n  - a\n- b\n`],
      ["item with two spaces after the dash", `${k}:\n  -  a\n`],
      ["item that is a bare dash", `${k}:\n  -\n`],
      ["item with an empty scalar", `${k}:\n  - \n`],
      ["item with trailing whitespace", `${k}:\n  - a \n`],
      ["block scalar as the target value", `${k}: |\n  a\n`],
      ["block scalar elsewhere", "x: >\n  a\n"],
      ["block scalar as a target item", `${k}:\n  - |\n    a\n`],
      ["block scalar with a chomping indicator", "x: |-\n  a\n"],
      ["directive", "%YAML 1.2\na: 1\n"],
      ["directive before a document start", "%TAG ! x\n---\na: 1\n"],
      ["root sequence", "- a\n- b\n"],
      ["root scalar", "hello\n"],
      ["root flow mapping", "{a: 1}\n"],
      ["indented line before any key", "  a: 1\n"],
      ["sequence after an inline-valued key", "a: 1\n- b\n"],
      ["sequence after a mapping body", "a:\n  b: 1\n- c\n"],
      ["explicit key", "? a\n: b\n"],
      ["indented comment after the last item", `${k}:\n  - a\n  # c\n`],
      ["indented blank-looking comment after the last item", `${k}:\n  - a\n  #\n`],
      ["backslash in a double-quoted item", `${k}:\n  - "a\\nb"\n`],
      ["backslash in a double-quoted value elsewhere", 'x: "a\\tb"\n'],
      ["plain item containing a colon and a space", `${k}:\n  - a: b\n`],
      ["plain item ending in a colon", `${k}:\n  - a:\n`],
      ["plain item containing a space and a hash", `${k}:\n  - a #b\n`],
      ["plain item starting with @", `${k}:\n  - @scope/*\n`],
      ["plain item starting with a flow indicator", `${k}:\n  - [a]\n`],
      ["plain item starting with a percent", `${k}:\n  - %a\n`],
      ["plain item starting with a backtick", `${k}:\n  - \`a\n`],
      ["quoted item followed by text", `${k}:\n  - 'a' b\n`],
      ["double-quoted item followed by text", `${k}:\n  - "a" b\n`],
      ["unterminated single-quoted item", `${k}:\n  - 'abc\n`],
      ["multi-line double-quoted scalar elsewhere", 'x: "abc\n  def"\n'],
      ["multi-line single-quoted scalar elsewhere", "x: 'abc\n  def'\n"],
      ["multi-line flow collection at column 0", "x: [a,\nb]\n"],
      ["key with a nested-quote weirdness", "'a\"b': 1\n"],
      ["column-0 line that is a plain word after a key", "a: 1\nb\n"],
    ];
    it.each(refusals)("%s", (_name, text) => {
      expect(edit(surface, text)).toEqual(UNPARSEABLE);
    });
  });
});

describe("editReleaseAgeExemption: the .npmrc conflict", () => {
  const key = "minimumReleaseAgeExclude";
  const conflicts: ReadonlyArray<readonly [string, string]> = [
    ["plain", "minimum-release-age-exclude=foo\n"],
    ["spaces around =", "  minimum-release-age-exclude  =  foo\n"],
    ["underscore spelling", "minimum_release_age_exclude=foo\n"],
    ["upper-case spelling", "Minimum-Release-Age-Exclude=foo\n"],
    ["leading byte order mark", "\uFEFFminimum-release-age-exclude=foo\n"],
    ["CRLF endings", "a=1\r\nminimum-release-age-exclude=foo\r\n"],
    ["bare CR endings", "a=1\rminimum-release-age-exclude=foo"],
    ["after other lines and comments", "; c\n# c\nregistry=https://example.test\n\nminimum-release-age-exclude=x"],
  ];

  it.each(conflicts)("refuses on a conflicting .npmrc: %s", (_name, npmrc) => {
    expect(edit("pnpm-workspace", `${key}:\n  - a\n`, npmrc)).toEqual(CONFLICT);
  });

  it("refuses on a conflicting .npmrc even when the workspace file is absent", () => {
    expect(edit("pnpm-workspace", null, "minimum-release-age-exclude=foo\n")).toEqual(CONFLICT);
  });

  it("judges the conflict before reading the workspace file", () => {
    expect(edit("pnpm-workspace", "a: &x 1\n", "minimum-release-age-exclude=foo\n")).toEqual(CONFLICT);
  });

  it.each([
    ["no .npmrc", null],
    ["an empty .npmrc", ""],
    ["a commented-out line", "; minimum-release-age-exclude=foo\n# minimum-release-age-exclude=foo\n"],
    ["a different key", "minimum-release-age=1440\n"],
    ["a longer key", "minimum-release-age-exclude-more=foo\n"],
    ["the name only in a value", "other=minimum-release-age-exclude\n"],
  ])("does not conflict with %s", (_name, npmrc) => {
    expect(edit("pnpm-workspace", null, npmrc)).toEqual({ kind: "edited", text: `${key}:\n  - '${VALUE}'\n` });
  });

  it("is ignored by the yarnrc surface", () => {
    expect(edit("yarnrc", null, "minimum-release-age-exclude=foo\n")).toEqual({ kind: "edited", text: `npmPreapprovedPackages:\n  - "${VALUE}"\n` });
  });
});

describe.each(SURFACES)("verifyReleaseAgeExemption ($surface)", (s) => {
  const { surface, key: k, q } = s;
  const before = `a: 1\n# note\n${k}:\n  - x\n  - y\nb: 2\n`;
  const good = `a: 1\n# note\n${k}:\n  - x\n  - y\n  - ${q}\nb: 2\n`;
  const ok = { verified: true, value: VALUE };
  const no = { verified: false };

  it.each(goldenCases(s))("verifies the edit's own output: $name", ({ before: b, after }) => {
    expect(verify(surface, b, after)).toEqual(ok);
  });

  it("reports the ledger value", () => {
    const verdict = verify(surface, before, good);
    expect(verdict).toEqual(ok);
    expect(verdict.verified && verdict.value).toBe(`${PACKAGE_SCOPE.scope}/*`);
  });

  it.each([
    ["two added entries", `a: 1\n# note\n${k}:\n  - x\n  - y\n  - ${q}\n  - 'more'\nb: 2\n`],
    ["the scope entry added twice", `a: 1\n# note\n${k}:\n  - x\n  - y\n  - ${q}\n  - ${q}\nb: 2\n`],
    ["a reordered list", `a: 1\n# note\n${k}:\n  - y\n  - x\n  - ${q}\nb: 2\n`],
    ["a removed existing entry", `a: 1\n# note\n${k}:\n  - x\n  - ${q}\nb: 2\n`],
    ["an existing entry replaced", `a: 1\n# note\n${k}:\n  - x\n  - z\n  - ${q}\nb: 2\n`],
    ["the entry added at the start", `a: 1\n# note\n${k}:\n  - ${q}\n  - x\n  - y\nb: 2\n`],
    ["the entry added in the middle", `a: 1\n# note\n${k}:\n  - x\n  - ${q}\n  - y\nb: 2\n`],
    ["a changed comment", `a: 1\n# NOTE\n${k}:\n  - x\n  - y\n  - ${q}\nb: 2\n`],
    ["a changed other key", `a: 2\n# note\n${k}:\n  - x\n  - y\n  - ${q}\nb: 2\n`],
    ["a dropped final newline", `a: 1\n# note\n${k}:\n  - x\n  - y\n  - ${q}\nb: 2`],
    ["an added blank line", `a: 1\n# note\n${k}:\n  - x\n  - y\n  - ${q}\n\nb: 2\n`],
    ["an extra final newline", `${good}\n`],
    ["wrong quoting for the surface", `a: 1\n# note\n${k}:\n  - x\n  - y\n  - ${s.wrongQ}\nb: 2\n`],
    ["a plain entry", `a: 1\n# note\n${k}:\n  - x\n  - y\n  - ${VALUE}\nb: 2\n`],
    ["the wrong indent for the list", `a: 1\n# note\n${k}:\n  - x\n  - y\n    - ${q}\nb: 2\n`],
    ["two spaces after the dash", `a: 1\n# note\n${k}:\n  - x\n  - y\n  -  ${q}\nb: 2\n`],
    ["the entry under a different key", `a: 1\n# note\n${k}:\n  - x\n  - y\nb: 2\nother:\n  - ${q}\n`],
    ["an after that does not parse", `a: 1\n# note\n${k}: [x, y, ${q}]\nb: 2\n`],
    ["an after with a tab", `a: 1\n# note\n${k}:\n  - x\n  - y\n  - ${q}\nb:\t2\n`],
    ["an after with CRLF endings", good.replace(/\n/g, "\r\n")],
    ["a foreign entry instead of the scope entry", `a: 1\n# note\n${k}:\n  - x\n  - y\n  - 'other'\nb: 2\n`],
    ["an unchanged file", before],
  ])("is false for %s", (_name, after) => {
    expect(verify(surface, before, after)).toEqual(no);
  });

  it("is false when the scope entry was already there", () => {
    const already = `${k}:\n  - ${q}\n`;
    expect(verify(surface, already, `${k}:\n  - ${q}\n  - ${q}\n`)).toEqual(no);
    expect(verify(surface, already, already)).toEqual(no);
  });

  it("is false when the before text does not parse", () => {
    expect(verify(surface, `x: &a 1\n${k}:\n  - x\n`, `x: &a 1\n${k}:\n  - x\n  - ${q}\n`)).toEqual(no);
  });

  it("is false for a wrongly shaped create from null", () => {
    expect(verify(surface, null, `${k}:\n  - ${q}`)).toEqual(no);
    expect(verify(surface, null, `${k}:\n    - ${q}\n`)).toEqual(no);
    expect(verify(surface, null, `${k}:\n  - ${q}\nother: 1\n`)).toEqual(no);
    expect(verify(surface, null, `${k}:\n  - ${q}\n  - 'x'\n`)).toEqual(no);
    expect(verify(surface, null, `# c\n${k}:\n  - ${q}\n`)).toEqual(no);
    expect(verify(surface, null, "")).toEqual(no);
  });

  it("is false for a wrongly shaped key append", () => {
    expect(verify(surface, "a: 1\n", `a: 1\n${k}:\n    - ${q}\n`)).toEqual(no);
    expect(verify(surface, "a: 1\n", `a: 1\n\n${k}:\n  - ${q}\n`)).toEqual(no);
    expect(verify(surface, "a: 1", `a: 1\n${k}:\n  - ${q}\n`)).toEqual(no);
    expect(verify(surface, "a: 1\n", `a: 1\n${k}:\n  - ${q}`)).toEqual(no);
    expect(verify(surface, "a: 1\n", `${k}:\n  - ${q}\na: 1\n`)).toEqual(no);
    expect(verify(surface, "a: 1\n", `a: 2\n${k}:\n  - ${q}\n`)).toEqual(no);
  });

  it("is false for a mixed-up quoting on a key append", () => {
    expect(verify(surface, "a: 1\n", `a: 1\n${k}:\n  - ${s.wrongQ}\n`)).toEqual(no);
  });
});

describe("editReleaseAgeExemption: the .npmrc fixed safe grammar", () => {
  // An .npmrc is accepted only when every line is blank, a comment, or a plain
  // `key=value` whose key is ASCII letters, digits and `@ : _ . / -`. Any other
  // line shape refuses the whole file as unparseable; a plain key that reads
  // as the exclusion list, in any case and with `-` and `_` ignored, is a
  // conflict. Each spelling below is one npm's ini reader reads as the key.
  const key = "minimumReleaseAgeExclude";
  const K = "minimum-release-age-exclude";
  const refused: ReadonlyArray<readonly [string, string, typeof CONFLICT]> = [
    ["a double-quoted key", `"${K}"=@a/*\n`, UNPARSEABLE],
    ["a single-quoted key", `'${K}'=@a/*\n`, UNPARSEABLE],
    ["a quoted key with an array suffix", `"${K}[]"=@a/*\n`, UNPARSEABLE],
    ["a comment after the key before the equals sign", `${K};c=@a/*\n`, UNPARSEABLE],
    ["a hash comment after the key before the equals sign", `${K} #c=@a/*\n`, UNPARSEABLE],
    ["a JSON escape inside a quoted key", `"minimum-release-age-exclud\\u0065"=@a/*\n`, UNPARSEABLE],
    ["the camel-case spelling", `${key}=@a/*\n`, CONFLICT],
    ["the camel-case spelling in other case", `MINIMUMRELEASEAGEEXCLUDE=@a/*\n`, CONFLICT],
    ["an array suffix", `${K}[]=x\n`, UNPARSEABLE],
    ["a key with no equals sign", `${K}\n`, UNPARSEABLE],
    ["a key with no equals sign after a comment", `; c\n${K}`, UNPARSEABLE],
    ["a section header", `[a]\n${K}=x\n`, UNPARSEABLE],
    ["a tab around the key", `\t${K}=x\n`, UNPARSEABLE],
    ["an unrelated line that is not a plain assignment", `registry\n`, UNPARSEABLE],
    ["an unrelated quoted key", `"registry"=https://example.com/\n`, UNPARSEABLE],
    ["a backslash in an unrelated key", `reg\\istry=x\n`, UNPARSEABLE],
    ["an empty key", `=x\n`, UNPARSEABLE],
    ["a space inside a key", `a b=x\n`, UNPARSEABLE],
    ["a non-ASCII letter in a key", `\u0131=x\n`, UNPARSEABLE],
    ["a Unicode line separator in a key", `a\u2028b=x\n`, UNPARSEABLE],
    ["a conflicting key beside an unrecognised line", `${K}=x\n"a"=1\n`, UNPARSEABLE],
  ];

  it.each(refused)("refuses %s", (_name, npmrc, reason) => {
    expect(edit("pnpm-workspace", `${key}:\n  - a\n`, npmrc)).toEqual(reason);
    expect(edit("pnpm-workspace", null, npmrc)).toEqual(reason);
  });

  it.each(refused)("does not verify a well-formed edit beside %s", (_name, npmrc) => {
    const before = `${key}:\n  - 'x'\n`;
    const after = `${key}:\n  - 'x'\n  - '${VALUE}'\n`;
    expect(verify("pnpm-workspace", before, after)).toEqual({ verified: true, value: VALUE });
    expect(verify("pnpm-workspace", before, after, npmrc)).toEqual({ verified: false });
  });

  it("refuses a file whose first line is fine and whose last is not", () => {
    expect(edit("pnpm-workspace", null, "registry=https://example.com/\n\n; c\n'a'=1")).toEqual(UNPARSEABLE);
  });

  it.each([
    ["an ordinary unrelated line", "registry=https://example.com/\n"],
    ["an unrelated line and a comment", "; c\n# c\nregistry=https://example.com/\n"],
    ["a scoped registry key", "@scope:registry=https://example.com/\n"],
    ["a registry auth key", "//registry.example.com/:_authToken=${TOKEN}\n"],
    ["spaces around the equals sign and the line", "  save-exact  =  true  \n"],
    ["quotes, comment marks and equals signs in a value", "a=b\"'c;d#e=f[]\n"],
    ["an empty value", "always-auth=\n"],
    ["blank and whitespace-only lines", "\n   \n\nregistry=x\n\n"],
    ["CRLF endings", "registry=x\r\n; c\r\n"],
    ["a byte order mark", "\uFEFFregistry=x\n"],
    ["a similar but longer key", `${K}-more=x\n`],
    ["a similar but shorter key", "minimum-release-age-exclud=x\n"],
    ["the setting name inside a comment", `; ${key}=x\n# ${K}=x\n`],
  ])("still edits beside %s", (_name, npmrc) => {
    expect(edit("pnpm-workspace", null, npmrc)).toEqual({ kind: "edited", text: `${key}:\n  - '${VALUE}'\n` });
    const before = `${key}:\n  - 'x'\n`;
    const after = `${key}:\n  - 'x'\n  - '${VALUE}'\n`;
    expect(verify("pnpm-workspace", before, after, npmrc)).toEqual({ verified: true, value: VALUE });
  });

  it("leaves the yarnrc surface alone whatever the .npmrc holds", () => {
    expect(edit("yarnrc", null, `"${K}"=x\n[a]\n`)).toEqual({ kind: "edited", text: `npmPreapprovedPackages:\n  - "${VALUE}"\n` });
  });

  it("leaves the pnpm YAML edit path unchanged with no .npmrc, an empty one or an unrelated one", () => {
    for (const npmrc of [undefined, null, "", "registry=x\n"]) {
      expect(edit("pnpm-workspace", `a: 1\n${key}:\n  - x\n`, npmrc)).toEqual({ kind: "edited", text: `a: 1\n${key}:\n  - x\n  - '${VALUE}'\n` });
      expect(edit("pnpm-workspace", `${key}:\n  - '${VALUE}'\n`, npmrc)).toEqual({ kind: "unchanged" });
      expect(edit("pnpm-workspace", "a: &x 1\n", npmrc)).toEqual(UNPARSEABLE);
    }
  });

  it("scans an 80 KB adversarial .npmrc line within a fixed budget", () => {
    const budgetMs = 250;
    const n = 80_000;
    const lines = [
      `${" ".repeat(n)}x`,
      `${" ".repeat(n)}=`,
      `k${" ".repeat(n)}x=1`,
      `${"a".repeat(n)}`,
      `${"a".repeat(n)}=${"=".repeat(n)}`,
      `${K}${" ".repeat(n)};c=x`,
      `${"-_".repeat(n / 2)}=x`,
      `"${"\\".repeat(n)}`,
      `${"[]".repeat(n / 2)}=x`,
    ];
    for (const line of lines) {
      const start = performance.now();
      edit("pnpm-workspace", null, `${line}\n`);
      verify("pnpm-workspace", null, `${key}:\n  - '${VALUE}'\n`, `${line}\n`);
      expect(performance.now() - start).toBeLessThan(budgetMs);
    }
  });
});

describe("verifyReleaseAgeExemption: the .npmrc conflict", () => {
  const good = "minimumReleaseAgeExclude:\n  - 'x'\n  - '@clossys/*'\n";
  const before = "minimumReleaseAgeExclude:\n  - 'x'\n";

  it("is false on a pnpm .npmrc conflict, however well the edit is formed", () => {
    expect(verify("pnpm-workspace", before, good)).toEqual({ verified: true, value: VALUE });
    expect(verify("pnpm-workspace", before, good, "minimum-release-age-exclude=foo\n")).toEqual({ verified: false });
    expect(verify("pnpm-workspace", null, `minimumReleaseAgeExclude:\n  - '${VALUE}'\n`, "minimum_release_age_exclude[]=x")).toEqual({ verified: false });
  });

  it("does not conflict with an unrelated .npmrc", () => {
    expect(verify("pnpm-workspace", before, good, "minimum-release-age=1440\n; minimum-release-age-exclude=x\n")).toEqual({ verified: true, value: VALUE });
  });

  it("ignores .npmrc on the yarnrc surface", () => {
    const yarnBefore = "npmPreapprovedPackages:\n  - 'x'\n";
    const yarnAfter = `npmPreapprovedPackages:\n  - 'x'\n  - "${VALUE}"\n`;
    expect(verify("yarnrc", yarnBefore, yarnAfter, "minimum-release-age-exclude=foo\n")).toEqual({ verified: true, value: VALUE });
  });
});

describe("editReleaseAgeExemption: linear-time line scans", () => {
  // CodeQL js/polynomial-redos: trimming spaces with an alternation of an
  // anchored-start and an anchored-end run backtracks quadratically on a long
  // run of spaces that does not end the line. The budget is generous for a
  // linear scan and far below what a quadratic one takes on this input.
  const BUDGET_MS = 250;
  const spaces = " ".repeat(80_000);
  const timed = (run: () => unknown): number => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };

  const witnesses: readonly (readonly [string, string])[] = [
    ["spaces then a character", `${spaces}x`],
    ["spaces, a character, then more spaces", `${spaces}x${spaces}`],
    ["a list dash then spaces then a character", `-${spaces}x`],
    ["a key then spaces then a character", `k:${spaces}x`],
    ["repeated dash-space items", "- ".repeat(40_000)],
    ["spaces then a comment start", `${spaces}#`],
  ];

  for (const { surface } of SURFACES) {
    for (const [name, line] of witnesses) {
      it(`${surface}: scans ${name} within the budget`, () => {
        expect(timed(() => edit(surface, `${line}\n`))).toBeLessThan(BUDGET_MS);
        expect(timed(() => edit(surface, `k: v\n${line}\n`))).toBeLessThan(BUDGET_MS);
      });
    }
  }

  it("gives the same verdicts on small inputs of the same shapes", () => {
    for (const { surface, key, q } of SURFACES) {
      expect(edit(surface, "  x\n")).toEqual(UNPARSEABLE);
      expect(edit(surface, "k:   x  \n")).toEqual({ kind: "edited", text: `k:   x  \n${key}:\n  - ${q}\n` });
      expect(edit(surface, `${key}:\n  -   x\n`)).toEqual(UNPARSEABLE);
      expect(edit(surface, "k: ?   \n")).toEqual({ kind: "edited", text: `k: ?   \n${key}:\n  - ${q}\n` });
      expect(edit(surface, "k: |  \n")).toEqual(UNPARSEABLE);
      expect(edit(surface, "-   |\n")).toEqual(UNPARSEABLE);
      expect(edit(surface, "   # c\nk: v\n")).toEqual({ kind: "edited", text: `   # c\nk: v\n${key}:\n  - ${q}\n` });
    }
  });
});
