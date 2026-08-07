import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Banner } from "./Banner.js";

describe("Banner", () => {
  it("renders its message content", () => {
    render(<Banner>Your trial ends in 3 days.</Banner>);
    expect(screen.getByText("Your trial ends in 3 days.")).toBeInTheDocument();
  });

  it("defaults to info: a polite status region", () => {
    render(<Banner>Heads up.</Banner>);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("danger: an assertive alert region", () => {
    render(<Banner variant="danger">Something went wrong.</Banner>);
    const region = screen.getByRole("alert");
    expect(region).toHaveAttribute("aria-live", "assertive");
  });

  it("success/warning: also polite status regions, not alerts", () => {
    const { rerender } = render(<Banner variant="success">Saved.</Banner>);
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(<Banner variant="warning">Careful.</Banner>);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders no dismiss control when onDismiss is omitted", () => {
    render(<Banner>No action needed.</Banner>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a dismiss control, defaulting its accessible name to 'Dismiss', and calls onDismiss on click", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<Banner onDismiss={onDismiss}>Dismiss me.</Banner>);
    const button = screen.getByRole("button", { name: "Dismiss" });
    await user.click(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not remove itself from the DOM on dismiss — the caller owns that decision", async () => {
    const user = userEvent.setup();
    render(<Banner onDismiss={() => {}}>Still here.</Banner>);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByText("Still here.")).toBeInTheDocument();
  });

  it("accepts a custom dismissLabel", () => {
    render(
      <Banner onDismiss={() => {}} dismissLabel="Hide this update">
        Update available.
      </Banner>,
    );
    expect(screen.getByRole("button", { name: "Hide this update" })).toBeInTheDocument();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Banner className="p-lg">Styled.</Banner>);
    const region = screen.getByRole("status");
    expect(region.className).toContain("p-lg");
    expect(region.className).not.toContain("p-md");
  });

  it("forwards a consumer style prop", () => {
    render(<Banner style={{ marginTop: "8px" }}>Styled.</Banner>);
    const region = screen.getByRole("status");
    expect(region.style.marginTop).toBe("8px");
  });
});
