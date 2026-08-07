import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button.js";

describe("Button", () => {
  it("renders as a real <button> with its children", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.tagName).toBe("BUTTON");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Button className="bg-status-danger">Save</Button>);
    const classes = screen.getByRole("button", { name: "Save" }).className.split(" ");
    // The built-in primary variant's unprefixed bg-accent must be gone; the
    // consumer's override must be present. The variant's hover:bg-accent-hover
    // is a DIFFERENT class (different pseudo-state) and legitimately survives
    // — overriding the resting background doesn't imply overriding the hover
    // one too, which is exactly the distinction tailwind-merge is meant to
    // preserve.
    expect(classes).toContain("bg-status-danger");
    expect(classes).not.toContain("bg-accent");
    expect(classes).toContain("hover:bg-accent-hover");
  });

  it("still carries its own non-conflicting built-in classes alongside a consumer className", () => {
    render(<Button className="my-extra-class">Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("my-extra-class");
    expect(button.className).toContain("rounded-control");
  });

  it("fires onPress when clicked", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(<Button onPress={onPress}>Save</Button>);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("activates on Enter and Space (keyboard interaction, not just click)", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(<Button onPress={onPress}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("disabled: does not fire onPress and is not tab-reachable", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(<Button onPress={onPress} isDisabled>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("disabled");
    await user.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("supports all four variants without throwing and applies distinct classes", () => {
    const { rerender } = render(<Button variant="primary">X</Button>);
    const primaryClass = screen.getByRole("button").className;
    rerender(<Button variant="secondary">X</Button>);
    const secondaryClass = screen.getByRole("button").className;
    rerender(<Button variant="ghost">X</Button>);
    const ghostClass = screen.getByRole("button").className;
    rerender(<Button variant="danger">X</Button>);
    const dangerClass = screen.getByRole("button").className;
    expect(new Set([primaryClass, secondaryClass, ghostClass, dangerClass]).size).toBe(4);
  });
});
