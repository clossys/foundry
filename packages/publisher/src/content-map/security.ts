import { isContentMapExternalHref } from "./check.js";

export interface SecurityTxtOptions {
  /** HTTPS, mailto or tel contact URIs, in the publisher's preferred order. */
  readonly contact: string | readonly string[];
  /** Explicit RFC 3339 timestamp. No current time or expiry date is invented. */
  readonly expires: string;
  readonly policy?: string;
  /** Standard security.txt field only; this does not configure site routing. */
  readonly preferredLanguages?: readonly string[];
}

const fieldText = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && value.trim() === value && !/[\s\u0000-\u001f\u007f]/.test(value) && !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value);

function httpsUri(value: unknown): value is string {
  return fieldText(value) && isContentMapExternalHref(value) && new URL(value).protocol === "https:";
}

function contactUri(value: unknown): value is string {
  if (!fieldText(value)) return false;
  if (httpsUri(value)) return true;
  let uri: URL;
  try { uri = new URL(value); } catch { return false; }
  if (uri.href !== value || uri.hash || uri.username || uri.password || uri.host) return false;
  if (uri.protocol === "mailto:") return /^[^@?]+@[^@?]+$/.test(uri.pathname);
  if (uri.protocol === "tel:") return /^\+?[0-9][0-9().-]*(?:;[a-zA-Z0-9-]+=[a-zA-Z0-9=.+-]+)*$/.test(uri.pathname) && !uri.search;
  return false;
}

function expiresTimestamp(value: unknown): value is string {
  if (!fieldText(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
    && Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59
    && (offsetHourText === undefined || Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59);
}

/** Deterministic RFC 9116 field serialization. Expires is supplied and validated
 * by the caller; freshness policy and serving the well-known URL belong to the
 * host. No endpoint, contact address, language or expiry is supplied implicitly. */
export function buildSecurityTxt(options: SecurityTxtOptions): string {
  const contacts = typeof options?.contact === "string" ? [options.contact] : options?.contact;
  if (!Array.isArray(contacts) || contacts.length === 0 || !contacts.every(contactUri)) throw new TypeError("At least one valid HTTPS, mailto or tel Contact URI is required");
  if (!expiresTimestamp(options.expires)) throw new TypeError("Expires must be an explicit valid RFC 3339 timestamp");
  if (options.policy !== undefined && !httpsUri(options.policy)) throw new TypeError("Policy must be a valid HTTPS URI");
  if (options.preferredLanguages !== undefined) {
    const languages = options.preferredLanguages;
    if (!Array.isArray(languages) || languages.length === 0 || !languages.every(language => {
      if (!fieldText(language)) return false;
      try { return Intl.getCanonicalLocales(language).length === 1; } catch { return false; }
    })) throw new TypeError("Preferred languages must be nonempty valid language tags");
  }
  return [
    ...contacts.map(contact => `Contact: ${contact}`), `Expires: ${options.expires}`,
    ...(options.policy === undefined ? [] : [`Policy: ${options.policy}`]),
    ...(options.preferredLanguages === undefined ? [] : [`Preferred-Languages: ${options.preferredLanguages.join(", ")}`]),
  ].join("\n") + "\n";
}
