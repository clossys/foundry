---
publisher: minor
---

Adds `renderContactNotificationEmail(input, options?)` to `@clossys/publisher/email`, returning `{ html, text }` for a contact submission (#1516). Every value is HTML-escaped exactly once into inert text: no links, images, scripts or remote resources, and a non-string or control character is refused with a `TypeError` that names the field, never the value. `createContactHandler` now delivers both bodies, so `ContactOutboundMessage.html` changes from `html?: never` to a required `string`; the `text` body is unchanged, and headers, cc, bcc and attachments stay refused.
