/** The paint of one ground: its fill, primary ink, secondary ink and edge colour classes. */
export interface GroundPaint {
  readonly surface: string;
  readonly primary: string;
  readonly secondary: string;
  readonly border: string;
  /** The keyboard focus outline colour that reads on this ground. */
  readonly focus: string;
}

/**
 * The grounds a surface composed above Components (a frame region, site chrome)
 * sits on: `page` is the document ground, `raised` the card plate, `sidebar`
 * the navigation column and `inverse` the opposite-polarity plate.
 */
export type PaintedGround = "page" | "raised" | "sidebar" | "inverse";

/**
 * The ground vocabulary, for surfaces above Components: a frame names
 * the ground it paints and takes the classes here, so the colour roles stay
 * owned by this component and no frame names a colour token itself.
 */
export const GROUND_PAINT: Readonly<Record<PaintedGround, GroundPaint>> = {
  page: { surface: "bg-background", primary: "text-foreground", secondary: "text-muted-foreground", border: "border-border", focus: "focus-visible:outline-ring" },
  raised: { surface: "bg-card", primary: "text-foreground", secondary: "text-muted-foreground", border: "border-border", focus: "focus-visible:outline-ring" },
  sidebar: { surface: "bg-sidebar", primary: "text-foreground", secondary: "text-muted-foreground", border: "border-border", focus: "focus-visible:outline-ring" },
  inverse: { surface: "bg-foreground", primary: "text-background", secondary: "text-background/75", border: "border-background/14", focus: "focus-visible:outline-background" },
};
