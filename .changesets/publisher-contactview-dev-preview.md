---
publisher: minor
---

`ContactView` accepts an optional `devPreview` prop (`"idle"`, `"submitting"`, `"accepted"`, `"invalid"`, `"rate-limited"` or `"unavailable"`, exported as the type `ContactViewDevPreview`) that pins the view to one state without a real send: it is inert, so submitting does not call `onSubmit`. A value outside that set throws a `RenderError` that names `devPreview` and omits the value. The site template's `/contact?preview=<state>` selects a state when `SITE_TARGET` is not `production` and is ignored on production, where a page must not pass `devPreview`.
