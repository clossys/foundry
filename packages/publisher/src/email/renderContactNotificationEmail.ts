import { escapeHtml } from "./internal/escapeHtml.js";

/**
 * Contact notification email renderer.
 *
 * Turns one validated contact submission into the `{ html, text }` pair a
 * notification email carries. The values are untrusted form input, so the
 * output is built to hold them as inert text and nothing else:
 *
 * - Every value, and every label, passes through `escapeHtml` exactly once,
 *   into element text content only. No value is ever placed in an attribute.
 * - The markup is fixed, hand-built table markup with inline styles. It has no
 *   anchors, images, scripts, comments or remote resources, so nothing that was
 *   submitted becomes a link, and an address or URL in a field is plain text.
 * - Message line breaks become `<br>` after escaping.
 * - Anything ambiguous is refused with a `TypeError` that names the field and
 *   never echoes its value: a non-string, or a control character. The control
 *   rule is the contact handler's own: any Cc character in any field, except
 *   that `message` permits tab, LF and CR, and the single-line fields (and the
 *   labels) additionally refuse U+2028 and U+2029.
 *
 * Not done here: no mail-client rendering check, no deliverability guarantee,
 * no link handling.
 */

/** The fields a contact notification carries. Values are used exactly as given. */
export interface ContactNotificationInput {
  readonly topic: string;
  readonly name: string;
  readonly email: string;
  readonly message: string;
  /** Optional. Absent (or `undefined`) omits the phone row and line. */
  readonly phone?: string;
}

/** Row labels. Each is escaped and single-line checked like a field value. */
export interface ContactNotificationLabels {
  /** @default "Topic" */
  readonly topic?: string;
  /** @default "Name" */
  readonly name?: string;
  /** @default "Email" */
  readonly email?: string;
  /** @default "Phone" */
  readonly phone?: string;
  /** @default "Message" */
  readonly message?: string;
}

export interface RenderContactNotificationEmailOptions {
  readonly labels?: ContactNotificationLabels;
}

export interface ContactNotificationEmail {
  readonly html: string;
  readonly text: string;
}

const FIELD_NAMES = ["topic", "name", "email", "phone", "message"] as const;
type FieldName = (typeof FIELD_NAMES)[number];

const DEFAULT_LABELS: Readonly<Record<FieldName, string>> = {
  topic: "Topic",
  name: "Name",
  email: "Email",
  phone: "Phone",
  message: "Message",
};

// Built from escapes: a raw U+2028 or U+2029 inside a regex literal is a
// syntax error, and raw control characters would be invisible in review.
const CONTROL_SINGLE_LINE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");
const CONTROL_MESSAGE = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]");

function fail(what: string, problem: string): never {
  throw new TypeError(`renderContactNotificationEmail: ${what} ${problem}`);
}

/** Only own properties are read, so an inherited value never reaches the message. */
function readOwn(record: object, key: string): unknown {
  return Object.hasOwn(record, key) ? (record as Record<string, unknown>)[key] : undefined;
}

function requireString(what: string, value: unknown, control: RegExp): string {
  if (typeof value !== "string") fail(what, "must be a string");
  if (control.test(value)) fail(what, "must not contain a control character");
  return value;
}

function resolveLabels(options: unknown): Readonly<Record<FieldName, string>> {
  if (options === undefined) return DEFAULT_LABELS;
  if (typeof options !== "object" || options === null) fail("options", "must be an object");
  const supplied = readOwn(options, "labels");
  if (supplied === undefined) return DEFAULT_LABELS;
  if (typeof supplied !== "object" || supplied === null) fail("labels", "must be an object");
  const labels = { ...DEFAULT_LABELS };
  for (const field of FIELD_NAMES) {
    const value = readOwn(supplied, field);
    if (value === undefined) continue;
    labels[field] = requireString(`labels.${field}`, value, CONTROL_SINGLE_LINE);
  }
  return labels;
}

const CELL = "padding:6px 12px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;";
const HEAD_STYLE = `${CELL}font-weight:bold;text-align:left;vertical-align:top;`;
const VALUE_STYLE = `${CELL}vertical-align:top;`;
const MESSAGE_STYLE = `${CELL}white-space:pre-wrap;`;

function htmlRow(label: string, value: string): string {
  return `<tr><th scope="row" style="${HEAD_STYLE}">${escapeHtml(label)}</th><td style="${VALUE_STYLE}">${escapeHtml(value)}</td></tr>`;
}

/**
 * Renders the notification email for one contact submission. Throws a
 * `TypeError` naming the offending field or label, never its value.
 */
export function renderContactNotificationEmail(
  input: ContactNotificationInput,
  options?: RenderContactNotificationEmailOptions,
): ContactNotificationEmail {
  if (typeof input !== "object" || input === null || Array.isArray(input)) fail("input", "must be an object");
  const labels = resolveLabels(options);

  const topic = requireString("topic", readOwn(input, "topic"), CONTROL_SINGLE_LINE);
  const name = requireString("name", readOwn(input, "name"), CONTROL_SINGLE_LINE);
  const email = requireString("email", readOwn(input, "email"), CONTROL_SINGLE_LINE);
  const rawPhone = readOwn(input, "phone");
  const phone = rawPhone === undefined ? undefined : requireString("phone", rawPhone, CONTROL_SINGLE_LINE);
  const message = requireString("message", readOwn(input, "message"), CONTROL_MESSAGE);

  const textLines = [`${labels.topic}: ${topic}`, `${labels.name}: ${name}`, `${labels.email}: ${email}`];
  if (phone !== undefined) textLines.push(`${labels.phone}: ${phone}`);
  textLines.push("", message);

  const rows = [htmlRow(labels.topic, topic), htmlRow(labels.name, name), htmlRow(labels.email, email)];
  if (phone !== undefined) rows.push(htmlRow(labels.phone, phone));

  const html = [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body style="margin:0;padding:16px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tbody>',
    ...rows,
    `<tr><th scope="row" colspan="2" style="${HEAD_STYLE}">${escapeHtml(labels.message)}</th></tr>`,
    `<tr><td colspan="2" style="${MESSAGE_STYLE}">${escapeHtml(message).replace(/\r\n|\r|\n/g, "<br>")}</td></tr>`,
    "</tbody></table>",
    "</body></html>",
  ].join("");

  return { html, text: textLines.join("\n") };
}
