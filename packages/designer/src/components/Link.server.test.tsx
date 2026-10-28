import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Link as ServerLink } from "./Link.server.js";
import { Link as ClientLink } from "./Link.client.js";

describe("Link server entry", () => {
  it("resolves the same public Link under react-server without evaluating client hooks", () => {
    const script = `const {Link}=await import('./dist/components/Link.js'); const {Link:server}=await import('./dist/components/server.js'); const item=Link({href:'/current','aria-current':'page',children:'Current'}); if(Link!==server||item.type!=='a'||item.props.href!=='/current'||item.props['aria-current']!=='page')throw Error('Link server entry mismatch'); console.log(import.meta.resolve('#designer-link'));`;
    const result = execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], {
      cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8",
    });
    expect(result.trim()).toMatch(/Link\.server\.js$/);
  });

  it("preserves authored naming, destinations, current-page semantics and disabled state", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(<><ServerLink href="/current" aria-current="page" aria-label="Current page" rel="noopener" target="_blank" data-owner="host">Current</ServerLink><ServerLink href="/disabled" isDisabled>Disabled</ServerLink></>);
    const current = within(host).getByRole("link", { name: "Current page" });
    expect(current).toHaveAttribute("href", "/current");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("rel", "noopener");
    expect(current).toHaveAttribute("target", "_blank");
    expect(current).toHaveAttribute("data-owner", "host");
    const disabled = within(host).getByRole("link", { name: "Disabled" });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled.tagName).toBe("SPAN");
    expect(disabled).not.toHaveAttribute("tabindex");
  });

  it.each([undefined, false, "false", "page"] as const)("matches client current-state markup for aria-current=%s", current => {
    const props = { href: "#current", "aria-current": current, children: "Current" };
    const attributes = (html: string) => {
      const host = document.createElement("div");
      host.innerHTML = html;
      return Object.fromEntries([...host.firstElementChild!.attributes].map(attribute => [attribute.name, attribute.value]));
    };
    expect(attributes(renderToString(<ServerLink {...props} />)))
      .toEqual(attributes(renderToString(<ClientLink {...props} />)));
  });

  it("supports the same render functions and button presentation in its initial state", () => {
    const children = vi.fn(({ isDisabled }) => isDisabled ? "Unavailable" : "Open");
    const host = document.createElement("div");
    host.innerHTML = renderToString(<ServerLink href="/open" buttonVariant="secondary" buttonSize="lg" ground="inverse"
      className={({ isCurrent }) => isCurrent ? "current" : "authored"} style={() => ({ marginInline: "auto" })}
      render={props => <a {...props} data-router="host" />}>{children}</ServerLink>);
    const link = within(host).getByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("data-router", "host");
    expect(link).toHaveClass("authored");
    expect(link.style.marginInline).toBe("auto");
    expect(link.style.blockSize).toBe("var(--ui-control-h-lg)");
    expect(children).toHaveBeenCalledWith(expect.objectContaining({ isDisabled: false, isPressed: false, isFocusVisible: false }));
  });

  it.each([false, true])("hydrates initial server markup and keeps client keyboard/press behavior (disabled=%s)", async isDisabled => {
    const props = { href: "#open", "aria-current": "page" as const, isDisabled, children: "Open" };
    const host = document.createElement("div");
    host.innerHTML = renderToString(<ServerLink {...props} />);
    document.body.append(host);
    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    const press = vi.fn();
    const root = await act(async () => hydrateRoot(host, <ClientLink {...props} onPress={press} /> , { onRecoverableError: recoverable }));
    try {
      const link = within(host).getByRole("link", { name: "Open" });
      const user = userEvent.setup();
      await user.tab();
      if (!isDisabled) {
        expect(link).toHaveFocus();
        expect(link.style.outline).toContain("--color-focus-ring");
        await user.keyboard("{Enter}");
        expect(press).toHaveBeenCalledTimes(1);
      } else {
        expect(link).not.toHaveFocus();
        await user.click(link);
        expect(press).not.toHaveBeenCalled();
      }
      expect(recoverable).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      host.remove();
      consoleError.mockRestore();
    }
  });
});
