---
publisher: minor
---

A `content-section` action takes an optional `emphasis` (`primary` or `secondary`, the default), and the section an optional `footnote` (`{ text, link? }`, one link at most). Validation refuses a third action, a second primary, an unknown emphasis and a malformed footnote. In-section actions now render as full-size buttons on every site (a filled primary, an outline secondary at the same size); the text-link rendering is removed. `checkSectionVariety` warns on a second band holding a primary action. The content catalog shows both buttons and a footnote.
