import type { SourceFile } from "./rewrite.js";
import { sha256 } from "../catalog-core/digest.js";

// Closed to the authenticated selected implementations, after Calendar adaptation.
const membersByPath: Readonly<Record<string, readonly string[]>> = {
  "components/menu/dropdown-menu.tsx": ["ComponentProps", "ReactNode"],
  "components/dialog/dialog.tsx": ["ComponentProps", "ReactNode"],
  "components/select/select.tsx": ["ComponentProps", "ReactNode"],
  "components/combo-box/combobox.tsx": ["ComponentProps", "ReactNode", "RefObject", "useContext", "useRef"],
  "components/calendar/calendar.tsx": ["ComponentProps", "ReactElement", "ReactNode", "Ref", "RefAttributes", "forwardRef"],
  "components/popover/popover.tsx": ["ComponentProps"],
  "components/_parts/input-group/input-group.tsx": ["ComponentProps"],
};
const valueMembers = new Set(["useContext", "useRef", "forwardRef"]);
interface Token { text: string; start: number; end: number; kind: "name" | "literal" | "punctuation" | "comment" }
interface Edit { start: number; end: number; text: string }
function refuse(path: string, detail: string): never { throw new Error(`selected-source: ${detail} in ${path}`); }

/** A bounded lexer keeps literal/comment bytes outside the authenticated edits. */
function tokensOf(code: string, path: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < code.length) {
    const start = position, character = code[position]!;
    if (/\s/.test(character)) { position++; continue; }
    let kind: Token["kind"] = "punctuation";
    if (code.startsWith("//", position)) {
      kind = "comment";
      position = code.indexOf("\n", position); if (position < 0) position = code.length;
    } else if (code.startsWith("/*", position)) {
      kind = "comment";
      const end = code.indexOf("*/", position + 2);
      if (end < 0) refuse(path, "unterminated comment");
      position = end + 2;
    } else if (character === '"' || character === "'" || character === "`") {
      kind = "literal"; position++;
      let closed = false;
      while (position < code.length) {
        if (code[position] === "\\") { position += 2; continue; }
        // Interpolation needs a larger lexer; it must never conceal namespace code.
        if (character === "`" && code.startsWith("${", position)) refuse(path, "unsupported template expression");
        if (code[position++] === character) { closed = true; break; }
      }
      if (!closed) refuse(path, "unterminated literal");
    } else if (/[A-Za-z_$]/.test(character)) {
      kind = "name"; position++;
      while (position < code.length && /[A-Za-z0-9_$]/.test(code[position]!)) position++;
    } else {
      // These selected sources have no regular-expression literals. Refuse a
      // possible literal rather than interpreting its contents as source names.
      const previous = tokens.filter(token => token.kind !== "comment").at(-1)?.text;
      if (character === "/" && (!previous || /^(?:=|\(|\[|,|:|;|!|\?|return|=>)$/.test(previous))) refuse(path, "unsupported regular expression");
      position++;
    }
    tokens.push({ text: code.slice(start, position), start, end: position, kind });
  }
  return tokens;
}

/** Normalize only the selected React namespace; do not interpret source exports. */
export function normalizeSelectedSource(file: SourceFile): SourceFile {
  // The authenticated Aria ToggleGroup emits data-orientation, not the
  // boolean attributes used by its original styling variants.
  if (file.path === "components/toggle-group/toggle-group.tsx") {
    const helper = 'import { toggleVariants } from "../toggle-button/index.js"';
    if (file.content.includes(helper)) {
      if (sha256(file.content) !== "88d36c616e90ccc67df0cb937120cfb3f7176ff44a7ef77f020c1f41089572b9") refuse(file.path, "selected ToggleGroup closure receipt differs");
      // This is the same private CVA value, not a component secondary export.
      file = { ...file, content: file.content.replace(helper, 'import { toggleVariants } from "../toggle-button/toggle.js"') };
    }
    file = { ...file, content: file.content.replace(/\b(group-)?data-(horizontal|vertical)(?=[:/])/g,
      (_match, group: string | undefined, orientation: string) => `${group ?? ""}data-[orientation=${orientation}]`) };
  }
  const allowed = membersByPath[file.path];
  if (!allowed) return file;
  const all = tokensOf(file.content, file.path), tokens = all.filter(token => token.kind !== "comment");
  const namespaces = tokens.map((token, index) => token.kind === "name" && token.text === "React" ? index : -1).filter(index => index >= 0);
  if (!namespaces.length) return file;
  const declarations = namespaces.filter(index => tokens[index - 3]?.text === "import" && tokens[index - 2]?.text === "*" && tokens[index - 1]?.text === "as" && tokens[index + 1]?.text === "from" && ['"react"', "'react'"].includes(tokens[index + 2]?.text ?? ""));
  if (declarations.length !== 1) refuse(file.path, "expected one React namespace import");
  const declaration = declarations[0]!, first = tokens[declaration - 3]!, last = tokens[declaration + (tokens[declaration + 3]?.text === ";" ? 3 : 2)]!;
  const uses = new Map<string, Token[]>(), consumed = new Set<Token>();
  for (let index = declaration - 3; index <= declaration + 2; index++) consumed.add(tokens[index]!);
  const edits: Edit[] = [];
  for (const index of namespaces.filter(index => index !== declaration)) {
    const namespace = tokens[index]!, dot = tokens[index + 1], member = tokens[index + 2];
    if (dot?.text !== "." || member?.kind !== "name" || !allowed.includes(member.text) || tokens[index - 1]?.text === "." || tokens[index + 3]?.text === "=") refuse(file.path, "unsupported React namespace access");
    const alias = `React${member.text.replace(/^React/, "").replace(/^./, character => character.toUpperCase())}`;
    uses.set(member.text, [...(uses.get(member.text) ?? []), member]);
    consumed.add(namespace); consumed.add(dot); consumed.add(member);
    // Separate token edits retain any intervening comments and whitespace.
    edits.push({ start: namespace.start, end: namespace.end, text: alias }, { start: dot.start, end: dot.end, text: "" }, { start: member.start, end: member.end, text: "" });
  }
  const rows: string[] = [];
  for (const typeOnly of [true, false]) {
    const bindings = [...uses.keys()].filter(member => !valueMembers.has(member) === typeOnly).sort().map(member => {
      const alias = `React${member.replace(/^React/, "").replace(/^./, character => character.toUpperCase())}`;
      if (tokens.some(token => token.kind === "name" && token.text === alias && !consumed.has(token))) refuse(file.path, `named import alias collision ${alias}`);
      return `${member} as ${alias}`;
    });
    if (bindings.length) rows.push(`import ${typeOnly ? "type " : ""}{ ${bindings.join(", ")} } from "react"`);
  }
  const comments = all.filter(token => token.kind === "comment" && token.start > first.start && token.end < last.end).map(token => token.text);
  edits.push({ start: first.start, end: last.end, text: [...comments, ...rows].join("\n") });
  let content = file.content;
  for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
  return { ...file, content };
}
