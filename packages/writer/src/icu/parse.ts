import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";

/** The bounded Writer view of the FormatJS MessageFormat AST. */
export type IcuArgumentType = "string" | "number" | "date" | "select" | "plural";
export type IcuSyntaxType = "argument" | "number" | "date" | "time" | "select" | "plural" | "selectordinal";
export interface IcuArgument { name: string; type: IcuArgumentType; syntaxType: IcuSyntaxType }
export interface IcuIssue { code: string; message: string; index: number }
export type IcuNode =
  | { kind: "literal"; text: string }
  | { kind: "argument"; name: string; type: "argument" | "number" | "date" | "time"; style?: string }
  | { kind: "choice"; name: string; type: "select" | "plural" | "selectordinal"; offset: number; options: { selector: string; nodes: IcuNode[] }[] }
  | { kind: "pound" };
export interface IcuParseResult {
  nodes: IcuNode[];
  arguments: IcuArgument[];
  issues: IcuIssue[];
  /** The exact validated engine AST, reusable by the runtime without another parse. */
  formatjsAst?: MessageFormatElement[];
}

export const ICU_PARSE_LIMITS = { sourceLength: 65_536, depth: 32, nodes: 10_000 } as const;
const identifier = /^(?:[A-Za-z_][A-Za-z0-9_.-]*|[0-9]+)$/;
const pluralCategories = new Set(["zero", "one", "two", "few", "many", "other"]);
const stop = Symbol("invalid-icu");
const syntaxIssues: Record<string, [code: string, message: string]> = {
  EXPECT_ARGUMENT_CLOSING_BRACE: ["unbalanced", "Missing closing brace for ICU argument."],
  EMPTY_ARGUMENT: ["argument", "Expected an ICU argument name (ASCII identifier or numeric index)."],
  MALFORMED_ARGUMENT: ["argument", "Malformed ICU argument."],
  EXPECT_ARGUMENT_TYPE: ["unsupported-type", "Expected an ICU argument type."],
  INVALID_ARGUMENT_TYPE: ["unsupported-type", "Unsupported ICU argument type."],
  EXPECT_ARGUMENT_STYLE: ["unsupported-style", "Expected a standard named ICU format style."],
  INVALID_NUMBER_SKELETON: ["unsupported-style", "ICU number skeletons are not supported; use a standard named style."],
  INVALID_DATE_TIME_SKELETON: ["unsupported-style", "ICU date/time skeletons are not supported; use a standard named style."],
  EXPECT_NUMBER_SKELETON: ["unsupported-style", "ICU number skeletons are not supported; use a standard named style."],
  EXPECT_DATE_TIME_SKELETON: ["unsupported-style", "ICU date/time skeletons are not supported; use a standard named style."],
  UNCLOSED_QUOTE_IN_ARGUMENT_STYLE: ["quote", "Unterminated ICU quoted format style."],
  EXPECT_SELECT_ARGUMENT_OPTIONS: ["choice", "Expected a comma before ICU choices."],
  EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE: ["offset", "Expected a plural offset value."],
  INVALID_PLURAL_ARGUMENT_OFFSET_VALUE: ["offset", "Plural offset must be a nonnegative safe integer."],
  EXPECT_SELECT_ARGUMENT_SELECTOR: ["selector", "Expected an ICU select selector."],
  EXPECT_PLURAL_ARGUMENT_SELECTOR: ["selector", "Expected an ICU plural selector."],
  EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT: ["choice", "Expected a braced message after the ICU choice selector."],
  EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT: ["choice", "Expected a braced message after the ICU choice selector."],
  INVALID_PLURAL_ARGUMENT_SELECTOR: ["selector", "Exact plural selector must be a safe integer."],
  DUPLICATE_PLURAL_ARGUMENT_SELECTOR: ["duplicate-selector", "Duplicate ICU plural selector."],
  DUPLICATE_SELECT_ARGUMENT_SELECTOR: ["duplicate-selector", "Duplicate ICU select selector."],
  MISSING_OTHER_CLAUSE: ["missing-other", "ICU choices require an other branch."],
};

function engineIssue(error: unknown, text: string): IcuIssue {
  if (error instanceof RangeError) return { code: "limit", message: "Message exceeds the ICU parser limits.", index: 0 };
  const failure = error as { message?: unknown; location?: { start?: { offset?: unknown } } } | null;
  const offset = failure?.location?.start?.offset;
  const index = typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.min(text.length, offset)) : 0;
  const kind = typeof failure?.message === "string" ? failure.message : "";
  if (kind === "EXPECT_ARGUMENT_CLOSING_BRACE" && !text.slice(index).includes(",")) return { code: "argument", message: "Missing closing brace after the ICU argument name.", index };
  if (kind === "EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT" && text.slice(0, index).endsWith("offset") && text[index] === ":") return { code: "offset", message: "Select arguments cannot have an offset.", index };
  const [code, message] = syntaxIssues[kind] ?? ["syntax", "Invalid ICU MessageFormat syntax."];
  return { code, message, index };
}

/**
 * FormatJS owns quoting and grammar. Writer restricts its AST to ASCII identifiers,
 * standard named styles, nonnegative offsets, and bounded message complexity.
 * HTML/XML-looking tags remain literal text. Results with issues must not be used.
 */
export function parseIcuMessage(text: string): IcuParseResult {
  if (text.length > ICU_PARSE_LIMITS.sourceLength) return { nodes: [], arguments: [], issues: [{ code: "limit", message: "Message exceeds the ICU source length limit.", index: ICU_PARSE_LIMITS.sourceLength }] };
  let formatjsAst: MessageFormatElement[];
  try {
    formatjsAst = parse(text, { ignoreTag: true, captureLocation: true, requiresOtherClause: true, shouldParseSkeletons: false });
  } catch (error) {
    return { nodes: [], arguments: [], issues: [engineIssue(error, text)] };
  }
  const issues: IcuIssue[] = [], args: IcuArgument[] = [], argumentKeys = new Set<string>();
  let count = 0;
  const fail = (code: string, message: string, index: number): never => {
    issues.push({ code, message, index });
    throw stop;
  };
  const argument = (name: string, syntaxType: IcuSyntaxType): void => {
    const type: IcuArgumentType = syntaxType === "argument" ? "string" : syntaxType === "time" ? "date" : syntaxType === "selectordinal" ? "plural" : syntaxType;
    const key = `${name}:${syntaxType}`;
    if (!argumentKeys.has(key)) { argumentKeys.add(key); args.push({ name, type, syntaxType }); }
  };
  const adapt = (elements: MessageFormatElement[], depth: number): IcuNode[] => {
    if (depth > ICU_PARSE_LIMITS.depth) fail("limit", "Message exceeds the ICU nesting limit.", elements[0]?.location?.start.offset ?? 0);
    return elements.map<IcuNode>(element => {
      const index = element.location?.start.offset ?? 0;
      if (++count > ICU_PARSE_LIMITS.nodes) fail("limit", "Message exceeds the ICU node limit.", index);
      if (element.type === TYPE.literal) return { kind: "literal", text: element.value };
      if (element.type === TYPE.pound) return { kind: "pound" };
      if (element.type === TYPE.tag) return fail("unsupported-type", "Rich-text ICU tags are not supported.", index);
      if (!identifier.test(element.value)) fail("argument", "Expected an ICU argument name (ASCII identifier or numeric index).", index);
      if (element.type === TYPE.select || element.type === TYPE.plural) {
        const type = element.type === TYPE.select ? "select" : element.pluralType === "ordinal" ? "selectordinal" : "plural";
        const offset = element.type === TYPE.plural ? element.offset : 0;
        if (!Number.isSafeInteger(offset) || offset < 0) fail("offset", "Plural offset must be a nonnegative safe integer.", index);
        const selectors = new Set<string>();
        const options = Object.entries(element.options).map(([selector, option]) => {
          const optionIndex = option.location?.start.offset ?? index;
          if (type === "select" ? !identifier.test(selector) : !selector.startsWith("=") && !pluralCategories.has(selector)) fail("selector", "Invalid ICU choice selector.", optionIndex);
          const key = selector.startsWith("=") ? `=${Number(selector.slice(1))}` : selector;
          if (selectors.has(key)) fail("duplicate-selector", `Duplicate ICU choice selector ${selector}.`, optionIndex);
          selectors.add(key);
          return { selector, nodes: adapt(option.value, depth + 1) };
        });
        argument(element.value, type);
        return { kind: "choice", name: element.value, type, offset, options };
      }
      const type = element.type === TYPE.argument ? "argument" : element.type === TYPE.number ? "number" : element.type === TYPE.date ? "date" : "time";
      const style = element.type === TYPE.argument ? undefined : element.style ?? undefined;
      if (style !== undefined) {
        const supported = type === "number" ? ["integer", "currency", "percent"] : ["short", "medium", "long", "full"];
        if (typeof style !== "string" || !supported.includes(style)) fail("unsupported-style", `Unsupported ICU ${type} style; use a standard named style.`, index);
      }
      argument(element.value, type);
      return { kind: "argument", name: element.value, type, ...(typeof style === "string" ? { style } : {}) };
    });
  };
  try {
    return { nodes: adapt(formatjsAst, 0), arguments: args, issues, formatjsAst };
  } catch (error) {
    return { nodes: [], arguments: [], issues: error === stop ? issues : [engineIssue(error, text)] };
  }
}
