---
publisher: minor
---

A sectioned view document can set `sectionGroundRhythm: "view"`, and its resolved document then lists the sections that omitted `ground` in `viewGrounds`, for the rendering view to assign.
`planLandingViewGrounds` returns the grounds a `LandingView` renders, band by band, with any neighbouring bands left on the same ground, so a consumer can test the page's ground sequence.
