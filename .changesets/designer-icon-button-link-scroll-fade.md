---
designer: minor
---

`iconButtonLinkClassName(ground)` styles an icon-only link as a circular button: a 44px tap target from `--ui-layout-tap-target`, a 1px edge, and token surfaces for `base` and `inverse` grounds. Hover and pressed states change the surface and edge. Focus-visible adds the accent outline over a halo in the link's own surface, and transitions turn off under reduced motion. A new `scroll-fade-out` utility fades an element over the first 33dvh of page scroll and then hides it, which also removes it from the tab order. Under reduced motion it hides in one step instead of fading. Engines without scroll-driven animation keep the element visible.
