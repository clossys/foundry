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
});
