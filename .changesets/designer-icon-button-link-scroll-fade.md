---
designer: minor
---

`iconButtonLinkClassName(ground)` styles an icon-only link as a circular button: a 44px tap target from `--ui-layout-tap-target`, a 1px edge, and token surfaces for `base` and `inverse` grounds. Hover and pressed states change the surface and edge. Focus-visible adds the accent outline over a halo in the link's own surface, and transitions turn off under reduced motion. A new `scroll-cue` utility fixes an element to the bottom of the browser window, clear of the safe-area inset, and fades it out over the first 132px of page scroll with a scroll-driven animation, then hides it, which also removes it from the tab order. Under reduced motion it hides in one step instead of fading. Engines without scroll-driven animation get no fixed placement: the element scrolls away with the page.
