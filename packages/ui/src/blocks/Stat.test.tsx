import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "./Stat.js";

describe("Stat", () => {
  it("renders the label and value", () => {
    render(<Stat label="Monthly active users" value="2,481" />);
    expect(screen.getByText("Monthly active users")).toBeInTheDocument();
    expect(screen.getByText("2,481")).toBeInTheDocument();
  });

  it("omits the delta region entirely when none is given", () => {
    const { container } = render(<Stat label="Users" value="2,481" />);
    expect(container.querySelector(".sr-only")).toBeNull();
  });

  it("omits the description region entirely when none is given", () => {
    render(<Stat label="Users" value="2,481" />);
    // Only label and value text nodes should be present.
    expect(screen.queryByText(/vs\./)).not.toBeInTheDocument();
  });

  it("renders the description region when given", () => {
    render(<Stat label="Users" value="2,481" description="vs. last 30 days" />);
    expect(screen.getByText("vs. last 30 days")).toBeInTheDocument();
  });

  it("renders an \"up\" delta with a visible glyph AND screen-reader-only text — not colour alone", () => {
    render(<Stat label="Users" value="2,481" delta="+12%" trend="up" />);
    expect(screen.getByText("+12%")).toBeInTheDocument();
    expect(screen.getByText("▲", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Increase,", { exact: false })).toBeInTheDocument();
  });

  it("renders a \"down\" delta with its own distinct glyph and screen-reader text", () => {
    render(<Stat label="Users" value="2,481" delta="-3" trend="down" />);
    expect(screen.getByText("▼", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Decrease,", { exact: false })).toBeInTheDocument();
  });

  it("defaults trend to \"neutral\" when a delta is given without one", () => {
    render(<Stat label="Users" value="2,481" delta="0" />);
    expect(screen.getByText("→", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("No change,", { exact: false })).toBeInTheDocument();
  });

  it("applies the success status token to an \"up\" trend", () => {
    render(<Stat label="Users" value="2,481" delta="+12%" trend="up" />);
    const delta = screen.getByText("+12%").closest("span");
    expect(delta?.className).toContain("text-status-success-text");
  });

  it("applies the danger status token to a \"down\" trend", () => {
    render(<Stat label="Users" value="2,481" delta="-3" trend="down" />);
    const delta = screen.getByText("-3").closest("span");
    expect(delta?.className).toContain("text-status-danger-text");
  });

  it("hides the glyph from assistive tech (aria-hidden), relying on the separate sr-only text instead", () => {
    render(<Stat label="Users" value="2,481" delta="+12%" trend="up" />);
    const glyph = screen.getByText("▲");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<Stat label="Users" value="2,481" className="gap-lg" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-lg");
    expect(root.className).not.toContain("gap-xs");
  });

  it("forwards a consumer style prop", () => {
    const { container } = render(<Stat label="Users" value="2,481" style={{ marginTop: "8px" }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });
});
