import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { UsageMeter, type UsageMeterProps, type UsageMeterThreshold } from "./UsageMeter.js";
import { Meter } from "../atoms/Meter.js";

const thresholds: readonly UsageMeterThreshold[] = [
  { at: 0.8, tone: "warning", message: "You have used more than 80 percent of this limit." },
  { at: 1, tone: "danger", message: "You have reached this limit." },
];
const sample: UsageMeterProps = {
  label: "API requests", used: 8420, limit: 10000,
  usedText: "8,420 requests", limitText: "of 10,000", periodText: "Resets Nov 1",
  thresholds, projectedText: "On track for about 11,200 by Oct 31",
};

describe("UsageMeter", () => {
  it("U1 shows host facts and passes usedText unchanged to Meter", () => {
    const { container } = render(<UsageMeter {...sample} id="usage" title="Usage details" className="gap-md" />);
    for (const text of [sample.label as string, sample.usedText, sample.limitText, sample.periodText]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByRole("region", { name: "API requests" })).toHaveAttribute("aria-labelledby", "usage-label");
    expect(container.querySelector("section")).toHaveAttribute("title", "Usage details");
    expect(container.querySelector("section")).toHaveClass("gap-md", "min-w-0");
    expect(container.querySelector("h1,h2,h3,h4,h5,h6,[role='alert'],[role='status']")).toBeNull();
    const tree = UsageMeter(sample);
    const meter = tree.props.children.find((child: { type?: unknown } | null) => child?.type === Meter);
    expect(meter.props.valueText).toBe(sample.usedText);
    expect(meter.props.limitText).toBe(sample.limitText);
  });

  it.each([[79, "accent", null], [80, "warning", thresholds[0]!.message], [100, "danger", thresholds[1]!.message]] as const)("U2 uses inclusive highest thresholds at %s percent", (used, tone, message) => {
    const { container } = render(<UsageMeter {...sample} used={used} limit={100} />);
    expect(container.querySelector("[data-emphasis]")).toHaveAttribute("data-tone", tone);
    expect(container.querySelectorAll("[data-part='mark']")).toHaveLength(message ? 1 : 0);
    for (const threshold of thresholds) {
      if (threshold.message === message) expect(screen.getByText(threshold.message)).toBeVisible();
      else expect(screen.queryByText(threshold.message)).toBeNull();
    }
  });

  it("U3 shows only the highest message with its StatusMark shape and text", () => {
    const { container } = render(<UsageMeter {...sample} used={12000} />);
    expect(screen.queryByText(thresholds[0]!.message)).toBeNull();
    const message = screen.getByText(thresholds[1]!.message);
    expect(message).toBeVisible();
    expect(message.closest("[data-tone]")?.querySelector("[data-part='mark']")).toHaveAttribute("data-shape", "diamond");
    expect(container.querySelectorAll("[data-part='mark']")).toHaveLength(1);
  });

  it("U4 preserves over-limit fill, an interior tick and a shaded over-limit zone", () => {
    const { container } = render(<UsageMeter {...sample} used={12000} />);
    expect(container.querySelector<HTMLElement>("[data-part='fill']")?.style.inlineSize).toBe("100%");
    const tick = container.querySelector<HTMLElement>("[data-part='limit']")!;
    expect(Number.parseFloat(tick.style.insetInlineStart.replace("calc(", ""))).toBeCloseTo(10000 / 12000 * 100);
    expect(Number.parseFloat(tick.style.insetInlineStart.replace("calc(", ""))).toBeLessThan(100);
    expect(Number.parseFloat(container.querySelector<HTMLElement>("[data-part='zone']")!.style.inlineSize)).toBeGreaterThan(0);
    expect(container.querySelector("[data-direction]")).toHaveAttribute("data-direction", "max");
  });

  it.each([
    { used: -1 }, { used: NaN }, { used: Infinity }, { used: -Infinity },
    { limit: 0 }, { limit: -1 }, { limit: NaN }, { limit: Infinity }, { limit: -Infinity },
    { thresholds: [thresholds[1]!, thresholds[0]!] }, { thresholds: [thresholds[0]!, thresholds[0]!] },
    ...[0, -1, NaN, Infinity].map(at => ({ thresholds: [{ at, tone: "info" as const, message: "Check usage" }] })),
  ])("U5 rejects invalid input before composing Meter: %j", invalid => {
    expect(() => UsageMeter({ ...sample, ...invalid })).toThrow(RangeError);
  });

  it("U6 shows projection by default and omits it in compact", () => {
    const { unmount } = render(<UsageMeter {...sample} />);
    expect(screen.getByText(sample.projectedText!)).toBeVisible();
    unmount();
    render(<UsageMeter {...sample} size="compact" />);
    expect(screen.queryByText(sample.projectedText!)).toBeNull();
  });

  it.each(["default", "compact"] as const)("U7 renders an optional action without an empty wrapper in %s", size => {
    const { container, unmount } = render(<UsageMeter {...sample} size={size} action={<a href="/account/usage">View usage</a>} />);
    expect(screen.getByRole("link", { name: "View usage" })).toBeVisible();
    const childCount = container.querySelector("section")!.children.length;
    unmount();
    const absent = render(<UsageMeter {...sample} size={size} />);
    expect(absent.container.querySelector("section")!.children.length).toBe(childCount - 1);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("U8 renders to string with no window and omits naming references without an id", () => {
    vi.stubGlobal("window", undefined);
    try {
      const html = renderToString(<UsageMeter {...sample} />);
      expect(html).toContain(sample.usedText);
      expect(html).not.toContain("aria-labelledby");
    } finally { vi.unstubAllGlobals(); }
  });

  it("U8 calls the real compiled server export under react-server without hooks", () => {
    const entry = resolve(import.meta.dirname, "../../dist/blocks/server.js");
    const script = `import {UsageMeter} from ${JSON.stringify(entry)}; const tree=UsageMeter(${JSON.stringify(sample)}); if(tree.type!=="section")throw new Error("missing section"); process.stdout.write("OK");`;
    expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10000 })).toBe("OK");
  });

  it("U9 shows a visible zero with an empty fill", () => {
    const { container } = render(<UsageMeter {...sample} used={0} usedText="0 requests" thresholds={[]} />);
    expect(screen.getByText("0 requests")).toBeVisible();
    expect(container.querySelector<HTMLElement>("[data-part='fill']")?.style.inlineSize).toBe("0%");
    expect(container.querySelector("[data-part='mark']")).toBeNull();
  });
});


describe("UsageMeter review regressions", () => {
  it("R1 preserves an external accessible-name reference without an id", () => {
    render(<><h2 id="host-usage-title">Current allocation</h2><UsageMeter {...sample} aria-labelledby="host-usage-title" /></>);
    expect(screen.getByRole("region", { name: "Current allocation" })).toHaveAttribute("aria-labelledby", "host-usage-title");
  });

  it("R2 keeps the generated label reference when an id and external reference coexist", () => {
    render(<><h2 id="host-usage-title">Current allocation</h2><UsageMeter {...sample} id="request-usage" aria-labelledby="host-usage-title" /></>);
    expect(screen.getByRole("region", { name: "API requests" })).toHaveAttribute("aria-labelledby", "request-usage-label");
  });

  it("R3 keeps a block-valued label inside its named container after native HTML parsing", () => {
    const html = renderToString(<UsageMeter {...sample} id="nested-usage" label={<div><strong>API requests</strong></div>} />);
    const { container } = render(<div dangerouslySetInnerHTML={{ __html: html }} />);
    expect(container.querySelector("#nested-usage-label")).toContainElement(screen.getByText("API requests"));
    expect(screen.getByRole("region", { name: "API requests" })).toBeVisible();
  });
});
