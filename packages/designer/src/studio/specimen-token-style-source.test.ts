/** @vitest-environment node */
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parseSurfaceModule } from "../catalog-core/surface-source-analysis.js";

const text = readFileSync(new URL("./specimen-token-assets.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("specimen-token-assets.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helper = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "typeStyle")!;
const source = helper.getText(ast);

it("keeps the complete canonical typography helper within native surface syntax", () => {
  expect(parseSurfaceModule(source).functions).toContain("typeStyle");
  const regexMutation = source.replace(/\(member\.slot\.endsWith\("font-size"\).*?member\.slot\.endsWith\("caption-size"\)\)/,
    '/(?:font|body|heading|display|caption)-size$/.test(member.slot)');
  expect(regexMutation).not.toBe(source);
  expect(() => parseSurfaceModule(regexMutation)).toThrow();
});

it("preserves the typography classifier including unanchored prefixes and final line breaks", () => {
  const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  const classify = new Function(`${compiled}; return typeStyle;`)() as (member: { slot: string; $type: string; css: { light?: string } }) => unknown;
  const slots = ["font-size", "body-size", "heading-size", "display-size", "caption-size", "code-size", "font-sizes", "line-height", "letter-spacing", ""];
  const prefixes = ["", "themes.", "other.", "unknown-", "x", "\n", "\uD800", "\uDFFF", "\0"];
  const endings = ["", "\n", "\r", "\r\n", "\u2028", "\u2029", "x", "-size", "\0"];
  const types = ["dimension", "fontFamily", "fontWeight", "color", "unknown"];
  const compare = (slot: string, type: string, css: string | undefined) => {
    const expected = type === "fontFamily" ? { fontFamily: css }
      : type === "fontWeight" ? { fontWeight: css }
      : slot === "tokens.line-height" ? { lineHeight: css }
      : slot === "themes.tracking-tight" ? { letterSpacing: css }
      : type === "dimension" && /(?:font|body|heading|display|caption)-size$/.test(slot) ? { fontSize: css }
      : undefined;
    expect(classify({ slot, $type: type, css: { light: css } })).toEqual(expected);
  };
  for (const prefix of prefixes) for (const slot of slots) for (const ending of endings) for (const type of types)
    for (const css of ["var(--font-size)", "custom-value", undefined]) compare(prefix + slot + ending, type, css);
  for (const slot of ["tokens.line-height", "themes.tracking-tight"]) for (const type of ["dimension", "fontFamily", "fontWeight", "unknown"]) compare(slot, type, "custom");
});
