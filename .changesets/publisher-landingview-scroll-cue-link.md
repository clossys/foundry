---
publisher: minor
---

The `LandingView` peek cue is now a real link to the first band. When there is no band, it links to the call-to-action band. It is a circular icon button on the target band's ground, fixed to the bottom of the browser window so it does not slide with the page, and it fades out as the page scrolls. The new `cueLabel` prop sets its accessible name (default "Scroll to next section"). A blank `cueLabel` throws. With no target, no cue renders. Smooth scrolling applies only when motion is allowed. Band sections get a scroll margin equal to their top padding, so with the frame's `scroll-padding-top` a band lands flush under a sticky header. `styles/preview.css` is regenerated.
