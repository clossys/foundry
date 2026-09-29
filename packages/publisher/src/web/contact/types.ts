/**
 * Contact submission handler — type-level contract.
 *
 * `createContactHandler(config)` is a framework-neutral, server-only handler
 * for a public contact form. It returns `{ handle(submission, { clientKey }) }`,
 * where `submission` is whatever the caller's framework parsed out of a request
 * body and `clientKey` is an opaque string the caller derived from that request.
 * It has no knowledge of HTTP, routing, cookies, or any rendering layer: it takes
 * values in and returns a {@link ContactResult} out.
 *
 * It must only ever be imported from server code. Nothing in this module is
 * meant to reach a client bundle; the delivery port it calls sends email.
 *
 * ## The invariant
 *
 * Only a well-formed, capped, control-free, non-honeypot submission that a
 * working limiter allows is delivered — exactly once, as plain text, to
 * recipients, from a sender, under a subject that all come from config and never
 * from the submission. A stub delivery never delivers in production: a handler
 * whose target is `"production"` refuses to be constructed with one.
 *
 * Every path that cannot prove the invariant holds fails closed: it delivers
 * nothing and returns `unavailable` (or, for the honeypot, `accepted`).
 * `handle()` never throws and never rejects.
 *
 * ## Explicit non-goals
 *
 * - **Not bot detection beyond the honeypot.** No CAPTCHA, no scoring, no
 *   fingerprinting, no content filtering. A bot that leaves the honeypot empty
 *   and submits valid input is treated exactly like a person.
 * - **Not a distributed limiter.** `createMemoryRateLimiter` keeps state in one
 *   process. Several instances (or serverless invocations) each hold their own
 *   window, so the effective limit multiplies. Inject a shared
 *   {@link ContactRateLimiter} for anything else.
 * - **Not a check on the caller's client key.** The handler does not verify that
 *   `clientKey` identifies a real client; see {@link ContactHandleOptions}.
 * - **Not a deliverability guarantee.** `accepted` means the delivery port's
 *   promise resolved — typically provider acceptance — not that a message
 *   reached an inbox. Nothing is retried.
 * - **Not timing-equalized.** A honeypot hit skips delivery and so may answer
 *   faster than a real acceptance. Equalizing response time is the caller's
 *   concern if it matters to them.
 *
 * ## Results carry codes only
 *
 * A {@link ContactResult} never contains English text and never echoes any part
 * of the input. Mapping codes to words is the rendering layer's job.
 *
 * ## Relationship to Messenger
 *
 * Publisher imports no Messenger code. {@link ContactDelivery} is a local port
 * shaped so that a Messenger email adapter is assignable to it without a wrapper
 * (see that type for why that holds and what it deliberately refuses).
 */

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/** The declared submission fields, in the fixed order issues are reported. */
export type ContactFieldName = "topic" | "name" | "email" | "phone" | "message";

/**
 * The shape an honest form produces. Documentation for callers and tests only:
 * `handle()` accepts `unknown`, because a request body is untrusted and a
 * non-string value must surface as a per-field `not-a-string`, not a crash.
 *
 * The honeypot field (default name `"website"`, see
 * {@link ContactHandlerConfig.honeypotField}) is also present on a real form,
 * rendered hidden and left empty. It is not part of this interface because its
 * name is configurable.
 *
 * Reading rules the implementation follows:
 * - A `submission` that is not a non-null, non-array object is read as an empty
 *   record, so every required field reports `required`.
 * - Only own properties are read (`Object.hasOwn`); inherited properties are
 *   absent. Keys other than the five declared fields and the honeypot field are
 *   ignored — never read further, never copied into the outbound message.
 * - An absent or `undefined` field is missing. Any other non-string value,
 *   including `null`, is `not-a-string`.
 */
export interface ContactSubmission {
  /** One of the configured topic ids, matched exactly (no trim, no case folding). */
  readonly topic: string;
  /** Multi-line free text. The only field permitted to contain line breaks and tabs. */
  readonly message: string;
  /** Single line. Placed only in the plain-text body. */
  readonly name: string;
  /** Single line. Placed only in the plain-text body and as the sole `replyTo`. */
  readonly email: string;
  /** Optional single line. `""` or whitespace-only is treated as absent. */
  readonly phone?: string;
}

// ---------------------------------------------------------------------------
// Result codes
// ---------------------------------------------------------------------------

/**
 * Which codes each field can report. Per-field check order is fixed and stops
 * at the first failure, so a field reports at most one code:
 *
 * 1. `not-a-string` — present but not a string. Distinct from `required` so a
 *    client bug (sending a number or an array) is not mistaken for a blank field.
 * 2. `too-long` — raw `String.prototype.length` (UTF-16 code units) exceeds the
 *    field's cap. Checked before any scan, so later checks cost at most the cap.
 * 3. `control-character` — see "Control characters" below. Its own code rather
 *    than `malformed`, because it is the header/line-injection refusal and a
 *    rendering layer may want to say so specifically.
 * 4. `required` — missing, or empty after `trim()`. (Never reported for `phone`.)
 * 5. Field shape: `unknown-topic` (topic is not exactly one of the configured
 *    ids) or `malformed` (email / phone shape, below).
 *
 * Control characters:
 * - Every field refuses Unicode general category Cc (U+0000–U+001F, U+007F,
 *   U+0080–U+009F), except that `message` permits TAB, LF and CR.
 * - The single-line fields (`topic`, `name`, `email`, `phone`) additionally
 *   refuse U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR.
 * - Bidirectional formatting characters (category Cf) are not refused: the
 *   message is plain text read by an operator, and display spoofing inside a
 *   body is out of scope.
 *
 * Email shape (`malformed`), deliberately conservative because the value becomes
 * a `replyTo` address: exactly one `@`; local part is a dot-atom of
 * `A–Z a–z 0–9 ! # $ % & ' * + / = ? ^ _ \` { | } ~ -` with no leading,
 * trailing or doubled dot and at most 64 characters; domain is two or more
 * dot-separated labels of `A–Z a–z 0–9 -`, each non-empty and not starting or
 * ending with `-`. Anything else — whitespace, quotes, `<>`, `,` or `;` (which
 * could turn one reply-to into an address list), non-ASCII — is `malformed`.
 * Internationalized addresses are a known, accepted refusal.
 *
 * Phone shape (`malformed`): only ASCII digits, space and `+ - ( ) . / # * x X`,
 * with at least one digit. Phone is informational; this only keeps it one
 * recognisable line.
 */
export interface ContactFieldCodeMap {
  readonly topic: "not-a-string" | "too-long" | "control-character" | "required" | "unknown-topic";
  readonly name: "not-a-string" | "too-long" | "control-character" | "required";
  readonly email: "not-a-string" | "too-long" | "control-character" | "required" | "malformed";
  readonly phone: "not-a-string" | "too-long" | "control-character" | "malformed";
  readonly message: "not-a-string" | "too-long" | "control-character" | "required";
}

/** Every code a single field can report. */
export type ContactFieldCode = ContactFieldCodeMap[ContactFieldName];

/**
 * One validation finding. Field-level issues pair a field with only the codes
 * that field can produce. The one submission-level issue is the total cap:
 * the sum of the raw lengths of whichever declared fields are strings (honeypot
 * and ignored keys excluded) exceeds `caps.total`. It is reported in addition
 * to any per-field issues, never instead of them.
 */
export type ContactFieldIssue =
  | { readonly [F in ContactFieldName]: { readonly field: F; readonly code: ContactFieldCodeMap[F] } }[ContactFieldName]
  | { readonly field: "submission"; readonly code: "too-long" };

/**
 * What `handle()` resolves to.
 *
 * - `accepted` — delivered once and the port resolved, or the honeypot was
 *   filled (nothing delivered). The two are indistinguishable by design.
 * - `invalid` — one or more issues, never empty, ordered `topic`, `name`,
 *   `email`, `phone`, `message`, then `submission`, at most one per target.
 * - `rate-limited` — the limiter returned exactly `false`.
 * - `unavailable` — the handler could not proceed safely: bad client key,
 *   limiter threw / rejected / returned a non-boolean, message id generation
 *   failed, or delivery threw / rejected. Deliberately one undifferentiated
 *   code toward the client; the cause goes to {@link ContactHandlerConfig.onUnavailable}.
 */
export type ContactResult =
  | { readonly status: "accepted" }
  | { readonly status: "invalid"; readonly fields: readonly [ContactFieldIssue, ...ContactFieldIssue[]] }
  | { readonly status: "rate-limited" }
  | { readonly status: "unavailable" };

export type ContactResultStatus = ContactResult["status"];

/**
 * Why a `handle()` call resolved `unavailable`, for operator observability only.
 * Codes only: no error object, message or input is ever passed, because a
 * provider error can echo the submitted reply-to address.
 */
export type ContactUnavailableReason =
  | "client-key"
  | "limiter-failed"
  | "limiter-non-boolean"
  | "message-id-failed"
  | "delivery-failed"
  | "internal-error";

// ---------------------------------------------------------------------------
// Client key boundary
// ---------------------------------------------------------------------------

/**
 * Per-call options.
 *
 * `clientKey` is an opaque string the caller derives from the request — a hashed
 * address, a session id, whatever its deployment trusts. It is the only thing
 * the limiter is keyed on, and it is passed to `limiter.check` verbatim (no
 * trimming, no hashing, no prefixing).
 *
 * The handler does **not** verify that it identifies a real client. A caller
 * that derives it from a spoofable header has a spoofable limit; a caller that
 * lets clients choose it has no limit. That is the caller's boundary, not this
 * handler's. It is deliberately a plain `string`, not a branded type: the brand
 * would prove only that someone cast it, which says nothing about where it came
 * from.
 *
 * Refused as `unavailable` (reason `client-key`) before anything else runs, with
 * zero limiter calls: `options` not an object; `clientKey` not a string, empty,
 * whitespace-only, or longer than {@link CONTACT_CLIENT_KEY_MAX_LENGTH}. The
 * length bound exists so an in-memory limiter's key storage stays bounded by
 * size, not just count. A missing key is a caller wiring error, not a client
 * error, hence `unavailable` rather than `invalid`.
 */
export interface ContactHandleOptions {
  readonly clientKey: string;
}

/** Maximum `clientKey` length in UTF-16 code units. */
export const CONTACT_CLIENT_KEY_MAX_LENGTH = 256;

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

/**
 * Injected limiter. `check(key)` is asked once per submission that passed
 * validation, and is a consuming check: answering `true` records one use.
 *
 * Return semantics, applied by the handler with strict identity:
 * - exactly `true`  ⇒ allowed; the handler proceeds (and a use is consumed).
 * - exactly `false` ⇒ denied; `rate-limited`. A denied check must not consume a
 *   use, or a client that keeps trying never recovers.
 * - anything else — a throw, a rejected promise, or a resolved/returned value
 *   that is not a boolean (`1`, `"true"`, `undefined`, an object) ⇒
 *   `unavailable` (reason `limiter-failed` / `limiter-non-boolean`). A limiter
 *   that cannot give a clear answer never allows.
 *
 * Atomicity under concurrent calls for the same key is the limiter's
 * responsibility; the handler awaits the answer and does nothing else with it.
 */
export interface ContactRateLimiter {
  check(key: string): boolean | Promise<boolean>;
}

/**
 * Options for the bundled in-memory limiter.
 *
 * Semantics: a sliding-window log per key. `check(key)` at time `t = now()`
 * first discards that key's recorded uses at or before `t - windowMs`; then, if
 * fewer than `limit` remain, records `t` and returns `true`, otherwise returns
 * `false` without recording. Guarantee: at most `limit` `true` answers for one
 * key in any interval of length `windowMs`. Memory is O(`maxKeys` × `limit`).
 *
 * Single-instance only — see the non-goals in this file's header.
 *
 * Construction throws (`RangeError` / `TypeError`) unless: `limit` and `maxKeys`
 * are positive safe integers, `windowMs` is a positive finite number, and `now`
 * is a function. At check time, a `now()` that returns a non-finite number makes
 * `check` throw (so the handler answers `unavailable`). A clock that moves
 * backwards never grants extra uses: recorded times later than `t` still count.
 */
export interface MemoryRateLimiterOptions {
  /** Uses allowed per key per window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Injected clock in milliseconds; tests pass a controllable one. */
  readonly now: () => number;
  /**
   * Maximum distinct keys tracked at once. Default 10_000.
   *
   * When a new key arrives at capacity, keys whose every use has expired are
   * pruned first; if the store is still full, the new key is denied (`false`).
   * Bounded memory is never bought by forgetting a live window, because
   * forgetting a window is the same as granting it.
   */
  readonly maxKeys?: number;
}

/** `createMemoryRateLimiter(options): ContactRateLimiter`. */
export type CreateMemoryRateLimiter = (options: MemoryRateLimiterOptions) => ContactRateLimiter;

// ---------------------------------------------------------------------------
// Delivery port and outbound message
// ---------------------------------------------------------------------------

/**
 * The one message shape this handler ever builds.
 *
 * Structurally assignable to Messenger's `EmailMessage`: every property here
 * exists there with a wider or equal type, and every `EmailMessage` property
 * absent here is optional there. The properties typed `?: never` make the
 * refusals explicit — this handler cannot produce HTML, extra headers, extra
 * recipients or attachments, and `never` is assignable to any optional type, so
 * compatibility is preserved.
 *
 * Provenance of every value:
 * - `from`, `to`, `subject` — config only, validated at construction.
 * - `replyTo` — exactly the submitted email, trimmed; the only place the email
 *   reaches a header. The name is never used as a display name, so no
 *   submitted text other than a shape-checked address reaches any header.
 * - `text` — the only place name, email, phone, topic and message appear.
 * - `id` — from {@link ContactHandlerConfig.createMessageId}.
 * - `event`, `category`, `channel` — fixed literals.
 *
 * `text` layout, exact (lines joined with `\n`; the `Phone:` line is omitted when
 * phone is absent; single-line values trimmed; message trimmed and with CRLF and
 * lone CR normalised to LF):
 *
 * ```text
 * Topic: <topic id>
 * Name: <name>
 * Email: <email>
 * Phone: <phone>
 *
 * <message>
 * ```
 *
 * No Unicode normalisation is applied to any value.
 */
export interface ContactOutboundMessage {
  readonly id: string;
  readonly event: "publisher.contact.submitted";
  readonly category: "contact";
  readonly channel: "email";
  readonly from: string;
  readonly to: readonly [string, ...string[]];
  readonly replyTo: readonly [string];
  readonly subject: string;
  readonly text: string;
  readonly html?: never;
  readonly headers?: never;
  readonly cc?: never;
  readonly bcc?: never;
  readonly attachments?: never;
}

/**
 * Local delivery port.
 *
 * `deliver` is declared as a function-typed property, not a method, on purpose:
 * under `strictFunctionTypes` that makes its parameter checked contravariantly
 * rather than bivariantly. Consequences:
 * - A Messenger `MessageAdapter<EmailMessage>` is assignable: its `deliver`
 *   accepts `EmailMessage`, and `ContactOutboundMessage` is assignable to
 *   `EmailMessage`; its `Promise<ProviderAcceptance>` is assignable to
 *   `Promise<unknown>`; its `channel` is `"email"`.
 * - A delivery whose `deliver` demands more than this handler supplies (for
 *   example a required `html`) is rejected at compile time instead of being
 *   accepted by method bivariance and handed a message it cannot handle.
 *
 * The handler calls `deliver` at most once per `handle()`, awaits it, ignores
 * the resolved value, and maps a throw or rejection to `unavailable`
 * (reason `delivery-failed`). It never retries.
 */
export interface ContactDelivery {
  readonly channel: "email";
  readonly deliver: (message: ContactOutboundMessage) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Stub delivery
// ---------------------------------------------------------------------------

/**
 * Brand carried by every stub delivery.
 *
 * Registered with `Symbol.for` rather than `Symbol()` so that two installed
 * copies of this package agree on it: a stub made by one copy is still
 * recognised by a handler from the other. The only effect of forging the brand
 * is that a production handler refuses the forged delivery — the safe direction.
 * The registry key deliberately omits the publishing scope, which lives only in
 * `package-scope.json`.
 *
 * Detection, in `createContactHandler`: if `config.target === "production"` and
 * `STUB_CONTACT_DELIVERY in config.delivery` (presence anywhere on the
 * prototype chain, regardless of value), construction throws. Known limit: a
 * caller who re-wraps a stub in a new object (`{ channel, deliver }`) strips the
 * brand; detection covers the stub as returned, not a caller's re-wrap.
 */
export const STUB_CONTACT_DELIVERY: unique symbol = Symbol.for("publisher.web.contact.stub-delivery");

/**
 * An in-memory delivery for tests and preview round-trips.
 *
 * `deliver` appends a frozen copy of the message to `deliveries` and resolves
 * `{ provider: "stub", messageId: message.id }`. `deliveries` is a read-only view
 * in call order. With any non-production target, a handler really does call
 * this stub — it "delivers" to itself — so a preview exercises the whole path
 * short of a provider. With the production target it is refused at construction.
 */
export type StubContactDelivery = ContactDelivery & {
  readonly [STUB_CONTACT_DELIVERY]: true;
  readonly deliveries: readonly ContactOutboundMessage[];
};

/** `createStubContactDelivery(): StubContactDelivery`. */
export type CreateStubContactDelivery = () => StubContactDelivery;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Deployment target the handler is constructed for. `"production"` is the only
 * value on which a stub delivery is refused. At runtime, any value outside this
 * union makes construction throw, so a typo such as `"prod"` cannot silently
 * admit a stub.
 */
export type ContactTarget = "production" | "preview" | "development" | "test";

/**
 * Length caps in UTF-16 code units. Every override must be a positive safe
 * integer or construction throws. Caps apply to the raw submitted value, before
 * trimming.
 */
export interface ContactCaps {
  readonly topic: number;
  readonly name: number;
  /** 254: the practical maximum length of a forward-path address. */
  readonly email: number;
  readonly phone: number;
  readonly message: number;
  /**
   * Sum of all declared string fields. The per-field defaults sum to 5494, so at
   * defaults this cap does not bind; it exists to bound an overridden set.
   */
  readonly total: number;
}

/** Defaults applied to any cap not overridden in {@link ContactHandlerConfig.caps}. */
export const CONTACT_DEFAULT_CAPS: Readonly<ContactCaps> = Object.freeze({
  topic: 100,
  name: 100,
  email: 254,
  phone: 40,
  message: 5000,
  total: 6000,
});

/**
 * Construction-time configuration. `createContactHandler` validates all of it
 * and throws synchronously on any violation; a handler that exists is correctly
 * configured.
 */
export interface ContactHandlerConfig {
  /**
   * Declared topic ids, non-empty. Each must be a non-empty string without
   * control characters, no longer than the topic cap, and unique.
   */
  readonly topics: readonly [string, ...string[]];
  /** Sender. Non-empty; no control characters (so no CR/LF header injection). */
  readonly from: string;
  /** Recipients, non-empty; each non-empty with no control characters. */
  readonly to: readonly [string, ...string[]];
  /** Fixed subject. Never derived from the submission. Non-empty after trim; no control characters. */
  readonly subject: string;
  readonly limiter: ContactRateLimiter;
  readonly delivery: ContactDelivery;
  readonly target: ContactTarget;
  /**
   * Name of the honeypot field. Default `"website"`. Must match
   * `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/` and must not equal a {@link ContactFieldName}.
   *
   * Filled means: present with any value other than `undefined`, `null` or `""`.
   * Whitespace and non-string values count as filled — no honest browser
   * produces them for a hidden empty input. Rendering the field hidden,
   * `tabindex="-1"` and `autocomplete="off"` is the form's job, not this module's.
   */
  readonly honeypotField?: string;
  /** Partial overrides of {@link CONTACT_DEFAULT_CAPS}. */
  readonly caps?: Partial<ContactCaps>;
  /**
   * Outbound message id source. Default `() => crypto.randomUUID()`. A throw or
   * a non-string / empty result ⇒ `unavailable` (reason `message-id-failed`),
   * nothing delivered.
   */
  readonly createMessageId?: () => string;
  /**
   * Optional observer, called once with the cause whenever `handle()` resolves
   * `unavailable`. Receives a code only. Its own throw is swallowed and never
   * changes the result.
   */
  readonly onUnavailable?: (reason: ContactUnavailableReason) => void;
}

export interface ContactHandler {
  /** Never throws, never rejects. See "Evaluation order" below. */
  handle(submission: unknown, options: ContactHandleOptions): Promise<ContactResult>;
}

/** `createContactHandler(config): ContactHandler`. Throws on invalid config. */
export type CreateContactHandler = (config: ContactHandlerConfig) => ContactHandler;

// ---------------------------------------------------------------------------
// Internal (not re-exported from any entry point)
// ---------------------------------------------------------------------------

declare const validatedBrand: unique symbol;

/**
 * A submission that passed every field check, with values trimmed (and the
 * message line-normalised) exactly as they will appear in the body. Type-only
 * brand: the message builder accepts only this, so it cannot be handed raw
 * input. Costs nothing at runtime.
 */
export type ValidatedContactSubmission = {
  readonly topic: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | undefined;
  readonly message: string;
} & { readonly [validatedBrand]: true };

// ---------------------------------------------------------------------------
// Evaluation order
// ---------------------------------------------------------------------------
//
// Construction (`createContactHandler`), synchronous, throws on any failure:
//   a. `target` is a ContactTarget; otherwise throw.
//   b. `target === "production"` and `STUB_CONTACT_DELIVERY in delivery` ⇒ throw.
//   c. `delivery.channel === "email"`, `deliver` and `limiter.check` are functions.
//   d. topics / from / to / subject / honeypotField / caps valid as documented.
//
// `handle(submission, options)` — each step fails closed, and a step that ends
// the call skips every later step:
//
//   1. Client key. Invalid options or clientKey ⇒ `unavailable`
//      (reason `client-key`). Zero limiter calls, zero deliveries.
//
//   2. Honeypot filled ⇒ `accepted`, zero deliveries, zero limiter calls.
//      Checked before validation and the limiter so that a filled honeypot is
//      `accepted` whatever else the submission holds (including a broken
//      limiter): the trap is only useful if a bot that fills it always gets
//      the same success answer and nothing downstream is exercised by it. An
//      empty honeypot changes nothing.
//
//   3. Validate the declared fields and the total cap ⇒ `invalid` with every
//      issue. Zero limiter calls, zero deliveries.
//      Validation runs before the limiter so a person correcting a typo does
//      not burn their allowance; validation cost is already bounded by the caps
//      (length is checked before any scan), so it needs no limiter in front of
//      it. The limiter protects delivery, not validation.
//
//   4. Limiter: `await limiter.check(clientKey)` exactly once.
//      throw / reject ⇒ `unavailable` (`limiter-failed`);
//      non-boolean   ⇒ `unavailable` (`limiter-non-boolean`);
//      `false`       ⇒ `rate-limited`;
//      `true`        ⇒ continue.
//      Zero deliveries on every non-`true` outcome.
//
//   5. Build the ContactOutboundMessage from the ValidatedContactSubmission and
//      config (id failure ⇒ `unavailable`, `message-id-failed`), then
//      `await delivery.deliver(message)` exactly once.
//      throw / reject ⇒ `unavailable` (`delivery-failed`); resolve ⇒ `accepted`.
//      No retry. The rate slot consumed in step 4 is not refunded.
//
// Any unexpected throw anywhere in `handle()` is caught and becomes `unavailable`.
