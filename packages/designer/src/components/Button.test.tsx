import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, type ButtonVariant } from "./Button.js";

describe("Button", () => {
  it("renders as a real <button> with its children", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.tagName).toBe("BUTTON");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Button className="bg-status-danger">Save</Button>);
    const classes = screen.getByRole("button", { name: "Save" }).className.split(" ");
    // The built-in primary variant's unprefixed bg-action must be gone; the
    // consumer's override must be present. The variant's hover:bg-action-hover
    // is a DIFFERENT class (different pseudo-state) and legitimately survives
    // — overriding the resting background doesn't imply overriding the hover
    // one too, which is exactly the distinction tailwind-merge is meant to
    // preserve.
    expect(classes).toContain("bg-status-danger");
    expect(classes).not.toContain("bg-action");
    expect(classes).toContain("hover:bg-action-hover");
  });

  it("lets the named frame-control inline padding replace its own px-md, as the px-sm it stands for did", () => {
    render(<Button variant="ghost" className="px-frame-control">Save</Button>);
    const classes = screen.getByRole("button", { name: "Save" }).className.split(" ");
    // A named `@utility` is outside tailwind-merge's token scale; only its `px` class-group
    // registration in `cx` makes it conflict with px-md instead of both shipping.
    expect(classes).toContain("px-frame-control");
    expect(classes).not.toContain("px-md");
    expect(classes).toContain("control-h-md");
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

  it("pending: stays focusable, carries no disabled attribute, and is not dimmed", () => {
    render(<Button isPending>Save</Button>);
    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveAttribute("data-pending", "true");
    // jsdom cannot parse the `var()` opacity value, so read the attribute:
    // a disabled Button writes an opacity declaration, a pending one must not.
    expect(button.getAttribute("style") ?? "").not.toContain("opacity");
    button.focus();
    expect(button).toHaveFocus();
  });

  it("forwards a consumer style prop, and the consumer's conflicting property wins the merge", () => {
    render(
      <Button isDisabled style={{ opacity: 0.42, marginTop: "8px" }}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    // The component's own disabled-state opacity would otherwise apply here
    // (see VARIANT_CLASSES/UI_ALPHA_DISABLED in Button.tsx) — the consumer's
    // explicit value must win instead of being silently dropped.
    expect(button.style.opacity).toBe("0.42");
    // A non-conflicting property the component never sets must survive too.
    expect(button.style.marginTop).toBe("8px");
  });

  it("supports the five contract variants with distinct treatments", () => {
    const variants = ["primary", "secondary", "ghost", "danger", "outline"] as const;
    const { rerender } = render(<Button>X</Button>);
    const treatments = variants.map(variant => {
      rerender(<Button variant={variant}>X</Button>);
      return screen.getByRole("button", { name: "X" }).className;
    });
    expect(new Set(treatments).size).toBe(5);
  });

  it.each(["tonal", "quiet"])("refuses the undeclared %s variant from an untyped caller", variant => {
    expect(() => render(<Button variant={variant as ButtonVariant}>Action</Button>)).toThrow(/unsupported variant/);
  });

  it("preserves render-function labels without requiring a glyph provider", () => {
    render(<Button variant="ghost">{({ isDisabled }) => isDisabled ? "Off" : "On"}</Button>);
    expect(screen.getByRole("button", { name: "On" }).querySelector("svg")).toBeNull();
  });

});


describe("primary action palette", () => {
  it("uses action and on-action ink, with native pressed feedback", () => {
    render(<Button>Save</Button>);
    const control = screen.getByRole("button");
    expect(control.className.split(" ")).toEqual(expect.arrayContaining(["bg-action", "text-ink-on-action", "hover:bg-action-hover", "data-pressed:bg-action-pressed"]));
    expect(control.className).not.toContain("bg-accent");
  });
  it("uses inverse action fill and primary ink on the inverse ground", async () => {
    render(<Button ground="inverse">Save</Button>);
    const control = screen.getByRole("button");
    expect(control.className.split(" ")).toEqual(expect.arrayContaining(["bg-action-on-inverse", "text-ink-primary", "hover:bg-action-on-inverse-hover"]));
    await userEvent.setup().tab();
    expect(control.style.outline).toContain("--color-focus-ring-on-inverse");
    expect(control.style.outlineOffset).toBe("var(--ui-focus-offset, 2px)");
  });
});

describe("Button label truncation (VF-1 cross-09)", () => {
  it("puts a plain-text label in a truncating span inside a single-line box", () => {
    render(<Button>A label far longer than its container</Button>);
    const button = screen.getByRole("button", { name: "A label far longer than its container" });
    expect(button.className).toContain("whitespace-nowrap");
    const label = button.querySelector("span.truncate");
    expect(label?.textContent).toBe("A label far longer than its container");
    expect(label?.className).toContain("min-w-0");
  });
});
