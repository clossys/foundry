import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageMeter as ClientUsageMeter, type UsageMeterProps } from "./UsageMeter.js";
import { UsageMeter as ServerUsageMeter } from "./UsageMeter.server.js";

/**
 * The client and server `UsageMeter` must render the same elements, classes,
 * styles and text. The only attributes allowed to differ are the ones
 * react-aria-components adds to the meter root for its role and name.
 * Changing a class, an element or a data attribute in one variant fails here
 * until the other follows.
 */
const RAC_ONLY = new Set(["role", "data-rac", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]);

function normalised(markup: string): string {
  const host = document.createElement("div");
  host.innerHTML = markup;
  for (const element of host.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) if (RAC_ONLY.has(name)) element.removeAttribute(name);
    // react-aria-components generates ids and the reference to its label; normalise only the meter's own.
    if (element.hasAttribute("data-direction")) {
      element.removeAttribute("id");
      element.removeAttribute("aria-labelledby");
      element.querySelector("span[id]")?.removeAttribute("id");
    }
  }
  return host.innerHTML;
}

const thresholds = [
  { at: 0.8, tone: "warning", message: "At least 80 percent used." },
  { at: 1, tone: "danger", message: "Limit reached." },
] as const;
const base: UsageMeterProps = {
  label: "API requests", used: 8420, limit: 10000,
  usedText: "8,420 requests", limitText: "of 10,000", periodText: "Resets Nov 1",
};
const CASES: Array<[string, UsageMeterProps]> = [
  ["accent, no thresholds", { ...base, used: 100 }],
  ["warning with projection and id", { ...base, thresholds, projectedText: "About 11,200 by Oct 31", id: "usage", className: "gap-md" }],
  ["danger over the limit, compact, action", { ...base, used: 12000, usedText: "12,000 requests", thresholds, size: "compact", projectedText: "hidden when compact", action: <a href="#upgrade">Upgrade</a> }],
];

describe("UsageMeter server/client parity", () => {
  it.each(CASES)("renders the same markup in both variants: %s", (_name, props) => {
    const server = renderToStaticMarkup(<ServerUsageMeter {...props} />);
    const client = renderToStaticMarkup(<ClientUsageMeter {...props} />);
    expect(normalised(client)).toBe(normalised(server));
  });

  it("differs from the server variant only by the meter wiring", () => {
    const [, props] = CASES[1] as [string, UsageMeterProps];
    const server = renderToStaticMarkup(<ServerUsageMeter {...props} />);
    const client = renderToStaticMarkup(<ClientUsageMeter {...props} />);
    expect(server).not.toContain("role=\"meter");
    expect(client).toContain('role="meter progressbar"');
    expect(client).toContain("data-rac");
  });
});
