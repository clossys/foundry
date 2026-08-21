import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Testimonial } from "./Testimonial.js";

describe("Testimonial", () => {
  it("renders the quote inside a real <blockquote>", () => {
    const { container } = render(
      <Testimonial quote="Quote text goes here." attributorName="Attributor name" />,
    );
    const quote = container.querySelector("blockquote");
    expect(quote).not.toBeNull();
    expect(quote).toHaveTextContent("Quote text goes here.");
  });

  it("renders inside a real <figure>/<figcaption> pair", () => {
    const { container } = render(
      <Testimonial quote="Quote text goes here." attributorName="Attributor name" />,
    );
    expect(container.querySelector("figure")).not.toBeNull();
    expect(container.querySelector("figcaption")).not.toBeNull();
  });

  it("renders attributorName and attributorRole as separate text nodes", () => {
    render(
      <Testimonial
        quote="Quote text goes here."
        attributorName="Attributor name"
        attributorRole="Attributor role, Attributor org"
      />,
    );
    expect(screen.getByText("Attributor name")).toBeInTheDocument();
    expect(screen.getByText("Attributor role, Attributor org")).toBeInTheDocument();
  });

  it("omits attributorRole entirely when none is given", () => {
    const { container } = render(
      <Testimonial quote="Quote text goes here." attributorName="Attributor name" />,
    );
    const figcaption = container.querySelector("figcaption") as HTMLElement;
    expect(figcaption.querySelectorAll("span")).toHaveLength(1);
  });

  it("renders no avatar image when avatarSrc/avatarAlt are omitted", () => {
    render(<Testimonial quote="Quote text goes here." attributorName="Attributor name" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the avatar with its required alt text when both avatarSrc and avatarAlt are given", () => {
    render(
      <Testimonial
        quote="Quote text goes here."
        attributorName="Attributor name"
        avatarSrc="/avatar.png"
        avatarAlt="Attributor name"
      />,
    );
    const avatar = screen.getByRole("img", { name: "Attributor name" });
    expect(avatar).toHaveAttribute("src", "/avatar.png");
    expect(avatar).toHaveAttribute("alt", "Attributor name");
  });

  it("forwards className onto the outer <figure>, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(
      <Testimonial quote="Quote text goes here." attributorName="Attributor name" className="gap-2xl" />,
    );
    const figure = container.querySelector("figure") as HTMLElement;
    expect(figure.className).toContain("gap-2xl");
  });

  it("forwards a consumer style prop", () => {
    const { container } = render(
      <Testimonial quote="Quote text goes here." attributorName="Attributor name" style={{ marginTop: "8px" }} />,
    );
    const figure = container.querySelector("figure") as HTMLElement;
    expect(figure.style.marginTop).toBe("8px");
  });

  it("accepts arbitrary ReactNode as the quote, not just a string", () => {
    const { container } = render(
      <Testimonial
        quote={
          <>
            Quote text <em>emphasis</em> goes here.
          </>
        }
        attributorName="Attributor name"
      />,
    );
    expect(container.querySelector("blockquote")).toHaveTextContent("Quote text emphasis goes here.");
  });
});
