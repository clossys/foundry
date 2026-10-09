---
publisher: minor
---

Breaking: the single-screen hero view `LandingView` is renamed `HeroView`, with its types renamed to `HeroViewProps`, `HeroViewGround` and `HeroViewFooter`; replace the import and the element name to keep the same page.
`LandingView` is now a sectioned landing page: a first-screen hero block with an optional peek and backdrop, the document's other sections as full-bleed bands in one centred column, each band one Designer `ContentSection`, content placed into a section through `afterSection`, and a closing call to action on the inverse ground.
