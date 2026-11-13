/** Designer owns copy shape and layout limits; consumers own text and locale content. */
export interface CopyField {
  key: string;
  locale: string;
  value: string;
  source: "handwritten";
}
export interface SectionCopyField {
  /** Dotted content path; [] addresses each collection value (array item or keyed record), never a data id. */
  key: string;
  kind: "plain" | "rich" | "icu";
  /** Within the containing optional slot, record item or state when it is present. */
  required: boolean;
  /** Unicode code-point ceiling by BCP-47 locale. Only explicitly authored locale limits are declared. */
  maxLength: Readonly<Record<string, number>>;
  dir: "ltr" | "rtl" | "auto";
}
export interface SectionCopySchema {
  /** Source limits are explicit; adding a locale requires a declared limit, not an inferred fallback. */
  sourceLocale: string;
  fields: readonly SectionCopyField[];
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const locale = (value: unknown): value is string => {
  if (typeof value !== "string" || !value) return false;
  try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; }
};
/** The v1 bridge is a closed shape. Writer references are a later, separately versioned contract. */
export function isCopyField(value: unknown): value is CopyField {
  return object(value) && exact(value, ["key", "locale", "value", "source"])
    && typeof value.key === "string" && !!value.key.trim() && locale(value.locale)
    && typeof value.value === "string" && value.source === "handwritten";
}

/** Structural copy checks also run when the section registry loads from its JSON descriptors. */
export function sectionCopySchemaFindings(slot: {
  id: string;
  contract: { passageSchema?: unknown; copy?: unknown; slots: readonly { name: string }[]; states?: readonly string[]; anatomy: { header: string | null } };
}): string[] {
  const errors: string[] = [];
  const add = (message: string) => errors.push(`copy: ${slot.id} ${message}`);
  const { contract } = slot;
  if (contract.passageSchema !== `passages.${slot.id.slice("sections.".length)}`) add("passageSchema must pair with the section id");
  const schema = contract.copy;
  if (!object(schema) || !exact(schema, ["sourceLocale", "fields"]) || !locale(schema.sourceLocale) || !Array.isArray(schema.fields)) {
    add("requires sourceLocale and fields"); return errors;
  }
  const keys = new Set<string>();
  const roots = new Set([...contract.slots.map(row => row.name), "labels", ...(contract.anatomy.header ? ["header"] : [])]);
  for (const field of schema.fields) {
    if (!object(field) || !exact(field, ["key", "kind", "required", "maxLength", "dir"])) { add("field requires key, kind, required, maxLength and dir only"); continue; }
    const key = field.key;
    if (typeof key !== "string" || !/^[a-z][a-zA-Z0-9-]*(?:\[\])?(?:\.[a-z][a-zA-Z0-9-]*(?:\[\])?)*$/.test(key)) { add("invalid field key"); continue; }
    if (keys.has(key)) add(`duplicate field ${key}`);
    keys.add(key);
    const root = key.split(".")[0]!.replace(/\[\]$/, "");
    if (root === "states") {
      if (!(contract.states ?? []).includes(key.split(".")[1] ?? "")) add(`${key} names an undeclared state`);
    } else if (!roots.has(root)) add(`${key} names an undeclared content root`);
    if ((typeof field.kind !== "string" || !["plain", "rich", "icu"].includes(field.kind))) add(`${key} has invalid kind`);
    if (typeof field.required !== "boolean") add(`${key} requires boolean required`);
    if ((typeof field.dir !== "string" || !["ltr", "rtl", "auto"].includes(field.dir))) add(`${key} has invalid dir`);
    if (!object(field.maxLength) || !Object.hasOwn(field.maxLength, schema.sourceLocale as string)
      || Object.entries(field.maxLength).some(([tag, limit]) => !locale(tag) || typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0)) add(`${key} requires positive per-locale maxLength including sourceLocale`);
  }
  for (const state of contract.states ?? []) if (![...keys].some(key => key.startsWith(`states.${state}.`))) add(`missing ${state} state copy`);
  for (const row of contract.slots) if ((row as { type?: string }).type === "copy" && ![...keys].some(key => key === row.name || key.startsWith(`${row.name}.`))) add(`missing copy slot ${row.name}`);
  return errors;
}
