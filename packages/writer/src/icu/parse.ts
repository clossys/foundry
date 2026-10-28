/** A bounded MessageFormat validator, deliberately independent of a runtime formatter. */
export type IcuArgumentType = "string" | "number" | "date" | "select" | "plural";
export type IcuSyntaxType = "argument" | "number" | "date" | "time" | "select" | "plural" | "selectordinal";
export interface IcuArgument { name: string; type: IcuArgumentType; syntaxType: IcuSyntaxType }
export interface IcuIssue { code: string; message: string; index: number }
export type IcuNode =
  | { kind: "literal"; text: string }
  | { kind: "argument"; name: string; type: "argument" | "number" | "date" | "time"; style?: string }
  | { kind: "choice"; name: string; type: "select" | "plural" | "selectordinal"; offset: number; options: { selector: string; nodes: IcuNode[] }[] }
  | { kind: "pound" };
export interface IcuParseResult { nodes: IcuNode[]; arguments: IcuArgument[]; issues: IcuIssue[] }

export const ICU_PARSE_LIMITS = { sourceLength: 65_536, depth: 32, nodes: 10_000 } as const;
const identifier = /^(?:[A-Za-z_][A-Za-z0-9_.-]*|[0-9]+)$/;
const exactNumber = /^=-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/;
const stop = Symbol("invalid-icu");

class Parser {
  position = 0;
  count = 0;
  readonly arguments: IcuArgument[] = [];
  readonly argumentKeys = new Set<string>();
  readonly issues: IcuIssue[] = [];
  constructor(readonly source: string) {}
  fail(code: string, message: string, index = this.position): never {
    this.issues.push({ code, message, index });
    throw stop;
  }
  space(): void { while (this.position < this.source.length && /\s/.test(this.source[this.position]!)) this.position++; }
  node(nodes: IcuNode[], node: IcuNode): void {
    if (++this.count > ICU_PARSE_LIMITS.nodes) this.fail("limit", "Message exceeds the ICU node limit.");
    nodes.push(node);
  }
  word(): string {
    const start = this.position;
    while (this.position < this.source.length && !/[\s{},]/.test(this.source[this.position]!)) this.position++;
    return this.source.slice(start, this.position);
  }
  argument(name: string, syntaxType: IcuSyntaxType): void {
    const type: IcuArgumentType = syntaxType === "argument" ? "string" : syntaxType === "time" ? "date" : syntaxType === "selectordinal" ? "plural" : syntaxType;
    const key = `${name}:${syntaxType}`;
    if (!this.argumentKeys.has(key)) { this.argumentKeys.add(key); this.arguments.push({ name, type, syntaxType }); }
  }
  message(depth: number, nested: boolean, plural: boolean): IcuNode[] {
    if (depth > ICU_PARSE_LIMITS.depth) this.fail("limit", "Message exceeds the ICU nesting limit.");
    const nodes: IcuNode[] = [], literal: string[] = [];
    const flush = (): void => { if (literal.length) { this.node(nodes, { kind: "literal", text: literal.join("") }); literal.length = 0; } };
    while (this.position < this.source.length) {
      const ch = this.source[this.position]!;
      if (ch === "}") {
        if (!nested) this.fail("unbalanced", "Unexpected closing brace.");
        flush(); this.position++; return nodes;
      }
      if (ch === "{") { flush(); this.node(nodes, this.placeholder(depth + 1, plural)); continue; }
      if (ch === "#" && plural) { flush(); this.position++; this.node(nodes, { kind: "pound" }); continue; }
      if (ch === "'") {
        if (this.source[this.position + 1] === "'") { literal.push("'"); this.position += 2; continue; }
        const next = this.source[this.position + 1];
        if (next === "{" || next === "}" || (next === "#" && plural)) {
          const start = this.position++;
          let closed = false;
          while (this.position < this.source.length) {
            if (this.source[this.position] === "'") {
              this.position++;
              if (this.source[this.position] === "'") { literal.push("'"); this.position++; }
              else { closed = true; break; }
            } else literal.push(this.source[this.position++]!);
          }
          if (!closed) this.fail("quote", "Unterminated ICU quoted literal.", start);
          continue;
        }
      }
      literal.push(ch); this.position++;
    }
    if (nested) this.fail("unbalanced", "Missing closing brace.");
    flush(); return nodes;
  }
  placeholder(depth: number, inPlural: boolean): IcuNode {
    this.position++; this.space();
    const name = this.word();
    if (!identifier.test(name)) this.fail("argument", "Expected an ICU argument name (ASCII identifier or numeric index).");
    this.space();
    if (this.source[this.position] === "}") {
      this.position++; this.argument(name, "argument"); return { kind: "argument", name, type: "argument" };
    }
    if (this.source[this.position] !== ",") this.fail("argument", "Expected a comma or closing brace after the argument name.");
    this.position++; this.space();
    const type = this.word(); this.space();
    if (type === "number" || type === "date" || type === "time") {
      let style: string | undefined;
      if (this.source[this.position] === ",") {
        this.position++; this.space(); const start = this.position;
        while (this.position < this.source.length && this.source[this.position] !== "}") {
          if (this.source[this.position] === "{") this.fail("style", "Nested braces are not supported in ICU format styles.");
          this.position++;
        }
        style = this.source.slice(start, this.position).trim();
        const supported = type === "number" ? ["integer", "currency", "percent"] : ["short", "medium", "long", "full"];
        if (!supported.includes(style)) this.fail("unsupported-style", `Unsupported ICU ${type} style; use a standard named style.` , start);
      }
      if (this.source[this.position] !== "}") this.fail("unbalanced", "Missing closing brace for formatted argument.");
      this.position++; this.argument(name, type);
      return { kind: "argument", name, type, ...(style === undefined ? {} : { style }) };
    }
    if (type !== "select" && type !== "plural" && type !== "selectordinal") this.fail("unsupported-type", "Unsupported ICU argument type.");
    if (this.source[this.position] !== ",") this.fail("choice", "Expected a comma before ICU choices.");
    this.position++; this.space();
    let offset = 0;
    if (this.source.startsWith("offset:", this.position)) {
      if (type === "select") this.fail("offset", "Select arguments cannot have an offset.");
      this.position += 7; this.space();
      const raw = this.word();
      if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw))) this.fail("offset", "Plural offset must be a nonnegative safe integer.");
      offset = Number(raw); this.space();
    }
    const options: { selector: string; nodes: IcuNode[] }[] = [], selectors = new Set<string>();
    while (this.position < this.source.length && this.source[this.position] !== "}") {
      const selector = this.word(); this.space();
      if (!(type === "select" ? identifier.test(selector) : exactNumber.test(selector) || ["zero", "one", "two", "few", "many", "other"].includes(selector))) this.fail("selector", "Invalid ICU choice selector.");
      if (selector.startsWith("=") && !Number.isFinite(Number(selector.slice(1)))) this.fail("selector", "Exact plural selector must be finite.");
      const key = selector.startsWith("=") ? `=${Number(selector.slice(1))}` : selector;
      if (selectors.has(key)) this.fail("duplicate-selector", `Duplicate ICU choice selector ${selector}.`);
      selectors.add(key);
      if (this.source[this.position] !== "{") this.fail("choice", "Expected a braced message after the ICU choice selector.");
      this.position++;
      options.push({ selector, nodes: this.message(depth, true, type !== "select" || inPlural) });
      this.space();
    }
    if (this.source[this.position] !== "}") this.fail("unbalanced", "Missing closing brace for ICU choice.");
    if (!selectors.has("other")) this.fail("missing-other", "ICU choices require an other branch.");
    this.position++; this.argument(name, type);
    return { kind: "choice", name, type, offset, options };
  }
}

/**
 * Supports arguments, named number/date/time styles, nested choices, plural offsets,
 * exact selectors, and apostrophe quoting. Skeletons/custom styles and non-ASCII
 * identifiers fail closed. Unterminated quoted syntax is rejected rather than repaired.
 * A result with issues is incomplete and must not be used for formatting or measurement.
 */
export function parseIcuMessage(text: string): IcuParseResult {
  if (text.length > ICU_PARSE_LIMITS.sourceLength) return { nodes: [], arguments: [], issues: [{ code: "limit", message: "Message exceeds the ICU source length limit.", index: ICU_PARSE_LIMITS.sourceLength }] };
  const parser = new Parser(text);
  let nodes: IcuNode[] = [];
  try { nodes = parser.message(0, false, false); }
  catch (error) { if (error !== stop) throw error; }
  return { nodes, arguments: parser.arguments, issues: parser.issues };
}
