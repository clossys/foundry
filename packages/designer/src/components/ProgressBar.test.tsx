import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "./ProgressBar.js";

describe("ProgressBar", () => {
  it("renders with role=progressbar, labeled, with a default 0-100 range", () => {
    render(<ProgressBar label="Uploading" value={0} />);
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });

  it("determinate: announces the current value via aria-valuenow/aria-valuetext", () => {
    render(<ProgressBar label="Uploading" value={42} />);
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuetext", "42%");
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("respects a custom minValue/maxValue range", () => {
    render(<ProgressBar label="Downloading" value={5} minValue={0} maxValue={10} />);
    const bar = screen.getByRole("progressbar", { name: "Downloading" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
    expect(bar).toHaveAttribute("aria-valuenow", "5");
  });

  it("indeterminate: omits aria-valuenow entirely and does not render a value string", () => {
    render(<ProgressBar label="Working" isIndeterminate />);
    const bar = screen.getByRole("progressbar", { name: "Working" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByText("%")).not.toBeInTheDocument();
  });

  it("forwards className onto the outer wrapper, and the consumer's conflicting class wins the merge", () => {
    render(<ProgressBar label="Uploading" value={10} className="gap-lg" />);
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar.className).toContain("gap-lg");
    expect(bar.className).not.toContain("gap-xs");
  });

  it("forwards a consumer style prop, merged rather than dropped", () => {
    render(<ProgressBar label="Uploading" value={10} style={{ marginTop: "8px" }} />);
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar.style.marginTop).toBe("8px");
  });
});
