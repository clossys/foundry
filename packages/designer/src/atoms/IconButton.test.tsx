import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChevronRight } from "../icons/ChevronRight.js";
import { IconButton } from "./IconButton.js";
import { iconButtonClassName } from "./button-classes.js";

describe("IconButton", () => {
  it("renders a real <button> named by label, with one decorative glyph", () => {
    render(<IconButton icon={ChevronRight} label="Next slide" />);
    const button = screen.getByRole("button", { name: "Next slide" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-label", "Next slide");
    const svgs = button.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("applies iconButtonClassName for its size, shape and ground (defaults md, circle, base)", () => {
    const { rerender } = render(<IconButton icon={ChevronRight} label="Next" />);
    const classes = () => screen.getByRole("button", { name: "Next" }).className.split(" ");
    expect(classes()).toEqual(expect.arrayContaining(iconButtonClassName().split(" ")));
    rerender(<IconButton icon={ChevronRight} label="Next" size="sm" shape="square" ground="inverse" />);
    expect(classes()).toEqual(expect.arrayContaining(iconButtonClassName({ size: "sm", shape: "square", ground: "inverse" }).split(" ")));
    expect(classes()).not.toContain("rounded-pill");
  });

  it("sizes the glyph to the box: sm takes the sm icon, md the md icon", () => {
    const { rerender } = render(<IconButton icon={ChevronRight} label="Next" size="sm" />);
    const svg = () => screen.getByRole("button", { name: "Next" }).querySelector("svg") as SVGElement;
    expect(svg().getAttribute("style") ?? "").toContain("--ui-icon-sm");
    rerender(<IconButton icon={ChevronRight} label="Next" size="md" />);
    expect(svg().getAttribute("style") ?? "").toContain("--ui-icon-md");
  });

  it("fires onPress, and a consumer class wins the merge", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(<IconButton icon={ChevronRight} label="Next" onPress={onPress} className="bg-accent" />);
    const button = screen.getByRole("button", { name: "Next" });
    expect(button.className.split(" ")).toContain("bg-accent");
    expect(button.className.split(" ")).not.toContain("bg-surface-raised");
    await user.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("passes aria-pressed through for a toggle", () => {
    render(<IconButton icon={ChevronRight} label="Pin" aria-pressed />);
    expect(screen.getByRole("button", { name: "Pin" })).toHaveAttribute("aria-pressed", "true");
  });

  it("disabled: does not fire and is dimmed", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(<IconButton icon={ChevronRight} label="Next" onPress={onPress} isDisabled />);
    const button = screen.getByRole("button", { name: "Next" });
    await user.click(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button.getAttribute("style") ?? "").toContain("opacity");
  });
});
