import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Meter as ClientMeter, type MeterProps } from "./Meter.js";
import { Meter as ServerMeter } from "./Meter.server.js";

/**
 * The client `Meter` (react-aria-components) and the server `Meter` are two
 * implementations of one atom. This pins them to the same elements, classes,
 * styles and text: the only attributes allowed to differ are the ones
 * react-aria-components adds to give the root its meter role and name.
 * Changing a class, a style, an element or a data attribute in one variant
 * fails here until the other follows.
 */
const RAC_ONLY = new Set(["role", "id", "data-rac", "aria-label", "aria-labelledby", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]);

function normalised(markup: string): string {
  const host = document.createElement("div");
  host.innerHTML = markup;
  for (const element of host.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) if (RAC_ONLY.has(name)) element.removeAttribute(name);
  }
  return host.innerHTML;
}

const CASES: Array<[string, MeterProps]> = [
  ["default", { value: 3.4, scaleMax: 5, limit: 3, tone: "danger", valueText: "3.4x", limitText: "limit 3.0x" }],
  ["figure, floor", { value: 2, scaleMax: 4, limit: 1.25, direction: "min", tone: "success", emphasis: "figure", valueText: "2.0x", limitText: "limit 1.25x" }],
  ["warning texture with previous", { value: 6, scaleMax: 8, previous: 2, previousText: "Previously 2 units", tone: "warning", valueText: "6 units" }],
  ["info ring, no limit", { value: 1, scaleMax: 2, tone: "info", valueText: "50%", className: "gap-sm", id: "m" }],
  ["named by label", { value: 8420, scaleMax: 10000, tone: "warning", valueText: "8,420 requests", label: "API requests", limitText: "of 10,000" }],
  ["empty label treated as absent", { value: 1, scaleMax: 2, tone: "info", valueText: "50%", label: "" }],
  ["blank label treated as absent", { value: 1, scaleMax: 2, tone: "info", valueText: "50%", label: "  " }],
  ["neutral, over the scale", { value: 12, scaleMax: 8, tone: "neutral", valueText: "150%" }],
  ["accent, limit at the end", { value: 1, scaleMax: 2, limit: 2, tone: "accent", valueText: "50%" }],
];

describe("Meter server/client parity", () => {
  it.each(CASES)("renders the same markup in both variants: %s", (_name, props) => {
    const server = renderToStaticMarkup(<ServerMeter {...props} />);
    const client = renderToStaticMarkup(<ClientMeter {...props} />);
    expect(normalised(client)).toBe(normalised(server));
  });

  it("differs from the server variant only by the meter wiring", () => {
    const [, props] = CASES[0] as [string, MeterProps];
    const server = renderToStaticMarkup(<ServerMeter {...props} />);
    const client = renderToStaticMarkup(<ClientMeter {...props} />);
    expect(server).not.toContain("role=");
    expect(client).toContain('role="meter progressbar"');
    expect(client).toContain("data-rac");
  });

  it("names the client meter by its value text when the label is empty or blank", () => {
    for (const label of ["", "  "]) {
      const props: MeterProps = { value: 2, scaleMax: 4, tone: "info", valueText: "50%", label };
      const client = renderToStaticMarkup(<ClientMeter {...props} />);
      expect(client).not.toContain("aria-label=");
      expect(client).toContain("aria-labelledby");
    }
  });

  it("names the client meter by label and leaves the server markup without it", () => {
    const props: MeterProps = { value: 2, scaleMax: 4, tone: "info", valueText: "50%", label: "Storage" };
    const server = renderToStaticMarkup(<ServerMeter {...props} />);
    const client = renderToStaticMarkup(<ClientMeter {...props} />);
    expect(client).toContain('aria-label="Storage"');
    expect(client).not.toContain("aria-labelledby");
    expect(server).not.toContain("Storage");
  });
});
