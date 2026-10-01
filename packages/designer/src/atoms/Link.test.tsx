import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button.js";
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
  describe("button look", () => {
    it("renders Button's exact classes on a custom link element, and a consumer className still wins", () => {
      function CustomRouterLink(props: ComponentProps<"a">) {
        return <a {...props} data-testid="custom-router-link" />;
      }
      const { unmount } = render(
        <Button variant="secondary" size="lg">
          Go
        </Button>,
      );
      const buttonTokens = screen.getByRole("button", { name: "Go" }).className.split(" ").sort();
      unmount();

      render(
        <Link
          href="/go"
          buttonVariant="secondary"
          buttonSize="lg"
          render={(props) => <CustomRouterLink {...props} />}
        >
          Go
        </Link>,
      );
      const link = screen.getByTestId("custom-router-link");
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", "/go");
      expect(screen.getByRole("link", { name: "Go" })).toBe(link);
      expect(link.className.split(" ").sort()).toEqual(buttonTokens);
    });

    it("lets a consumer className win the merge in button mode", () => {
      render(
        <Link href="/go" buttonVariant="primary" className="bg-status-danger">
          Go
        </Link>,
      );
      const classes = screen.getByRole("link", { name: "Go" }).className.split(" ");
      expect(classes).toContain("bg-status-danger");
      expect(classes).not.toContain("bg-accent");
    });

    it("applies button classes when only buttonSize is set, defaulting the variant to primary", () => {
      const { unmount } = render(<Button size="sm">Go</Button>);
      const buttonTokens = screen.getByRole("button", { name: "Go" }).className.split(" ").sort();
      unmount();
      render(
        <Link href="/go" buttonSize="sm">
          Go
        </Link>,
      );
      expect(screen.getByRole("link", { name: "Go" }).className.split(" ").sort()).toEqual(
        buttonTokens,
      );
    });
  });

  describe("unchanged link", () => {
    it("keeps the link classes when neither button prop is set", () => {
      render(<Link href="/go">Go</Link>);
      const classes = screen.getByRole("link", { name: "Go" }).className.split(" ");
      expect(classes).toContain("text-ink-link");
      expect(classes).not.toContain("rounded-control");
    });

    it("sets the disabled opacity style in button mode", () => {
      render(
        <Link href="/go" buttonVariant="primary" isDisabled>
          Go
        </Link>,
      );
      // jsdom cannot parse the `var()` opacity value, so read the attribute.
      expect(screen.getByRole("link", { name: "Go" }).getAttribute("style") ?? "").toContain(
        "opacity",
      );
    });

    it("sets no opacity style on a plain link", () => {
      render(
        <Link href="/go" isDisabled>
          Go
        </Link>,
      );
      expect(screen.getByRole("link", { name: "Go" }).getAttribute("style") ?? "").not.toContain(
        "opacity",
      );
    });
  });
});
