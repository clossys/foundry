---
publisher: minor
---

Add `buildShareCard` to `@clossys/publisher/web`, which builds the site share card as a React element of exactly the `OG_SHARE_CARD_SPEC` size, coloured only from Designer role tokens, together with the `shareCard` record `buildSiteMetadata` accepts, and throws `ShareCardError` for input it cannot build a card from.
