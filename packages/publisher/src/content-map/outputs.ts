/**
 * A publication's optional install outputs, recorded on its `clossys.publication/1` candidate as
 * `outputs` and checked fail-closed before anything installs:
 *
 * - `forms`: one submission endpoint per form (contact, newsletter). The record names the
 *   environment variable that holds the delivery target; a value never sits in a record.
 * - `share`: generated share images (Open Graph and Twitter) per publication and locale.
 * - `jsonLd`, `llms`, `feed`: opt-in page-meta outputs projected from the content map and Writer text.
 * - `locales`: the locales the publication installs; the default serves the root routes.
 *
 * Every visible string is a Writer key (`identity`), resolved per locale at install. Nothing here
 * holds literal copy, and nothing here holds a secret.
 */
import { contentMapOrigin } from "./check.js";

export const PUBLICATION_FORM_KINDS = ["contact", "newsletter"] as const;
export type PublicationFormKind = (typeof PUBLICATION_FORM_KINDS)[number];
export const PUBLICATION_FORM_FIELD_TYPES = ["text", "email", "message", "topic"] as const;
export type PublicationFormFieldType = (typeof PUBLICATION_FORM_FIELD_TYPES)[number];
export const PUBLICATION_FEEDS = ["rss", "atom"] as const;
export type PublicationFeed = (typeof PUBLICATION_FEEDS)[number];

export interface PublicationFormField {
  readonly name: string;
  readonly type: PublicationFormFieldType;
  readonly required: boolean;
  /** The trimmed value's longest accepted length, in characters. */
  readonly maxLength: number;
  /** A topic field's accepted values. */
  readonly options?: readonly string[];
}
export interface PublicationForm {
  readonly id: string;
  readonly kind: PublicationFormKind;
  readonly fields: readonly PublicationFormField[];
  /** The longest accepted request body, in bytes. */
  readonly maxBytes: number;
  /** The NAME of the environment variable that holds the https delivery target. Never a value. */
  readonly targetEnv: string;
  /** A hidden field a person leaves empty; a filled one is accepted and dropped. */
  readonly honeypot: string;
}
export interface PublicationLocales { readonly default: string; readonly all: readonly string[] }
export interface PublicationOutputs {
  /** The https site origin absolute page-meta URLs start from. */
  readonly origin?: string;
  /** Writer keys for the publication's name and one-line summary. */
  readonly identity?: { readonly name: string; readonly summary: string };
  readonly forms?: readonly PublicationForm[];
  readonly share?: boolean;
  readonly jsonLd?: boolean;
  readonly llms?: boolean;
  readonly feed?: PublicationFeed;
  readonly locales?: PublicationLocales;
}

/** A canonical BCP 47 tag: lower-case language, then subtags (the release locale rule). */
export const OUTPUT_LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
/** A Writer key: `<namespace>.<key>`. */
export const OUTPUT_WRITER_KEY = /^[a-z][a-z0-9-]*(?:\.[a-z0-9]+(?:[.-][a-z0-9]+)*)+$/;
/** An environment variable name: upper case, digits and underscores. */
export const OUTPUT_ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const FORM_ID = /^[a-z][a-z0-9-]{0,31}$/;
const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,31}$/;
const OPTION = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const FORM_MAX_BYTES = { min: 256, max: 65_536 } as const;
export const FORM_MAX_FIELD_LENGTH = 10_000;
export const FORM_MAX_FIELDS = 12;
const EMAIL_MAX = 254;
const KEYS = new Set(["origin", "identity", "forms", "share", "jsonLd", "llms", "feed", "locales"]);

/** The standard form a kind installs: what `clossys init --forms` records. */
export function publicationFormDefaults(kind: PublicationFormKind, id: string = kind): PublicationForm {
  const email: PublicationFormField = { name: "email", type: "email", required: true, maxLength: EMAIL_MAX };
  return kind === "contact"
    ? { id, kind, maxBytes: 8_192, targetEnv: "CONTACT_FORM_TARGET", honeypot: "website", fields: [
        { name: "name", type: "text", required: false, maxLength: 100 }, email,
        { name: "topic", type: "topic", required: false, maxLength: 32, options: ["general"] },
        { name: "message", type: "message", required: true, maxLength: 5_000 },
      ] }
    : { id, kind, maxBytes: 1_024, targetEnv: "NEWSLETTER_FORM_TARGET", honeypot: "website", fields: [email] };
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function checkForm(form: unknown, at: string, issues: string[]): void {
  if (!object(form)) { issues.push(`${at} is not an object`); return; }
  for (const key of Object.keys(form)) if (!["id", "kind", "fields", "maxBytes", "targetEnv", "honeypot"].includes(key)) issues.push(`${at}: unknown key ${key}`);
  if (typeof form.id !== "string" || !FORM_ID.test(form.id)) issues.push(`${at}.id must match ${FORM_ID}`);
  if (!PUBLICATION_FORM_KINDS.includes(form.kind as PublicationFormKind)) issues.push(`${at}.kind must be one of ${PUBLICATION_FORM_KINDS.join(", ")}`);
  if (!integer(form.maxBytes, FORM_MAX_BYTES.min, FORM_MAX_BYTES.max)) issues.push(`${at}.maxBytes must be an integer from ${FORM_MAX_BYTES.min} to ${FORM_MAX_BYTES.max}`);
  if (typeof form.targetEnv !== "string" || !OUTPUT_ENV_NAME.test(form.targetEnv)) issues.push(`${at}.targetEnv must name an environment variable (${OUTPUT_ENV_NAME}), never hold a value`);
  if (typeof form.honeypot !== "string" || !FIELD_NAME.test(form.honeypot)) issues.push(`${at}.honeypot must match ${FIELD_NAME}`);
  if (!Array.isArray(form.fields) || !form.fields.length || form.fields.length > FORM_MAX_FIELDS) { issues.push(`${at}.fields must list 1 to ${FORM_MAX_FIELDS} fields`); return; }
  const names = new Set<string>();
  form.fields.forEach((field: unknown, index: number) => {
    const where = `${at}.fields[${index}]`;
    if (!object(field)) { issues.push(`${where} is not an object`); return; }
    for (const key of Object.keys(field)) if (!["name", "type", "required", "maxLength", "options"].includes(key)) issues.push(`${where}: unknown key ${key}`);
    if (typeof field.name !== "string" || !FIELD_NAME.test(field.name)) issues.push(`${where}.name must match ${FIELD_NAME}`);
    else if (names.has(field.name)) issues.push(`${where}: duplicate field ${field.name}`);
    else names.add(field.name);
    if (!PUBLICATION_FORM_FIELD_TYPES.includes(field.type as PublicationFormFieldType)) issues.push(`${where}.type must be one of ${PUBLICATION_FORM_FIELD_TYPES.join(", ")}`);
    if (typeof field.required !== "boolean") issues.push(`${where}.required must be a boolean`);
    if (!integer(field.maxLength, 1, field.type === "email" ? EMAIL_MAX : FORM_MAX_FIELD_LENGTH)) issues.push(`${where}.maxLength must be an integer from 1 to ${field.type === "email" ? EMAIL_MAX : FORM_MAX_FIELD_LENGTH}`);
    if (field.type === "topic") {
      const options = field.options;
      if (!Array.isArray(options) || !options.length || options.some(option => typeof option !== "string" || !OPTION.test(option)) || new Set(options).size !== options.length) issues.push(`${where}.options must list unique topic values (${OPTION})`);
    } else if (field.options !== undefined) issues.push(`${where}.options belongs to a topic field only`);
  });
  if (!form.fields.some((field: unknown) => object(field) && field.type === "email")) issues.push(`${at} needs an email field`);
  if (typeof form.honeypot === "string" && names.has(form.honeypot)) issues.push(`${at}.honeypot ${form.honeypot} shadows a declared field`);
}

/** Every reason an outputs record is refused; empty when it installs. */
export function checkPublicationOutputs(value: unknown): readonly string[] {
  const issues: string[] = [];
  if (!object(value)) return ["outputs is not an object"];
  for (const key of Object.keys(value)) if (!KEYS.has(key)) issues.push(`outputs: unknown key ${key}`);
  for (const key of ["share", "jsonLd", "llms"] as const) if (value[key] !== undefined && typeof value[key] !== "boolean") issues.push(`outputs.${key} must be a boolean`);
  if (value.feed !== undefined && !PUBLICATION_FEEDS.includes(value.feed as PublicationFeed)) issues.push(`outputs.feed must be one of ${PUBLICATION_FEEDS.join(", ")}`);
  if (value.origin !== undefined) {
    let ok = false;
    try { ok = contentMapOrigin(value.origin as string).protocol === "https:"; } catch { ok = false; }
    if (!ok) issues.push("outputs.origin must be an https origin with no path, query or credentials");
  }
  if (value.identity !== undefined) {
    if (!object(value.identity)) issues.push("outputs.identity is not an object");
    else {
      for (const key of Object.keys(value.identity)) if (!["name", "summary"].includes(key)) issues.push(`outputs.identity: unknown key ${key}`);
      for (const key of ["name", "summary"] as const) if (typeof value.identity[key] !== "string" || !OUTPUT_WRITER_KEY.test(value.identity[key] as string)) issues.push(`outputs.identity.${key} must be a Writer key`);
    }
  }
  const meta = value.jsonLd === true || value.llms === true || value.feed !== undefined;
  if (meta && value.origin === undefined) issues.push("outputs.origin is required by jsonLd, llms and feed");
  if ((meta || value.share === true) && value.identity === undefined) issues.push("outputs.identity is required by share, jsonLd, llms and feed");
  if (value.forms !== undefined) {
    if (!Array.isArray(value.forms)) issues.push("outputs.forms must be a list");
    else {
      const ids = new Set<string>();
      value.forms.forEach((form: unknown, index: number) => {
        checkForm(form, `outputs.forms[${index}]`, issues);
        const id = object(form) ? form.id : undefined;
        if (typeof id === "string") { if (ids.has(id)) issues.push(`outputs.forms: duplicate form id ${id}`); ids.add(id); }
      });
    }
  }
  if (value.locales !== undefined) {
    const locales = value.locales;
    if (!object(locales)) issues.push("outputs.locales is not an object");
    else {
      for (const key of Object.keys(locales)) if (!["default", "all"].includes(key)) issues.push(`outputs.locales: unknown key ${key}`);
      const all = locales.all;
      // Unique case-insensitively: `en-US` and `en-us` install to one folder on a case-insensitive file system.
      if (!Array.isArray(all) || !all.length || all.some(tag => typeof tag !== "string" || !OUTPUT_LOCALE.test(tag)) || new Set(all.map(tag => (tag as string).toLowerCase())).size !== all.length) issues.push(`outputs.locales.all must list unique canonical locales (${OUTPUT_LOCALE}), case-insensitively`);
      else if (typeof locales.default !== "string" || !all.includes(locales.default)) issues.push("outputs.locales.default must be one of outputs.locales.all");
    }
  }
  return issues;
}
