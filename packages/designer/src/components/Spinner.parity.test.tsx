import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Spinner as ClientSpinner, type SpinnerProps } from "./Spinner.js";
import { Spinner as ServerSpinner } from "./Spinner.server.js";

/**
 * The client `Spinner` (react-aria-components `ProgressBar` when labelled)
 * and the server `Spinner` draw the same `<svg>`. Only the attributes that
 * name the ring may differ: the server ring is `role="status"` named by
 * `aria-label`, the client ring is named by its progress bar wrapper.
 * The relationship attributes (`aria-labelledby`, `aria-describedby`,
 * `aria-details`) sit on the server ring, which is the named element, and on
 * the client's progress bar. A decorative spinner is identical in both
 * variants.
 */
const NAMING = new Set(["role", "aria-label", "aria-labelledby", "aria-describedby", "aria-details"]);

function ring(markup: string): string {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const svg = host.querySelector("svg");
  if (!svg) throw new Error("no svg in markup");
  for (const name of svg.getAttributeNames()) if (NAMING.has(name)) svg.removeAttribute(name);
  return svg.outerHTML;
}

const CASES: Array<[string, SpinnerProps]> = [
  ["labelled, default size", { label: "Loading prompts" }],
  ["labelled, small, consumer colour", { label: "Saving", size: "sm", className: "text-status-danger" }],
  ["labelled, with relationship attributes", { label: "Working", "aria-describedby": "why", "aria-labelledby": "heading", "aria-details": "why" }],
  ["labelled, with a conflicting aria-label attribute", { label: "Working", "aria-label": "Other" }],
  ["labelled, large, extra attributes", { label: "Working", size: "lg", className: "ms-2", "data-testid": "ring" } as SpinnerProps],
];

describe("Spinner server/client parity", () => {
  it.each(CASES)("draws the same svg in both variants: %s", (_name, props) => {
    expect(ring(renderToStaticMarkup(<ClientSpinner {...props} />))).toBe(ring(renderToStaticMarkup(<ServerSpinner {...props} />)));
  });

  it("renders a decorative spinner as the identical markup in both variants", () => {
    const props: SpinnerProps = { size: "lg", className: "ms-2" };
    expect(renderToStaticMarkup(<ClientSpinner {...props} />)).toBe(renderToStaticMarkup(<ServerSpinner {...props} />));
  });

  it("puts the relationship attributes on the named element in each variant", () => {
    const props: SpinnerProps = { label: "Working", "aria-describedby": "why" };
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<ClientSpinner {...props} />);
    expect(host.querySelector("[role='progressbar']")).toHaveAttribute("aria-describedby", "why");
    expect(host.querySelector("svg")).not.toHaveAttribute("aria-describedby");
    host.innerHTML = renderToStaticMarkup(<ServerSpinner {...props} />);
    expect(host.querySelector("svg")).toHaveAttribute("aria-describedby", "why");
  });

  it("names both variants by label when an aria-label attribute is also passed", () => {
    const props: SpinnerProps = { label: "Working", "aria-label": "Other" };
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<ClientSpinner {...props} />);
    expect(host.querySelector("[role='progressbar']")).toHaveAttribute("aria-label", "Working");
    expect(host.querySelector("svg")).not.toHaveAttribute("aria-label");
    host.innerHTML = renderToStaticMarkup(<ServerSpinner {...props} />);
    expect(host.querySelector("svg")).toHaveAttribute("aria-label", "Working");
  });

  it("differs only in what names a labelled ring", () => {
    const client = renderToStaticMarkup(<ClientSpinner label="Loading" />);
    const server = renderToStaticMarkup(<ServerSpinner label="Loading" />);
    expect(server).toContain('role="status"');
    expect(client).toContain('role="progressbar"');
    expect(client).toContain("data-rac");
    expect(client).not.toContain('role="status"');
  });
});
