/** View data for the Designer's own detail blocks, placed through the shared template's slots. */

/** One viewport's specimen URLs; the frame renders the page at `viewport` CSS px and scales it to fit. */
export interface ViewportSpecimenData { viewport: 375 | 768 | 1280; light: string; dark: string }

/** One version beside the pin (when there is one), framed at 1280 CSS px. */
export interface DetailOptionData { version: number; pinned: boolean; reason: string; src: string }
