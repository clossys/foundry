import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button as AriaButton } from "react-aria-components";
import { Toolbar } from "./Toolbar.js";

describe("Toolbar", () => {
  it("renders a role=toolbar region with a default accessible name", () => {
    render(<Toolbar leading={<AriaButton>Bold</AriaButton>} />);
    expect(screen.getByRole("toolbar", { name: "Toolbar" })).toBeInTheDocument();
  });

  it("accepts a custom aria-label", () => {
    render(<Toolbar aria-label="Formatting" leading={<AriaButton>Bold</AriaButton>} />);
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
  });

  it("renders the leading, search, and trailing slots", () => {
    render(
      <Toolbar
        leading={<AriaButton>Bold</AriaButton>}
        search={<input aria-label="Filter" />}
        trailing={<AriaButton>Export</AriaButton>}
      />,
    );
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("omits a slot's wrapper entirely when it is not given", () => {
    render(<Toolbar leading={<AriaButton>Bold</AriaButton>} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("moves focus between controls with ArrowRight/ArrowLeft (roving focus, horizontal by default)", async () => {
    const user = userEvent.setup();
    render(
      <Toolbar
        leading={
          <>
            <AriaButton>Bold</AriaButton>
            <AriaButton>Italic</AriaButton>
          </>
        }
        trailing={<AriaButton>Export</AriaButton>}
      />,
    );
    const bold = screen.getByRole("button", { name: "Bold" });
    const italic = screen.getByRole("button", { name: "Italic" });
    const exportBtn = screen.getByRole("button", { name: "Export" });

    bold.focus();
    expect(bold).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(italic).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(exportBtn).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(italic).toHaveFocus();
  });

  it("moves focus with ArrowDown/ArrowUp when orientation is vertical", async () => {
    const user = userEvent.setup();
    render(
      <Toolbar
        orientation="vertical"
        leading={
          <>
            <AriaButton>Bold</AriaButton>
            <AriaButton>Italic</AriaButton>
          </>
        }
      />,
    );
    const bold = screen.getByRole("button", { name: "Bold" });
    const italic = screen.getByRole("button", { name: "Italic" });

    bold.focus();
    await user.keyboard("{ArrowDown}");
    expect(italic).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(bold).toHaveFocus();
  });

  it("pressing Tab from the FIRST control jumps internal focus straight to the toolbar's LAST control, skipping the middle one — react-aria's own documented mechanism for exiting a toolbar in a single Tab stop (move to the edge synchronously, then let the browser's native Tab handling continue from there; a plain browser default action jsdom doesn't simulate, so this asserts the synchronous jump itself via a raw keydown rather than a full user-event Tab press)", () => {
    render(
      <Toolbar
        leading={
          <>
            <AriaButton>Bold</AriaButton>
            <AriaButton>Italic</AriaButton>
            <AriaButton>Underline</AriaButton>
          </>
        }
      />,
    );
    const bold = screen.getByRole("button", { name: "Bold" });
    const underline = screen.getByRole("button", { name: "Underline" });

    bold.focus();
    fireEvent.keyDown(bold, { key: "Tab" });
    // One keydown moved focus TWO controls over (Bold straight to
    // Underline, skipping Italic) — only explainable by the toolbar's own
    // internal jump-to-last-control handling, not an ordinary one-at-a-time
    // Tab step.
    expect(underline).toHaveFocus();
  });

  it("Shift+Tab from any control jumps internal focus straight to the toolbar's FIRST control", () => {
    render(
      <Toolbar
        leading={
          <>
            <AriaButton>Bold</AriaButton>
            <AriaButton>Italic</AriaButton>
            <AriaButton>Underline</AriaButton>
          </>
        }
      />,
    );
    const bold = screen.getByRole("button", { name: "Bold" });
    const underline = screen.getByRole("button", { name: "Underline" });

    underline.focus();
    fireEvent.keyDown(underline, { key: "Tab", shiftKey: true });
    expect(bold).toHaveFocus();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Toolbar className="gap-2xl" leading={<AriaButton>Bold</AriaButton>} />);
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.className).toContain("gap-2xl");
    expect(toolbar.className).not.toContain("gap-md");
  });

  it("forwards a consumer style prop", () => {
    render(<Toolbar style={{ marginTop: "8px" }} leading={<AriaButton>Bold</AriaButton>} />);
    expect(screen.getByRole("toolbar").style.marginTop).toBe("8px");
  });
});
