import { parseIcuMessage, type IcuArgumentType, type IcuNode, type IcuParseResult } from "../icu/parse.js";
import type { Block, WriterLibrary, WriterRecord } from "../model/types.js";
import type { WriterCheckFinding, WriterCheckOptions } from "./freeze.js";

interface TextField { field: string; text: string }

/** Only user-facing source copy is MessageFormat, not IDs, regexes, or metadata. */
function textFields(record: WriterRecord): TextField[] {
  if ("text" in record) return [{ field: "text", text: record.text }];
  if ("parts" in record) return Object.entries(record.parts).flatMap(([key, part]) => "text" in part ? [{ field: `parts.${key}.text`, text: part.text }] : []);
  if ("blocks" in record) {
    const result: TextField[] = [];
    if (!/^(?:lx|st|pt|ps|nr)\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/.test(record.title)) result.push({ field: "title", text: record.title });
    // A work list also keeps traversal independent of the JavaScript call stack.
    const pending: { block: Block; field: string }[] = record.blocks.map((block, index) => ({ block, field: `blocks[${index}]` })).reverse();
    while (pending.length) {
      const { block, field } = pending.pop()!;
      if (block.text !== undefined) result.push({ field: `${field}.text`, text: block.text });
      for (let index = (block.children?.length ?? 0) - 1; index >= 0; index--) pending.push({ block: block.children![index]!, field: `${field}.children[${index}]` });
    }
    return result;
  }
  if ("kind" in record) {
    if (record.kind === "term") return [{ field: "term", text: record.term }, ...record.forms.map((text, index) => ({ field: `forms[${index}]`, text })), ...(record.alternative === undefined ? [] : [{ field: "alternative", text: record.alternative }])];
    if (record.kind === "claim") return record.phrasings.map((text, index) => ({ field: `phrasings[${index}]`, text }));
    if (record.kind === "pattern-rule" && record.alternative !== undefined) return [{ field: "alternative", text: record.alternative }];
  }
  return [];
}

function signature(parsed: IcuParseResult): string {
  return [...new Set(parsed.arguments.map(arg => `${arg.name}:${arg.type}`))].sort().join(", ");
}

/** WR8 validates authored ICU source only; it never formats or executes it. */
export function checkWriterICU(library: WriterLibrary, _options: WriterCheckOptions = {}): WriterCheckFinding[] {
  const findings: WriterCheckFinding[] = [];
  const sourceStrings = new Map<string, IcuParseResult>();
  for (const record of library.locales[library.manifest.defaultLocale]?.records ?? []) if ("text" in record) sourceStrings.set(record.id, parseIcuMessage(record.text));

  for (const [locale, content] of Object.entries(library.locales)) {
    const pluralCategories = new Map<string, readonly string[] | null>();
    const categories = (type: "cardinal" | "ordinal"): readonly string[] | null => {
      if (pluralCategories.has(type)) return pluralCategories.get(type)!;
      let value: readonly string[] | null = null;
      try {
        if (Intl.PluralRules.supportedLocalesOf([locale]).length) value = new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories;
      } catch { /* Invalid or unsupported locale is reported at its plural use. */ }
      pluralCategories.set(type, value); return value;
    };
    const inspect = (text: string, path: string, field: string, record?: WriterRecord): IcuParseResult => {
      const fail = (message: string, incomplete = false): void => { findings.push({ code: "WR8", severity: "error", path, locale, ...(record ? { recordId: record.id } : {}), field, message: `WR8: ${message}`, ...(incomplete ? { incomplete: true } : {}) }); };
      const parsed = parseIcuMessage(text);
      for (const issue of parsed.issues) fail(`${issue.message} (offset ${issue.index})`);
      if (parsed.issues.length) return parsed;
      const pending: IcuNode[] = [...parsed.nodes];
      while (pending.length) {
        const node = pending.pop()!;
        if (node.kind !== "choice") continue;
        if (node.type !== "select") {
          const mode = node.type === "selectordinal" ? "ordinal" : "cardinal";
          const supported = categories(mode);
          if (!supported) fail(`Plural categories cannot be validated for unsupported locale ${locale}.`, true);
          else for (const option of node.options) if (!option.selector.startsWith("=") && !supported.includes(option.selector)) fail(`Plural category ${option.selector} is not valid for ${locale} ${mode} rules.`);
        }
        for (const option of node.options) pending.push(...option.nodes);
      }
      if (!record || !("text" in record)) {
        if (parsed.arguments.length) fail("Only String records can declare ICU arguments; move argument-bearing copy into a String and reference it.");
        return parsed;
      }
      const declared = new Map<string, IcuArgumentType>();
      for (const arg of record.args ?? []) {
        if (declared.has(arg.name)) fail(`Argument ${arg.name} is declared more than once.`);
        declared.set(arg.name, arg.type);
      }
      const used = new Set<string>();
      for (const arg of parsed.arguments) {
        used.add(arg.name);
        if (!declared.has(arg.name)) fail(`ICU argument ${arg.name} (${arg.type}) is not declared in args.`);
        else if (declared.get(arg.name) !== arg.type) fail(`ICU argument ${arg.name} uses ${arg.type}, but args declares ${declared.get(arg.name)}.`);
      }
      for (const name of declared.keys()) if (!used.has(name)) fail(`Declared argument ${name} is missing from ICU text.`);
      return parsed;
    };

    for (const record of content.records) {
      for (const { field, text } of textFields(record)) {
        const path = `locales.${locale}.records.${record.id}.${field}`;
        const parsed = inspect(text, path, field, record);
        if (locale !== library.manifest.defaultLocale && "text" in record && !parsed.issues.length) {
          const source = sourceStrings.get(record.id);
          if (source && !source.issues.length && signature(source) !== signature(parsed)) findings.push({ code: "WR8", severity: "error", path, locale, recordId: record.id, field, message: `WR8: Target ICU arguments must match source names and types (source: ${signature(source) || "none"}; target: ${signature(parsed) || "none"}).` });
        }
      }
    }
    for (const document of content.documents) inspect(document.source, `locales.${locale}.${document.path}`, "source");
  }
  return findings;
}
