// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { AuthView } from "./AuthView.js";

afterEach(cleanup);

const ALLOWED_IMPORT = /^(react|@clossys\/designer\/.+)$/;

/**
 * Every module specifier named by an `import` statement (bare, type, or
 * named) or an `export * / export { ... } from` re-export. A plain
 * `export function ...` names no module, so the export branch requires the
 * re-export shape rather than scanning to the next string literal.
 */
const MODULE_SPECIFIER =
  /^\s*(?:import\b[^;]*?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)["']([^"']+)["']/gm;

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER)].map((m) => m[1] as string);
}

describe("AuthView", () => {
  it("renders heading as the page's <h1>", () => {
    render(<AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form goes here</div>} />);
    const heading = screen.getByRole("heading", { name: "Sign in" });
    expect(heading.tagName).toBe("H1");
  });

  it("renders exactly one <h1> on the page", () => {
    render(
      <AuthView
        brand={<span>Brand</span>}
        heading="Sign in"
        description="Welcome back."
        form={<div>form goes here</div>}
        secondaryAction={<a href="/signup">Sign up</a>}
        footnote={<span>&copy; 2026</span>}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders a description when given one", () => {
    render(<AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} />);
    expect(screen.getByText("Welcome back.")).toBeInTheDocument();
  });

  it("form measure: <main> max-width is the form-measure token with no raw-length fallback", () => {
    render(<AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} />);
    const main = screen.getByRole("main");
    expect(main.style.maxWidth).toBe("var(--ui-width-form-max, none)");
    expect(main.style.maxWidth).not.toMatch(/rem|px/);
  });

  it("description under heading: the description is the element directly after the <h1> inside the page header", () => {
    render(<AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    const next = h1.nextElementSibling as HTMLElement;
    expect(next).not.toBeNull();
    expect(next).toHaveTextContent("Welcome back.");
    const pageHeader = h1.closest("header") as HTMLElement;
    expect(pageHeader.closest("main")).not.toBeNull();
    expect(pageHeader).toContainElement(next);
  });

  it("renders the brand slot's content inside the site header banner", () => {
    render(<AuthView heading="Sign in" description="Welcome back." brand={<span>Acme</span>} form={<div>form</div>} />);
    // jsdom also maps PageHeader's <header> inside <main> to "banner"; the
    // site header is the first one and sits outside <main>.
    const siteHeader = screen.getAllByRole("banner")[0] as HTMLElement;
    expect(siteHeader.closest("main")).toBeNull();
    expect(within(siteHeader).getByText("Acme")).toBeInTheDocument();
  });

  it("forwards surfaceLabel to the site header as a Badge inside the banner", () => {
    render(<AuthView heading="Sign in" brand={<span>Acme</span>} surfaceLabel="admin" form={<div>form</div>} />);
    const siteHeader = screen.getAllByRole("banner")[0] as HTMLElement;
    const badge = within(siteHeader).getByText("admin");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.className).toContain("bg-surface-sunken");
  });

  it("has no mode prop: no mode attribute is rendered, and a stray mode changes no structure (the type error is asserted in AuthView.check.tsx)", () => {
    const baseline = render(<AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} />).container;
    expect(baseline.querySelector("[mode]")).toBeNull();
    const baselineHtml = baseline.innerHTML;
    cleanup();
    const stray = { mode: "signin" } as object;
    const { container } = render(<AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} {...stray} />);
    // An unknown attribute is forwarded like any other rest prop; the view
    // itself reads no mode, so nothing else about the shell changes.
    (container.firstElementChild as HTMLElement).removeAttribute("mode");
    expect(container.innerHTML).toBe(baselineHtml);
  });

  it("renders the footerSecondary slot's content inside the site footer", () => {
    render(
      <AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} footerSecondary={<span>Support line</span>} />,
    );
    expect(within(screen.getByRole("contentinfo")).getByText("Support line")).toBeInTheDocument();
  });

  it("imports only react and @clossys/designer/* (no auth provider)", () => {
    const source = readFileSync(join(import.meta.dirname, "AuthView.tsx"), "utf8");
    const specifiers = moduleSpecifiers(source);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).toMatch(ALLOWED_IMPORT);
    }
    expect(source).not.toMatch(/\brequire\(|import\(/);
  });

  it("the import scan catches bare imports, re-exports, and type imports", () => {
    const sample = [
      'import type { A } from "react";',
      'import "some-auth-provider";',
      'export * from "another-provider";',
      'export { B } from "@clossys/designer/atoms";',
      "import {",
      "  C,",
      '} from "third-provider";',
    ].join("\n");
    expect(moduleSpecifiers(sample)).toEqual([
      "react",
      "some-auth-provider",
      "another-provider",
      "@clossys/designer/atoms",
      "third-provider",
    ]);
    const offenders = moduleSpecifiers(sample).filter((specifier) => !ALLOWED_IMPORT.test(specifier));
    expect(offenders).toEqual(["some-auth-provider", "another-provider", "third-provider"]);
  });


  it("secondary line below the card: the secondaryAction content is outside the card, is its next sibling, and comes before the footnote", () => {
    const { container } = render(
      <AuthView
        brand="Acme"
        heading="Sign in"
        description="Welcome back."
        form={<div>form</div>}
        secondaryAction={<a href="/signup">No account? Join the waitlist</a>}
        footnote="Terms apply."
      />,
    );
    const link = screen.getByRole("link", { name: "No account? Join the waitlist" });
    const card = container.querySelector(".rounded-control") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card).not.toContainElement(link);
    const line = link.closest("main > div") as HTMLElement;
    expect(line).not.toBeNull();
    expect(card.nextElementSibling).toBe(line);
    expect(line.className).toContain("flex flex-col gap-xs text-body-s text-ink-secondary");
    expect(line.nextElementSibling).toBe(screen.getByText("Terms apply."));
  });

  it("secondaryAction takes several lines: each line renders in the one below-card wrapper", () => {
    render(
      <AuthView
        brand="Acme"
        heading="Sign in"
        description="Welcome back."
        form={<div>form</div>}
        secondaryAction={
          <>
            <a href="/forgot">Forgot password?</a>
            <span>No account? Join the waitlist</span>
          </>
        }
      />,
    );
    const first = screen.getByRole("link", { name: "Forgot password?" });
    const second = screen.getByText("No account? Join the waitlist");
    expect(first.parentElement).toBe(second.parentElement);
    expect(first.parentElement?.parentElement).toBe(screen.getByRole("main"));
  });

  it("renders the footnote slot's content", () => {
    render(<AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} footnote="Terms apply." />);
    expect(screen.getByText("Terms apply.")).toBeInTheDocument();
  });

  it("renders the site header and footer, and omits the secondary link and footnote when none is given", () => {
    const { container } = render(<AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} />);
    expect(container.querySelector("header")).not.toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // No internal note by default: Designer's Badge is the only `rounded-pill`
    // element this view could render inside <main>.
    expect(screen.getByRole("main").querySelector(".rounded-pill")).toBeNull();
  });

  it("internal note placement: the note is the element after the footnote, outside the card, led by a Badge with the label", () => {
    const { container } = render(
      <AuthView
        brand="Acme"
        heading="Sign in"
        description="Welcome back."
        form={<div>form</div>}
        footnote="Terms apply."
        internalNote={{ label: "Internal", message: "Use the test account." }}
      />,
    );
    const footnote = screen.getByText("Terms apply.");
    const note = footnote.nextElementSibling as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.tagName).toBe("P");
    expect(note.parentElement).toBe(screen.getByRole("main"));
    expect(container.querySelector(".rounded-control")).not.toContainElement(note);
    const badge = note.firstElementChild as HTMLElement;
    expect(badge.className).toContain("rounded-pill");
    expect(badge.textContent).toBe("Internal");
    expect(note).toHaveTextContent("InternalUse the test account.");
    expect(screen.getByRole("main").querySelectorAll(".rounded-pill")).toHaveLength(1);
  });

  it("puts the page heading above a card that holds the form, for sign-in and sign-up alike", () => {
    const { container, unmount } = render(
      <AuthView
        brand="Acme"
        heading="Sign in"
        description="Welcome back."
        form={<form aria-label="Sign in form"><button type="submit">Continue</button></form>}
        secondaryAction={<a href="/signup">No account? Join the waitlist</a>}
        footnote="Terms apply."
      />,
    );
    const card = container.querySelector(".rounded-control") as HTMLElement;
    expect(card).not.toBeNull();
    const signInForm = screen.getByRole("form", { name: "Sign in form" });
    expect(card).toContainElement(signInForm);
    // The card holds only the form slot: neither the alternate-step line nor the footnote is inside it.
    expect(card.children).toHaveLength(1);
    expect(card.firstElementChild).toBe(signInForm);
    expect(card).not.toContainElement(screen.getByText("Terms apply."));
    expect(card).not.toContainElement(screen.getByRole("link", { name: "No account? Join the waitlist" }));
    expect(card).not.toContainElement(screen.getByRole("heading", { level: 1 }));
    unmount();
    render(
      <AuthView brand="Acme" heading="Create an account" description="Start with your email." form={<form aria-label="Create account"><button type="submit">Create account</button></form>} secondaryAction={<a href="/sign-in">Back to sign in</a>} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Create an account" })).toBeInTheDocument();
    expect(document.querySelector("footer")).not.toBeNull();
  });

  it("renders a consumer-supplied form's own elements, unmodified", () => {
    render(
      <AuthView
        brand="Acme"
        heading="Sign in"
        description="Welcome back."
        form={
          <form aria-label="Sign in form">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" />
            <button type="submit">Continue</button>
          </form>
        }
      />,
    );
    expect(screen.getByRole("form", { name: "Sign in form" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("implements no auth logic itself: exactly one <form> exists (the consumer's own), and submitting it calls only the consumer's own handler", async () => {
    const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    const { container } = render(
      <AuthView
        brand="Acme"
        heading="Sign in"
        description="Welcome back."
        form={
          <form aria-label="Sign in form" onSubmit={onSubmit}>
            <button type="submit">Continue</button>
          </form>
        }
      />,
    );
    expect(container.querySelectorAll("form")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("adds no <form> of its own when the consumer's form slot isn't one", () => {
    const { container } = render(
      <AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div data-testid="not-a-form">Magic link sent.</div>} />,
    );
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(screen.getByTestId("not-a-form")).toBeInTheDocument();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(
      <AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} className="min-h-screen" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("min-h-screen");
    expect(root.className).not.toContain("min-h-dvh");
    expect(root.className).toContain("flex-col");
  });

  it("merges a consumer style prop rather than dropping it", () => {
    const { container } = render(
      <AuthView brand="Acme" heading="Sign in" description="Welcome back." form={<div>form</div>} style={{ marginTop: "8px" }} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });

  it("accepts arbitrary ReactNode as the heading, not just a string", () => {
    render(
      <AuthView
        brand="Acme"
        heading={
          <>
            Sign in to <strong>Acme</strong>
          </>
        }
        description="Welcome back."
        form={<div>form</div>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in to Acme");
  });
});
