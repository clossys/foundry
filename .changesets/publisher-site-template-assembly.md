---
publisher: minor
---

The site template routes `/` to `LandingView`, `/contact` to `ContactView` with a server action that sends through Messenger's Resend adapter, and `/terms` and `/privacy` to `LegalView` behind the production legal gate, with error and not-found pages that render every word from copy ids (#1516).
