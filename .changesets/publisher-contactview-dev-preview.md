---
publisher: minor
---

`ContactView` accepts an optional `devPreview` prop (`"idle"`, `"submitting"`, `"accepted"`, `"invalid"`, `"rate-limited"` or `"unavailable"`, exported as the type `ContactViewDevPreview`) that pins the view to one state without a real send: it is inert, so submitting never calls `onSubmit`. A value outside that set throws a `RenderError` naming `devPreview`, never the value. The site template's `/contact?preview=<state>` selects a state only when `SITE_TARGET` is not `production`; production must not pass `devPreview`.
