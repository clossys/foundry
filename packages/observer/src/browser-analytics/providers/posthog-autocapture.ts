/**
 * Autocapture rules for the PostHog adapter's `before_send` hook (C-66).
 *
 * The hook never trusts the SDK's selector. From the element data the SDK
 * attaches (its elements chain or its elements list) it finds the target,
 * the first element, and accepts the event only when the target opted in by
 * the one allowlisted attribute, is not a form field, and neither it nor any
 * ancestor in that data carries a private marker the data shows. The event
 * is then rebuilt from the target's tag and that attribute alone, so no
 * element text, link, class, id, position or ancestor can leave.
 *
 * Pure functions of their arguments.
 */

import { MAX_PROPERTY_STRING_LENGTH } from "../sanitize.js";
import { ANALYTICS_ELEMENT_ATTRIBUTE } from "./posthog-options.js";

/** One element of the SDK's element data: its tag and the attributes the data shows, keyed as the SDK keys them. */
export interface ChainElement {
  tag: string;
  attributes: ReadonlyMap<string, string>;
}

const ATTRIBUTE_PREFIX = "attr__";
const OPT_IN_KEY = `${ATTRIBUTE_PREFIX}${ANALYTICS_ELEMENT_ATTRIBUTE}`;
const OPT_IN_VALUE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const TARGET_TAG = /^[a-z][a-z0-9]*$/;
const ATTRIBUTE_KEY = /([A-Za-z_][A-Za-z0-9_-]*)="/y;
const FORM_FIELD_TAGS: ReadonlySet<string> = new Set(["input", "textarea", "select"]);

/** Longest chain string the hook will parse. */
const MAX_CHAIN_LENGTH = 100_000;

/** The event types autocapture passes. */
export const AUTOCAPTURE_EVENT_TYPES: readonly string[] = Object.freeze(["click", "submit"]);

/**
 * Parses the SDK's chain grammar: elements joined by `;`, each a tag with
 * optional `.class` parts, then `:` and `key="value"` pairs written back to
 * back. A quote inside a value is written `\"`. Returns `null` for anything
 * that does not parse.
 */
export function parseElementsChain(chain: unknown): ChainElement[] | null {
  if (typeof chain !== "string" || chain === "" || chain.length > MAX_CHAIN_LENGTH) return null;
  const elements: ChainElement[] = [];
  let position = 0;
  // The next `:` at or after `position`, found lazily and reused, so a long chain is scanned once.
  let colon = -2;
  for (;;) {
    // The tag runs to the first `.`, `:` or `;`.
    let end = position;
    while (end < chain.length && chain[end] !== "." && chain[end] !== ":" && chain[end] !== ";") end += 1;
    const tag = chain.slice(position, end);
    if (tag === "") return null;
    position = end;
    // A tag followed directly by `:` has no class list, so what follows must be the attribute pairs.
    if (chain[position] === ":") {
      ATTRIBUTE_KEY.lastIndex = position + 1;
      if (!ATTRIBUTE_KEY.test(chain)) return null;
    }

    // Classes and attributes: attributes start at the first `:` followed by `key="` before this element's end.
    const semicolon = chain.indexOf(";", position);
    const limit = semicolon === -1 ? chain.length : semicolon;
    let start = -1;
    for (;;) {
      if (colon === -2 || (colon !== -1 && colon < position)) colon = chain.indexOf(":", position);
      if (colon === -1 || colon >= limit) break;
      ATTRIBUTE_KEY.lastIndex = colon + 1;
      if (ATTRIBUTE_KEY.test(chain)) {
        start = colon;
        break;
      }
      colon = chain.indexOf(":", colon + 1);
    }
    const attributes = new Map<string, string>();
    if (start !== -1) {
      position = start + 1;
      for (;;) {
        ATTRIBUTE_KEY.lastIndex = position;
        const key = ATTRIBUTE_KEY.exec(chain);
        if (key === null) return null;
        const name = key[1]!;
        if (attributes.has(name)) return null;
        position += key[0].length;
        let value = "";
        let closed = false;
        while (position < chain.length) {
          const char = chain[position]!;
          if (char === "\\" && chain[position + 1] === '"') {
            value += '"';
            position += 2;
          } else if (char === '"') {
            position += 1;
            closed = true;
            break;
          } else {
            value += char;
            position += 1;
          }
        }
        if (!closed) return null;
        attributes.set(name, value);
        if (position >= chain.length || chain[position] === ";") break;
      }
    } else {
      position = semicolon === -1 ? chain.length : semicolon;
    }
    elements.push({ tag, attributes });
    if (position >= chain.length) return elements;
    if (chain[position] !== ";") return null;
    position += 1;
  }
}

/** Reads the SDK's legacy elements list: objects with `tag_name` and `attr__*` keys. */
export function elementsFromList(list: unknown): ChainElement[] | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const elements: ChainElement[] = [];
  for (const entry of list as unknown[]) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    const tag = record.tag_name;
    if (typeof tag !== "string" || tag === "") return null;
    const attributes = new Map<string, string>();
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith(ATTRIBUTE_PREFIX) && typeof value === "string") attributes.set(key, value);
    }
    elements.push({ tag, attributes });
  }
  return elements;
}

function carriesPrivateMarker(element: ChainElement): boolean {
  const { attributes } = element;
  if (attributes.has(`${ATTRIBUTE_PREFIX}data-private`) || attributes.has(`${ATTRIBUTE_PREFIX}data-consent-banner`)) return true;
  if (attributes.get(`${ATTRIBUTE_PREFIX}type`)?.toLowerCase() === "password") return true;
  return attributes.get(`${ATTRIBUTE_PREFIX}autocomplete`)?.toLowerCase().startsWith("cc-") === true;
}

/** What an accepted autocapture event keeps: two strings, both rebuilt here. */
export interface AutocaptureResult {
  eventType: string;
  elementsChain: string;
}

/**
 * Decides one `$autocapture` event from the SDK's properties. Returns the
 * rebuilt properties, or `null` to drop the event.
 */
export function rebuildAutocapture(sdkProperties: Readonly<Record<string, unknown>>): AutocaptureResult | null {
  const eventType = sdkProperties.$event_type;
  if (typeof eventType !== "string" || !AUTOCAPTURE_EVENT_TYPES.includes(eventType)) return null;

  const chain = sdkProperties.$elements_chain;
  const elements = chain !== undefined ? parseElementsChain(chain) : elementsFromList(sdkProperties.$elements);
  if (elements === null || elements.length === 0) return null;

  const target = elements[0]!;
  if (!TARGET_TAG.test(target.tag) || FORM_FIELD_TAGS.has(target.tag) || target.attributes.has(`${ATTRIBUTE_PREFIX}contenteditable`)) {
    return null;
  }
  if (elements.some(carriesPrivateMarker)) return null;

  const value = target.attributes.get(OPT_IN_KEY);
  if (value === undefined || !OPT_IN_VALUE.test(value)) return null;

  const elementsChain = `${target.tag}:${OPT_IN_KEY}="${value}"`;
  if (elementsChain.length > MAX_PROPERTY_STRING_LENGTH) return null;
  return { eventType, elementsChain };
}
