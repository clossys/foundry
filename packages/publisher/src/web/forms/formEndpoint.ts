/**
 * The submission endpoint `clossys publish --install --next` installs for each form a publication
 * records (`outputs.forms`, `../../content-map/outputs.ts`): `api/forms/<id>/route.ts` exports
 * `POST = createFormEndpoint({ form }).POST`.
 *
 * Server only. A request passes, in order, the media type (JSON or urlencoded, else 415), the
 * byte cap (the declared length and the bytes actually read, else 413), parsing (else 400), the
 * honeypot (a filled one answers `accepted` and delivers nothing), server-side validation of
 * every declared field (else 422 with per-field codes), the rate-limit hook (else 429) and the
 * delivery target. The target is read from the environment variable the record NAMES, at request
 * time; a missing or non-https target, or a failed delivery, answers 503. Nothing is retried.
 *
 * Responses carry codes only: never the submitted values, never the target. Only declared fields
 * are read and forwarded; every other key is ignored.
 */
import { checkPublicationOutputs, type PublicationForm, type PublicationFormField } from "../../content-map/outputs.js";
import { createMemoryRateLimiter } from "../contact/memoryRateLimiter.js";
import type { ContactRateLimiter } from "../contact/types.js";

export type FormFieldCode = "required" | "not-a-string" | "too-long" | "control-character" | "invalid-email" | "not-an-option";
export interface FormFieldIssue { readonly name: string; readonly code: FormFieldCode }
export interface FormEndpointOptions {
  readonly form: PublicationForm;
  /** Where the target variable is read; defaults to `process.env`, read per request. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The rate-limit hook; defaults to an in-process limiter of 5 submissions per key per minute. */
  readonly limiter?: ContactRateLimiter;
  /** The delivery fetch; defaults to the global `fetch`. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** The client key of a request; defaults to the first `x-forwarded-for` address, else `anonymous`. */
  readonly clientKey?: (request: Request) => string;
}
export interface FormEndpoint { POST(request: Request): Promise<Response> }

const MEDIA = new Set(["application/json", "application/x-www-form-urlencoded"]);
// C0 controls and DEL; a message may keep tab and line breaks.
const CONTROL = /[\u0000-\u001f\u007f]/;
const MESSAGE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function readCapped(request: Request, cap: number): Promise<string | undefined> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { await reader.cancel().catch(() => undefined); return undefined; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function parse(media: string, text: string): Record<string, unknown> | undefined {
  if (media === "application/json") {
    try {
      const value: unknown = JSON.parse(text);
      return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    } catch { return undefined; }
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(text)) if (!Object.hasOwn(out, key)) out[key] = value;
  return out;
}

function validate(field: PublicationFormField, raw: unknown): { issue?: FormFieldCode; value?: string } {
  if (raw === undefined || raw === "") return field.required ? { issue: "required" } : {};
  if (typeof raw !== "string") return { issue: "not-a-string" };
  const value = raw.trim();
  if (!value) return field.required ? { issue: "required" } : {};
  if ((field.type === "message" ? MESSAGE_CONTROL : CONTROL).test(value)) return { issue: "control-character" };
  if ([...value].length > field.maxLength) return { issue: "too-long" };
  if (field.type === "email" && !EMAIL.test(value)) return { issue: "invalid-email" };
  if (field.type === "topic" && !(field.options ?? []).includes(value)) return { issue: "not-an-option" };
  return { value };
}

function target(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch { return undefined; }
}

const defaultClientKey = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || "anonymous";

/** Build the endpoint for one recorded form; a malformed form record throws when the route module loads. */
export function createFormEndpoint(options: FormEndpointOptions): FormEndpoint {
  const issues = checkPublicationOutputs({ forms: [options.form] });
  if (issues.length) throw new TypeError(`createFormEndpoint: ${issues.join("; ")}`);
  const form = options.form;
  const limiter = options.limiter ?? createMemoryRateLimiter({ limit: 5, windowMs: 60_000, now: () => Date.now() });
  const clientKey = options.clientKey ?? defaultClientKey;
  return {
    async POST(request: Request): Promise<Response> {
      try {
        const media = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
        if (!MEDIA.has(media)) return reply(415, { status: "unsupported-media-type" });
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (!Number.isFinite(declared) || declared > form.maxBytes) return reply(413, { status: "too-large" });
        const text = await readCapped(request, form.maxBytes);
        if (text === undefined) return reply(413, { status: "too-large" });
        const body = parse(media, text);
        if (!body) return reply(400, { status: "malformed" });
        const trap = Object.hasOwn(body, form.honeypot) ? body[form.honeypot] : undefined;
        if (trap !== undefined && trap !== "") return reply(200, { status: "accepted" });
        const fields: Record<string, string> = {};
        const invalid: FormFieldIssue[] = [];
        for (const field of form.fields) {
          const result = validate(field, Object.hasOwn(body, field.name) ? body[field.name] : undefined);
          if (result.issue) invalid.push({ name: field.name, code: result.issue });
          else if (result.value !== undefined) fields[field.name] = result.value;
        }
        if (invalid.length) return reply(422, { status: "invalid", fields: invalid });
        if (!await limiter.check(clientKey(request))) return reply(429, { status: "rate-limited" });
        const env = options.env ?? ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {});
        const url = target(env, form.targetEnv);
        if (!url) return reply(503, { status: "unavailable" });
        const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
        const delivered = await send(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ form: form.id, kind: form.kind, fields }), redirect: "error" });
        return delivered.ok ? reply(200, { status: "accepted" }) : reply(503, { status: "unavailable" });
      } catch {
        return reply(503, { status: "unavailable" });
      }
    },
  };
}
