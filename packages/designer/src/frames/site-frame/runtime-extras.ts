import type { SiteMegaGroup, SiteMegaLink } from "../../shell/SiteHeader.mega.client.js";
import type { SiteLocaleLink } from "../../shell/SiteHeader.extras.js";
import type { NewsletterBandProps } from "../../blocks/NewsletterBand.js";
import { HEADER_LINK_LIMIT } from "./site-frame-contract.js";

type Row = Readonly<Record<string, unknown>>;
function record(value: unknown, at: string, names: readonly string[]): Row {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !names.includes(key))) throw new TypeError(`${at} requires closed content fields`);
  return value as Row;
}
function text(value: unknown, at: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${at} requires nonempty text`);
  return value;
}
function list(value: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${at} requires a list`);
  return value;
}
function destination(value: unknown, at: string): string {
  const href = text(value, at);
  if (/[\s\\\u0000-\u001f\u007f]/.test(href) || href.startsWith("//") || !/^(?:\/(?!\/)|#|\?|https?:\/\/|mailto:|tel:)/i.test(href)) throw new TypeError(`${at} requires a safe destination`);
  return href;
}
function link(value: unknown, at: string): SiteMegaLink {
  const row = record(value, at, ["label", "href", "isCurrent"]);
  if (row.isCurrent !== undefined && typeof row.isCurrent !== "boolean") throw new TypeError(`${at}.isCurrent must be boolean`);
  return { label: text(row.label, `${at}.label`), href: destination(row.href, `${at}.href`), ...(row.isCurrent === true ? { isCurrent: true } : {}) };
}
export function runtimeMegaLinks(value: unknown): readonly SiteMegaLink[] {
  return value === undefined ? [] : list(value, "nav.links").map((value, index) => link(value, `nav.links[${index}]`));
}

/** Standalone frame leaves consume the same closed resolved content as SiteFrame. */
export function runtimeMegaGroups(value: unknown): readonly SiteMegaGroup[] {
  const groups = list(value, "nav.mega").map((value, index): SiteMegaGroup => {
    const at = `nav.mega[${index}]`, row = record(value, at, ["id", "label", "columns", "featured"]);
    const columns = list(row.columns, `${at}.columns`).map((value, index) => {
      const at = `nav.mega.columns[${index}]`, column = record(value, at, ["heading", "links"]);
      const links = list(column.links, `${at}.links`).map((value, index) => link(value, `${at}.links[${index}]`));
      if (!links.length) throw new TypeError(`${at} requires links`);
      return { heading: text(column.heading, `${at}.heading`), links };
    });
    if (!columns.length) throw new TypeError(`${at} requires link columns`);
    const featured = row.featured === undefined ? undefined : record(row.featured, `${at}.featured`, ["label", "href", "description"]);
    return { id: text(row.id, `${at}.id`), label: text(row.label, `${at}.label`), columns,
      ...(featured ? { featured: { ...link({ label: featured.label, href: featured.href }, `${at}.featured`), ...(featured.description === undefined ? {} : { description: text(featured.description, `${at}.featured.description`) }) } } : {}) };
  });
  if (!groups.length || groups.length > HEADER_LINK_LIMIT || new Set(groups.map(group => group.id)).size !== groups.length) throw new TypeError("Mega navigation requires one to five unique groups");
  return groups;
}

export function runtimeLocale(value: unknown): { readonly label: string; readonly links: readonly SiteLocaleLink[] } {
  const row = record(value, "locale", ["label", "links"]);
  const links = list(row.links, "locale.links").map((value, index): SiteLocaleLink => {
    const at = `locale.links[${index}]`, row = record(value, at, ["label", "href", "locale", "isCurrent"]);
    const locale = text(row.locale, `${at}.locale`), href = destination(row.href, `${at}.href`);
    if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(locale) || !href.startsWith("/") || row.isCurrent !== undefined && typeof row.isCurrent !== "boolean") throw new TypeError(`${at} requires a local route and locale`);
    return { label: text(row.label, `${at}.label`), href, locale, ...(row.isCurrent === true ? { isCurrent: true } : {}) };
  });
  if (new Set(links.map(link => link.locale.toLowerCase())).size !== links.length || links.length > 0 && links.filter(link => link.isCurrent).length !== 1) throw new TypeError("Locale alternatives require unique locales and one current route");
  return { label: text(row.label, "locale.label"), links };
}

export function runtimeNewsletter(value: unknown): Pick<NewsletterBandProps, "action" | "name" | "emailLabel" | "submitLabel" | "pendingLabel" | "sentMessage" | "failedMessage" | "privacyNote" | "hint"> {
  const row = record(value, "newsletter", ["action", "name", "emailLabel", "submitLabel", "pendingLabel", "sentMessage", "failedMessage", "privacyNote", "hint"]);
  const action = destination(row.action, "newsletter.action");
  if (!action.startsWith("/")) throw new TypeError("Newsletter action must stay same-origin");
  const name = row.name === undefined ? undefined : text(row.name, "newsletter.name");
  if (name !== undefined && /\s/.test(name)) throw new TypeError("Newsletter name must be a form-data key");
  return { action, ...(name === undefined ? {} : { name }), emailLabel: text(row.emailLabel, "newsletter.emailLabel"), submitLabel: text(row.submitLabel, "newsletter.submitLabel"), pendingLabel: text(row.pendingLabel, "newsletter.pendingLabel"), sentMessage: text(row.sentMessage, "newsletter.sentMessage"), failedMessage: text(row.failedMessage, "newsletter.failedMessage"), ...(row.privacyNote === undefined ? {} : { privacyNote: text(row.privacyNote, "newsletter.privacyNote") }), ...(row.hint === undefined ? {} : { hint: text(row.hint, "newsletter.hint") }) };
}
