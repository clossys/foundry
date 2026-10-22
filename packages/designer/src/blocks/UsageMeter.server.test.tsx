import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsageMeter } from "./UsageMeter.server.js";
import type { UsageMeterProps } from "./UsageMeter.js";
import { Meter } from "../atoms/Meter.server.js";

const sample: UsageMeterProps = {
  label: "API requests", used: 8420, limit: 10000,
  usedText: "8,420 requests", limitText: "of 10,000", periodText: "Resets Nov 1",
  thresholds: [
    { at: 0.8, tone: "warning", message: "You have used at least 80 percent of this limit." },
    { at: 1, tone: "danger", message: "You have reached this limit." },
  ],
  projectedText: "On track for about 11,200 by Oct 31",
};

describe("server UsageMeter", () => {
  it("shows the host facts and the matched state message, with no meter role", () => {
    const { container } = render(<UsageMeter {...sample} id="usage" />);
    for (const text of [sample.usedText, sample.limitText, sample.periodText, sample.projectedText as string]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByRole("region", { name: "API requests" })).toHaveAttribute("aria-labelledby", "usage-label");
    expect(screen.getByText("You have used at least 80 percent of this limit.")).toBeVisible();
    expect(container.querySelector("[role='meter'], [role='progressbar'], [data-rac]")).toBeNull();
  });

  it("is built on the plain Meter, not the react-aria-components one", () => {
    const tree = UsageMeter(sample);
    const meter = tree.props.children.find((child: { type?: unknown } | null) => child?.type === Meter);
    expect(meter.props.valueText).toBe(sample.usedText);
    expect(meter.props.scaleMax).toBe(10000);
    expect(meter.props.tone).toBe("warning");
    expect(meter.props.label).toBe("API requests");
  });

  it.each([
    ["negative used", { used: -1 }],
    ["zero limit", { limit: 0 }],
    ["descending thresholds", { thresholds: [{ at: 1, tone: "danger", message: "a" }, { at: 0.5, tone: "info", message: "b" }] as const }],
  ])("refuses %s", (_name, override) => {
    expect(() => UsageMeter({ ...sample, ...override } as UsageMeterProps)).toThrow(RangeError);
  });
});
