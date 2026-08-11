# @vespeneventures/comms-resend

Strict Resend transport and webhook normalization for
`@vespeneventures/comms`. It maps a finished `EmailMessage` to the provider,
forwards its stable id as the provider idempotency key, returns explicit
acceptance evidence, verifies the exact raw Svix body, and maps signed provider
events. It never reads environment variables or turns failure into success.

```bash
npm install @vespeneventures/comms-resend
```

## Outbound email

```ts
import { createResendAdapter } from "@vespeneventures/comms-resend";

const adapter = createResendAdapter({
  apiKey: () => process.env.RESEND_API_KEY,
  timeoutMs: 8_000,
});
```

Pass `adapter` as the `email` entry of `createCommunicationDispatcher`, or
call `deliver` directly with a validated `EmailMessage`. `ResendAdapterConfig`
requires an explicit `ResendApiKey` value/resolver; it has no hidden
environment fallback and no fail-silent mode.

The adapter forwards `EmailMessage.id` as Resend's idempotency key. The key
must be 1–256 characters, must identify one exact payload, and is only a
provider-window defense. A durable dispatch ledger remains required for
long-lived deduplication and recovery.

`headers`, `cc`, `bcc`, `replyTo`, HTML/text bodies and attachments map
directly. Provider tags are normalized at this boundary to ASCII letters,
numbers, underscores and dashes, with empty fallbacks and a 256-character
bound. Two names that collide after normalization fail explicitly rather than
silently losing correlation. Host-only `EmailMessage.context` is never
transmitted.

Provider and configuration failures throw `ResendCommunicationError`, a
provider-specific subclass of the core `CommunicationDeliveryError`; a message
that violates the core contract throws `CommunicationValidationError` before
the SDK is constructed. Configuration and validation failures are not
retryable; timeouts, network failures, rate limits and server errors are
retryable. A timeout does not prove rejection—the request may have been
accepted—so preserve the same id and payload when retrying.

## Webhooks

```ts
import { verifyResendWebhook } from "@vespeneventures/comms-resend";

const verified = await verifyResendWebhook({
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? "",
  payload: await request.text(),
  headers: {
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
  },
});

if (verified.kind === "delivery") {
  await durableDeliveryLedger.apply(verified.event);
}
```

Verification must receive the exact raw body. Parse or mutate nothing before
calling it. Verification is local and does not require a sending API key. The
result is one of:

- `delivery`: a provider-neutral `DeliveryEvent` for sent, scheduled,
  delivered, delayed, bounced, complained, failed, suppressed, opened or
  clicked lifecycle events.
- `inbound`: a privacy-minimal `InboundCommunicationEvent` for
  `email.received`. It contains only provider ids and time; the host decides
  whether and how to retrieve/store message content.
- `ignored`: a correctly signed event this package does not own. Hosts should
  acknowledge ignored and duplicate events so providers do not retry them.

The host route owns HTTP status mapping and storage. Fail closed when the
webhook secret or durable ledger is unavailable; return a retryable server
error when durable apply fails; never substitute the in-memory test fake in a
deployed endpoint. Endpoint registration, event subscriptions, credentials,
domains and sender identities remain provider/dashboard settings owned by the
deploying host.

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `createResendAdapter(config)` | function | Creates the strict outbound email `CommunicationAdapter`. |
| `verifyResendWebhook(input)` | function | Verifies the exact raw Svix body and returns a mapped signed event. |
| `ResendCommunicationError` | class | Provider-specific normalized error with retryability and optional status code. |
| `ResendAdapterConfig` / `ResendApiKey` | types | Explicit outbound credential, timeout and client-construction contract. |
| `ResendClient` / `ResendClientFactory` / `ResendWebhookClientFactory` / `ResendEmailPayload` / `ResendApiError` | types | Narrow SDK seams used for testing and alternate construction. |
| `VerifyResendWebhookInput` / `ResendWebhookHeaders` | types | Raw-body webhook verification input. |
| `ResendWebhookEvent` | type | Delivery, inbound or ignored signed event result. |

## Requirements

Node 20+. ESM only. Runtime dependencies: `@vespeneventures/comms` and the
official `resend` SDK.

## Licence

MIT
