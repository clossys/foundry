import { Fragment } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SiteHeader } from "./SiteHeader.js";

afterEach(cleanup);
const surfaces = ["solid", "transparent", "glass"] as const;
const tones = ["base", "inverse"] as const;

describe("the single SiteHeader surface contract", () => {
  it("defaults to solid and keeps the existing internal overlay marker exclusive to glass", () => {
    const { rerender } = render(<SiteHeader brand="Example" />);
    const header = screen.getByRole("banner");
    expect(header).toHaveAttribute("data-surface", "solid");
    expect(header).not.toHaveAttribute("data-placement");
    for (const surface of surfaces) {
      rerender(<SiteHeader brand="Example" surface={surface} />);
      expect(header).toHaveAttribute("data-surface", surface);
      expect(header.style.position).toBe(surface === "glass" ? "fixed" : "relative");
      if (surface === "glass") expect(header).toHaveAttribute("data-placement", "overlay");
      else expect(header).not.toHaveAttribute("data-placement");
    }
  });

  it.each(surfaces.flatMap(surface => tones.map(tone => [surface, tone] as const)))(
    "applies %s surface and %s ink without a legacy ground input", (surface, tone) => {
      render(<SiteHeader brand="Example" surface={surface} tone={tone} />);
      const header = screen.getByRole("banner");
      expect(header).toHaveAttribute("data-tone", tone);
      expect(header).toHaveClass(tone === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
      if (surface === "solid") {
        expect(header).toHaveClass(tone === "inverse" ? "bg-surface-inverse" : "bg-surface-raised");
        expect(header).toHaveClass("border-b");
      } else if (surface === "transparent") {
        expect(header.className).not.toMatch(/\bbg-|\bborder-b\b|site-header-overlay/);
        expect(header.style.borderBottomWidth).toBe("");
      } else expect(header).toHaveClass("site-header-overlay");
    },
  );

  it("refuses unsupported surface values without reflecting the input", () => {
    for (const surface of ["PAYLOAD-SENTINEL", null, 12, {}]) {
      const attempt = () => render(<SiteHeader brand="Example" surface={surface as never} />);
      expect(attempt).toThrow(TypeError);
      expect(attempt).toThrow(/SiteHeader: surface/);
      expect(attempt).not.toThrow(/PAYLOAD-SENTINEL/);
    }
  });

  it("does not turn a transparent surface into a plate when a menu is open", () => {
    render(<SiteHeader brand="Example" surface="transparent" tone="inverse" menuOpen />);
    const header = screen.getByRole("banner");
    expect(header).not.toHaveClass("site-header-overlay");
    expect(header.className).not.toMatch(/\bbg-|\bborder-b\b/);
    expect(header).not.toHaveAttribute("data-menu-open");
  });

  it.each(["leading", "centered"] as const)(
    "puts recognized actions in increasing importance with %s navigation", navPlacement => {
      render(<SiteHeader brand="Example" navPlacement={navPlacement} actions={[
        <SiteHeader.ActionLink key="primary" href="/start" label="Start" variant="primary" />,
        <SiteHeader.ActionLink key="ghost" href="/help" label="Help" variant="ghost" />,
        <SiteHeader.ActionLink key="secondary" href="/sign-in" label="Sign in" variant="secondary" />,
      ]} />);
      expect(within(screen.getByRole("banner")).getAllByRole("link").map(node => node.textContent))
        .toEqual(["Help", "Sign in", "Start"]);
    },
  );

  it("orders fragments of known actions without inventing a wrapper", () => {
    render(<SiteHeader brand="Example" actions={<Fragment>
      <SiteHeader.ActionLink href="/start" label="Start" variant="primary" />
      <Fragment>
        <SiteHeader.ActionLink href="/help" label="Help" variant="ghost" />
        <SiteHeader.ActionLink href="/sign-in" label="Sign in" variant="secondary" />
      </Fragment>
    </Fragment>} />);
    const actions = screen.getByRole("link", { name: "Help" }).parentElement!;
    expect([...actions.children].map(node => node.textContent)).toEqual(["Help", "Sign in", "Start"]);
    expect([...actions.children].every(node => node.tagName === "A")).toBe(true);
  });

  it("preserves unknown custom children even when they have a variant prop", () => {
    const received: Array<{ label: string; variant: string }> = [];
    function CustomAction(props: { label: string; variant: string }) {
      received.push(props);
      return <button type="button">{props.label}</button>;
    }
    const first = <CustomAction key="first" label="Unknown first" variant="primary" />;
    const middle = <CustomAction key="middle" label="Unknown middle" variant="ghost" />;
    const last = <CustomAction key="last" label="Unknown last" variant="secondary" />;
    render(<SiteHeader brand="Example" actions={[
      first,
      <SiteHeader.ActionLink key="primary" href="/start" label="Start" variant="primary" />,
      middle,
      <SiteHeader.ActionLink key="ghost" href="/help" label="Help" variant="ghost" />,
      <SiteHeader.ActionLink key="secondary" href="/sign-in" label="Sign in" variant="secondary" />,
      last,
    ]} />);
    const actions = screen.getByRole("button", { name: "Unknown first" }).parentElement!;
    expect([...actions.children].map(node => node.textContent))
      .toEqual(["Unknown first", "Help", "Unknown middle", "Sign in", "Start", "Unknown last"]);
    expect(received).toEqual([
      { label: "Unknown first", variant: "primary" },
      { label: "Unknown middle", variant: "ghost" },
      { label: "Unknown last", variant: "secondary" },
    ]);
  });
});
