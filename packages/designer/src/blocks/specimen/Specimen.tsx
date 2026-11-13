import { Fragment, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../../components/internal/cx.js";
import { UI_BORDER_PANEL } from "../../components/internal/ui-vars.js";
import { SpecimenPanel, type SpecimenPanelItem } from "./SpecimenPanel.js";

/** How a specimen arranges its panels. `single` holds exactly one; the others hold two or three. */
export type SpecimenArrangement = "single" | "row" | "stack" | "flow";

/**
 * Arrangement classes. Everything is one column below `tablet`. A `row` of
 * two sits side by side from `tablet`; a row of three goes two and one at
 * `tablet` (the third takes the full row) and three across from `desktop`.
 */
const ROW_CLASSES: Record<2 | 3, string> = {
  2: "grid grid-cols-1 gap-xl tablet:grid-cols-2",
  3: "grid grid-cols-1 gap-xl tablet:grid-cols-2 desktop:grid-cols-3",
};
const ROW_THIRD_PANEL = "tablet:col-span-2 desktop:col-span-1";
const STACK_CLASSES = "flex flex-col gap-lg";
const FLOW_CLASSES = "flex flex-col";
/**
 * The connector's inset follows the panel padding, so its rule lines up with
 * the panel text: both read the same width (the figure is a size container
 * and a flow's panels are as wide as the figure).
 */
const CONNECTOR_CLASSES = "flex items-center gap-sm py-sm ps-lg @md:ps-xl";
const CONNECTOR_RULE_CLASSES = "block h-xl shrink-0 border-s border-line-strong";
const CONNECTOR_TEXT_CLASSES = "m-0 text-body-s text-ink-secondary";

/** The connector rule carries the panel edge width, so a heavier panel edge brings a matching connector. */
const PANEL_EDGE_INLINE_START: CSSProperties = { borderInlineStartWidth: UI_BORDER_PANEL };

/** Panels a specimen may hold. */
export const SPECIMEN_MAX_PANELS = 3;

export interface SpecimenProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "aria-label" | "aria-labelledby" | "title"> {
  /**
   * Required. The figure's accessible name: what the specimen shows, in
   * 12 to 25 words, with no claims. Rendered as `aria-label`, not as
   * visible text (the section header already speaks for the band).
   */
  label: string;
  /** @default "single" */
  arrangement?: SpecimenArrangement;
  /** Short caption between `flow` panels ("Checked against the agreement"). Only with `flow`. */
  connector?: ReactNode;
  /** One panel for `single`; two or three for the other arrangements. */
  panels: readonly SpecimenPanelItem[];
  className?: string;
  style?: CSSProperties;
}

function assertSpecimen(label: unknown, arrangement: SpecimenArrangement, connector: ReactNode, count: number): void {
  if (typeof label !== "string" || label.trim() === "") {
    throw new TypeError("Specimen: label is required; it is the figure's accessible name and says what the specimen shows.");
  }
  if (arrangement === "single" ? count !== 1 : count < 2 || count > SPECIMEN_MAX_PANELS) {
    const expected = arrangement === "single" ? "exactly 1 panel" : "2 to " + SPECIMEN_MAX_PANELS + " panels";
    throw new RangeError("Specimen: the " + arrangement + " arrangement holds " + expected + ", got " + count + ".");
  }
  if (connector !== undefined && connector !== null && connector !== false && arrangement !== "flow") {
    throw new TypeError("Specimen: connector is allowed only with the flow arrangement.");
  }
}

function Connector({ caption }: { caption: ReactNode }) {
  return (
    <div data-specimen-connector="" className={CONNECTOR_CLASSES}>
      <span aria-hidden="true" className={CONNECTOR_RULE_CLASSES} style={PANEL_EDGE_INLINE_START} />
      {caption ? <p className={CONNECTOR_TEXT_CLASSES}>{caption}</p> : null}
    </div>
  );
}

/**
 * Native product-UI evidence for a marketing band: a labelled `<figure>`
 * of 1 to 3 `SpecimenPanel`s, built from components and tokens and rendered on
 * the server. It replaces screenshots and iframes: every word and number
 * arrives through props, so the specimen is real, translatable text, the
 * size of its content, and reflows at 390px.
 *
 * Arrangements: `single` (the default, one panel); `row` (two or three
 * panels side by side from `tablet`; three across from `desktop`, so use
 * a row of three in a stacked band, not a split's visual column); `stack`
 * (panels down one column); `flow` (panels down one column joined by a
 * hairline connector, with the `connector` caption after the first panel).
 *
 * Static by design: no link, button, input, hover state, cursor or focus
 * stop, no internal or horizontal scroll, never on an inverse ground. The
 * accessible name is required and checked; budgets (3 panels, 3 parts per
 * panel, 6 rows per part, a 4 by 5 table) are validated and throw rather
 * than crowd the panel. Server-safe: no hooks.
 */
export function Specimen({ label, arrangement = "single", connector, panels, className, style, ...rest }: SpecimenProps) {
  assertSpecimen(label, arrangement, connector, panels.length);

  let body: ReactNode;
  if (arrangement === "single") {
    const [panel] = panels;
    body = panel ? <SpecimenPanel {...panelContent(panel)} /> : null;
  } else if (arrangement === "row") {
    const count = panels.length === 3 ? 3 : 2;
    body = (
      <div className={ROW_CLASSES[count]}>
        {panels.map((panel, index) => (
          <SpecimenPanel key={panel.id} {...panelContent(panel)} className={index === 2 ? ROW_THIRD_PANEL : undefined} />
        ))}
      </div>
    );
  } else if (arrangement === "stack") {
    body = (
      <div className={STACK_CLASSES}>
        {panels.map((panel) => (
          <SpecimenPanel key={panel.id} {...panelContent(panel)} />
        ))}
      </div>
    );
  } else {
    body = (
      <div className={FLOW_CLASSES}>
        {panels.map((panel, index) => (
          <Fragment key={panel.id}>
            {index > 0 ? <Connector caption={index === 1 ? connector : undefined} /> : null}
            <SpecimenPanel {...panelContent(panel)} />
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <figure
      {...rest}
      aria-label={label}
      data-specimen=""
      data-arrangement={arrangement}
      className={cx("@container m-0 w-full min-w-0", className)}
      style={style}
    >
      {body}
    </figure>
  );
}

function panelContent({ id: _id, ...content }: SpecimenPanelItem) {
  return content;
}
