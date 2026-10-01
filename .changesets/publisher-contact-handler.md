---
publisher: minor
---

`@clossys/publisher/web` exports `createContactHandler`, a framework-neutral, server-only handler that validates a contact submission, refuses control characters, honours a honeypot field, consults an injected rate limiter and delivers a plain-text email through an injected delivery port, returning status codes.
