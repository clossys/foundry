import { isContentLocale } from "../vocabulary.js";
import { resolveCopy } from "../composition.js";
import type { ReviewContext, ReviewCopySchema, ReviewSectionRegistration } from "./types.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const schemaKey = /^[a-z][a-zA-Z0-9-]*(?:\[\])?(?:\.[a-z][a-zA-Z0-9-]*(?:\[\])?)*$/;

/** Validate the supplied DG-1 snapshot; Designer is never a runtime dependency. */
function validSchema(value: unknown): value is ReviewCopySchema {
  if (!object(value) || !exact(value, ["sourceLocale", "fields"]) || !isContentLocale(value.sourceLocale) || !Array.isArray(value.fields)) return false;
  const keys = new Set<string>();
  for (const field of value.fields) {
    if (!object(field) || !exact(field, ["key", "kind", "required", "maxLength", "dir"])
      || typeof field.key !== "string" || !schemaKey.test(field.key) || keys.has(field.key)
      || !["plain", "rich", "icu"].includes(field.kind as string) || typeof field.required !== "boolean"
      || !["ltr", "rtl", "auto"].includes(field.dir as string) || !object(field.maxLength)
      || !Object.hasOwn(field.maxLength, value.sourceLocale)
      || Object.entries(field.maxLength).some(([tag, limit]) => !isContentLocale(tag) || typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0)) return false;
    keys.add(field.key);
  }
  return true;
}

/** Array indices and record keys both occupy one concrete collection segment. */
function address(key: string): string[] | undefined {
  if (key.includes("[]") || key.includes("*")) return undefined;
  const normalized = key.replace(/\[([^\[\].]+)\]/g, ".$1");
  if (/[\[\]]/.test(normalized)) return undefined;
  const parts = normalized.split(".");
  return parts.every(part => !!part) ? parts : undefined;
}
const pattern = (key: string) => key.replace(/\[\]/g, ".*").split(".");
const matches = (wanted: readonly string[], actual: readonly string[], prefix = false) =>
  (prefix ? actual.length >= wanted.length : actual.length === wanted.length)
  && wanted.every((part, i) => part === "*" || part === actual[i]);

/** Required collection fields apply to each observed item, including sibling-only items. */
function requiredAddresses(parts: readonly string[], present: readonly (readonly string[])[]): string[][] {
  const lastCollection = parts.lastIndexOf("*");
  if (lastCollection < 0) return [[...parts]];
  const prefix = parts.slice(0, lastCollection + 1);
  const expanded = new Map<string, string[]>();
  for (const actual of present) if (matches(prefix, actual, true)) {
    const concrete = parts.map((part, i) => part === "*" ? actual[i]! : part);
    expanded.set(JSON.stringify(concrete), concrete);
  }
  return [...expanded.values()];
}

/** Review only the resolved pinned occurrences supplied by the closed-world check. */
export function reviewCopy(context: ReviewContext): void {
  const locales = context.slot.locales;
  const candidatePath = `registry.candidates[${context.registry.candidates.indexOf(context.candidate)}]`;
  const content = {
    ...(context.candidate.composition ? { composition: { ...context.candidate.composition, sections: context.sections.map(row => row.section) } } : {}),
    ...(context.candidate.pageMeta === undefined ? {} : { pageMeta: context.candidate.pageMeta }),
  };
  const copies = new Map(locales.map(locale => {
    const result = resolveCopy(content, locale, { resolver: context.input.copyResolver, requirePageMeta: context.slot.kind !== "redirect" });
    for (const finding of result.findings) {
      const path = finding.path.replace(/^composition\.sections\[(\d+)\]/, (_, index: string) => context.sections[Number(index)]!.path);
      const mapped = { ...finding, path: path.startsWith("pageMeta") ? `${candidatePath}.${path}` : path };
      context.copyFinding(mapped);
      if (finding.severity === "error") {
        context.add("copy-schema", mapped.path, finding.rule, finding.message);
        context.need("copy", "writer", JSON.stringify([mapped.path, locale, finding.rule]), finding.message);
      }
    }
    return [locale, result.copy] as const;
  }));
  const sourceLocale = locales.includes(context.registry.workspace.defaultLocale)
    ? context.registry.workspace.defaultLocale : locales[0];
  for (const { section, path, registration } of context.sections) {
    // Unregistered references already have a closed-world Designer Need.
    if (!registration) continue;
    const schemaIssue = (rule: string, message: string, at = path) => {
      context.add("copy-schema", at, rule, message);
      context.need("copy-schema", "designer", `${at}:${rule}`, message);
    };
    const configs = registration.configSchemas;
    if (configs !== undefined && !Array.isArray(configs)) {
      schemaIssue("invalid-copy-schema", "Config copy metadata must be an array"); continue;
    }
    const overrides = configs?.filter(row => object(row) && row.configId === section.configId) ?? [];
    if (overrides.length > 1) {
      schemaIssue("invalid-copy-schema", "Config copy metadata must identify one explicit contract"); continue;
    }
    const override = overrides[0];
    const schema = override ? override.copy : registration.copy;
    const passage = override ? override.passageSchema : registration.passageSchema;
    const slots: ReviewSectionRegistration["slots"] = override?.slots ?? registration.slots;
    const expectedPassage = section.sectionId.startsWith("sections.") ? `passages.${section.sectionId.slice("sections.".length)}` : undefined;
    if (!expectedPassage || passage !== expectedPassage || !validSchema(schema)
      || (slots !== undefined && (!Array.isArray(slots) || slots.some(slot => !object(slot) || typeof slot.name !== "string" || typeof slot.required !== "boolean")))) {
      schemaIssue("invalid-copy-schema", "A paired passage schema and valid DG-1 copy metadata are required"); continue;
    }

    const declared = schema.fields.map(field => ({ field, parts: pattern(field.key) }));
    const rows = section.fields.map((field, i) => ({ field, parts: address(field.key), path: `${path}.fields[${i}]` }));
    const present = rows.flatMap(row => row.parts ? [row.parts] : []);
    const byLocale = new Map<string, Map<string, typeof rows[number]>>();
    for (const row of rows) {
      const { field, parts } = row;
      const definition = parts && declared.find(entry => matches(entry.parts, parts))?.field;
      if (!definition) {
        context.add("copy-schema", `${row.path}.key`, "unknown-copy-field", "Copy field is not declared in the selected DG-1 schema");
        continue;
      }
      if (!locales.includes(field.locale)) context.add("locale-coverage", `${row.path}.locale`, "undeclared-copy-locale", "Copy locale is not selected for this slot");
      let localeRows = byLocale.get(field.locale);
      if (!localeRows) { localeRows = new Map(); byLocale.set(field.locale, localeRows); }
      if (localeRows.has(JSON.stringify(parts))) context.add("copy-schema", `${row.path}.key`, "duplicate-copy-address", "One section field address may have only one value per locale");
      localeRows.set(JSON.stringify(parts), row);
      const limit = Object.hasOwn(definition.maxLength, field.locale) ? definition.maxLength[field.locale] : undefined;
      if (limit === undefined) schemaIssue("undeclared-locale-limit", "Designer must declare an exact maximum for this field locale", `${row.path}.locale`);
      else {
        const value = copies.get(field.locale)?.[section.key]?.[field.key];
        if (value !== undefined && [...value].length > limit) context.add("copy-schema", row.path, "max-length", "Copy exceeds its declared locale maximum");
      }
      // ICU parsing belongs to Writer; kind metadata only chooses the declared contract here.
    }

    const missing = (check: "copy-schema" | "locale-coverage", key: string, locale: string, rule: string, message: string) => {
      context.add(check, `${path}.fields`, rule, `${message}: ${key} (${locale})`);
      context.need("copy", "writer", JSON.stringify([path, key, locale]), `${message}: ${key} (${locale})`);
    };
    for (const { field, parts } of declared) {
      if (!field.required) continue;
      const root = parts[0]!;
      if (slots?.some(slot => slot.name === root && !slot.required) && !present.some(actual => actual[0] === root)) continue;
      if (root === "states" && !present.some(actual => actual[0] === root && actual[1] === parts[1])) continue;
      for (const concrete of requiredAddresses(parts, present)) for (const locale of locales) {
        const row = byLocale.get(locale)?.get(JSON.stringify(concrete));
        const value = row && copies.get(locale)?.[section.key]?.[row.field.key];
        if (!row || !value?.trim()) missing("copy-schema", concrete.join("."), locale, "required-copy", "Required Writer copy is missing");
      }
    }
    if (sourceLocale === undefined) continue;
    const source = byLocale.get(sourceLocale) ?? new Map<string, typeof rows[number]>();
    for (const locale of locales) {
      if (locale === sourceLocale) continue;
      const translated = byLocale.get(locale) ?? new Map<string, typeof rows[number]>();
      for (const [key, row] of source) if (!translated.has(key)) missing("locale-coverage", row.field.key, locale, "missing-copy-locale", "Source copy key needs a translation");
      for (const [key, row] of translated) if (!source.has(key)) {
        context.add("locale-coverage", `${row.path}.key`, "orphan-copy-field", "Translated copy key has no source-locale field");
        context.need("copy", "writer", JSON.stringify([path, row.field.key, sourceLocale]), "Reconcile the missing source-locale Writer copy for this translated key");
      }
    }
  }
}
