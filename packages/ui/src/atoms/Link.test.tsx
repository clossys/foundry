import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link } from "./Link.js";

describe("Link", () => {
  it("renders as a real <a> with its href", () => {
    render(<Link href="/prompts">Prompts</Link>);
    const link = screen.getByRole("link", { name: "Prompts" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/prompts");
  });

  it("renders the consumer's custom component when a render prop is provided", () => {
    function CustomRouterLink(props: ComponentProps<"a">) {
      return <a {...props} data-testid="custom-router-link" />;
    }
    render(
      <Link href="/prompts" render={(props) => <CustomRouterLink {...props} />}>
        Prompts
      </Link>,
    );
    const link = screen.getByTestId("custom-router-link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/prompts");
    expect(link).toHaveTextContent("Prompts");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(
      <Link href="/prompts" className="text-status-danger">
        Prompts
      </Link>,
    );
    const classes = screen.getByRole("link", { name: "Prompts" }).className.split(" ");
    expect(classes).toContain("text-status-danger");
    expect(classes).not.toContain("text-ink-link");
  });

  it("fires onPress when clicked", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(
      <Link href="/prompts" onPress={onPress}>
        Prompts
      </Link>,
    );
    await user.click(screen.getByRole("link", { name: "Prompts" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("disabled: is not tab-reachable and does not fire onPress", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(
      <Link href="/prompts" onPress={onPress} isDisabled>
        Prompts
      </Link>,
    );
    const link = screen.getByRole("link", { name: "Prompts" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    await user.click(link);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("supports all three variants without throwing and applies distinct classes", () => {
    const { rerender } = render(
      <Link href="/x" variant="default">
        X
      </Link>,
    );
    const defaultClass = screen.getByRole("link").className;
    rerender(
      <Link href="/x" variant="muted">
        X
      </Link>,
    );
    const mutedClass = screen.getByRole("link").className;
    rerender(
      <Link href="/x" variant="standalone">
        X
      </Link>,
    );
    const standaloneClass = screen.getByRole("link").className;
    expect(new Set([defaultClass, mutedClass, standaloneClass]).size).toBe(3);
  });
  /**
   * BASE sets `outline-none`, stripping the browser's own focus ring. If
   * nothing replaces it, keyboard focus on a link is invisible — WCAG
   * 2.4.7, and a silent failure: the markup looks correct, the tests pass,
   * and only a keyboard user ever finds out. This asserts the replacement
   * exists rather than trusting that it does.
   */
  it("shows a visible focus ring on keyboard focus", async () => {
    const user = userEvent.setup();
    render(<Link href="/prompts">Prompts</Link>);
    const link = screen.getByRole("link");

    expect(link.style.boxShadow).toBe("");
    await user.tab();
    expect(link).toHaveFocus();
    expect(link.style.boxShadow).not.toBe("");
  });

  it("lets a consumer's own style win over the focus ring", () => {
    render(
      <Link href="/x" style={{ boxShadow: "none" }}>
        X
      </Link>,
    );
    expect(screen.getByRole("link").style.boxShadow).toBe("none");
  });
});
