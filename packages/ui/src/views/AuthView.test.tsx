import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthView } from "./AuthView.js";

describe("AuthView", () => {
  it("renders heading as the page's <h1>", () => {
    render(<AuthView heading="Sign in" form={<div>form goes here</div>} />);
    const heading = screen.getByRole("heading", { name: "Sign in" });
    expect(heading.tagName).toBe("H1");
  });

  it("renders exactly one <h1> on the page", () => {
    render(
      <AuthView
        heading="Sign in"
        description="Welcome back."
        brand={<span>Brand</span>}
        form={<div>form goes here</div>}
        secondaryAction={<a href="/signup">Sign up</a>}
        footnote={<span>&copy; 2026</span>}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders a description when given one", () => {
    render(<AuthView heading="Sign in" description="Welcome back." form={<div>form</div>} />);
    expect(screen.getByText("Welcome back.")).toBeInTheDocument();
  });

  it("renders the brand slot's content", () => {
    render(<AuthView heading="Sign in" brand={<span>Acme</span>} form={<div>form</div>} />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("renders the secondaryAction slot's content", () => {
    render(
      <AuthView heading="Sign in" form={<div>form</div>} secondaryAction={<a href="/signup">Sign up</a>} />,
    );
    expect(screen.getByRole("link", { name: "Sign up" })).toBeInTheDocument();
  });

  it("renders the footnote slot's content", () => {
    render(<AuthView heading="Sign in" form={<div>form</div>} footnote="Terms apply." />);
    expect(screen.getByText("Terms apply.")).toBeInTheDocument();
  });

  it("omits brand, secondaryAction, and footnote entirely when none is given, without throwing", () => {
    render(<AuthView heading="Sign in" form={<div>form</div>} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders a consumer-supplied form's own elements, unmodified", () => {
    render(
      <AuthView
        heading="Sign in"
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
        heading="Sign in"
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
      <AuthView heading="Sign in" form={<div data-testid="not-a-form">Magic link sent.</div>} />,
    );
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(screen.getByTestId("not-a-form")).toBeInTheDocument();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(
      <AuthView heading="Sign in" form={<div>form</div>} className="gap-sm p-lg" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-sm");
    expect(root.className).not.toContain("gap-lg");
    expect(root.className).toContain("p-lg");
    expect(root.className).not.toContain("p-xl");
  });

  it("merges a consumer style prop rather than dropping it", () => {
    const { container } = render(
      <AuthView heading="Sign in" form={<div>form</div>} style={{ marginTop: "8px" }} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });

  it("accepts arbitrary ReactNode as the heading, not just a string", () => {
    render(
      <AuthView
        heading={
          <>
            Sign in to <strong>Acme</strong>
          </>
        }
        form={<div>form</div>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in to Acme");
  });
});
