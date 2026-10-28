/** Copy-only binding for the registered sign-in configurations. No host actions or values enter this port. */
import sectionSlots from "../../catalog/slots/sections.json" with { type: "json" };
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";

export interface SignInCopyRef {
  readonly id: string;
  readonly locale?: string;
  readonly values?: Readonly<Record<string, string | number | boolean>>;
}
/** Structurally accepts Writer's exported createCopyResolver without a package dependency. */
export type SignInCopyResolver = (ref: SignInCopyRef) => {
  readonly ref: SignInCopyRef;
  readonly text: string;
  readonly servedLocale?: string;
  readonly chain?: readonly string[];
} | undefined;

const section = sectionSlots.find(row => row.id === "sections.sign-in-form")!;
const schema = section.contract.copy!;
const fieldKeys = new Set(schema.fields.map(field => field.key));
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function refOf(value: unknown, path: string, locale: string): SignInCopyRef {
  if (!plain(value) || Object.keys(value).some(key => !["id", "locale", "values"].includes(key))
    || typeof value.id !== "string" || !value.id.trim()
    || (value.locale !== undefined && value.locale !== locale)
    || (value.values !== undefined && (!plain(value.values) || Object.values(value.values).some(item =>
      !(typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)))))) {
    throw new TypeError(`sections.sign-in-form: ${path} requires a CopyRef for the requested locale`);
  }
  return { id: value.id, locale, ...(value.values === undefined ? {} : { values: { ...value.values } as Record<string, string | number | boolean> }) };
}

/** Resolve the selected passage's field refs before supplying ordinary JSON to the unchanged renderer.
 * Config members select copy only; the existing host still selects the visible form phase.
 * Optional errors appear only when their refs are supplied by the caller. Draft/unapproved copy
 * remains refused by Writer; this binding never promotes it or falls back to specimen literals.
 */
export function bindSignInCopy(
  configId: string,
  locale: string,
  resolver: SignInCopyResolver,
  fields: Readonly<Record<string, SignInCopyRef>>,
  providerIds: readonly string[] = [],
): Readonly<Record<string, RuntimeJson>> {
  if (!(section.contract.members.names as readonly string[]).includes(configId)) throw new TypeError("sections.sign-in-form: unknown config member");
  if (typeof resolver !== "function" || !plain(fields)) throw new TypeError("sections.sign-in-form: fields and resolver are required");
  if (providerIds.length > 4 || new Set(providerIds).size !== providerIds.length || providerIds.some(id => !/^[a-z][a-z0-9-]*$/.test(id))) {
    throw new TypeError("sections.sign-in-form: provider ids must be unique action ids (at most four)");
  }
  for (const key of Object.keys(fields)) if (!fieldKeys.has(key)) throw new TypeError(`sections.sign-in-form: unknown field ${key}`);
  for (const field of schema.fields) {
    if (field.required && (field.key !== "providers[].label" || providerIds.length) && !Object.hasOwn(fields, field.key)) {
      throw new TypeError(`sections.sign-in-form: missing required field ${field.key}`);
    }
  }
  const resolved: Record<string, string> = {};
  for (const [key, ref] of Object.entries(fields)) {
    const request = refOf(ref, key, locale);
    const result = resolver(request);
    if (!result || typeof result.text !== "string" || !result.text.trim() || result.ref.id !== request.id || result.ref.locale !== locale) {
      throw new TypeError(`sections.sign-in-form: unresolved Writer copy ${key}`);
    }
    if (result.servedLocale !== locale) throw new TypeError(`sections.sign-in-form: native locale required for ${key}`);
    const field = schema.fields.find(row => row.key === key)!;
    const limit = (field.maxLength as Readonly<Record<string, number>>)[locale];
    if (limit !== undefined && [...result.text].length > limit) throw new TypeError(`sections.sign-in-form: copy length exceeds ${key} limit`);
    resolved[key] = result.text;
  }
  const content: Record<string, RuntimeJson> = { providers: providerIds.map(id => ({ id, label: resolved["providers[].label"]! })) };
  for (const [key, value] of Object.entries(resolved)) {
    if (key === "providers[].label") continue;
    const [slot, name] = key.split(".") as [string, string];
    const group = (content[slot] ??= {}) as Record<string, RuntimeJson>;
    group[name] = value;
  }
  return content;
}
