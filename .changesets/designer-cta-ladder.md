---
designer: minor
---

Add a call-to-action ladder: Button gains `tonal` (T3, a neutral tonal fill) and `quiet` (T4, a chevron text button with a 44px tap block, a hover underline and a 2px chevron nudge that stays still under reduced motion), both drawn per `ground` (`base`, `sunken`, `inverse`). Add the `IconButton` atom (circle or square, 36px or 44px, `label` required) and server-safe `iconButtonClassName`. Add five brandable tokens, `--color-control-tonal`, `-tonal-hover`, `-tonal-inverse`, `-tonal-inverse-hover` and `--color-control-quiet`, with contrast pairs; a brand file that sets every other brandable token now reports these five as uncovered until it sets them.
