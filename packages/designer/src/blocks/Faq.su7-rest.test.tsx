import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { Faq } from "./Faq.js";
import { Faq as ServerFaq } from "./Faq.server.js";
const items = [{ id: "one", question: "First question", answer: "First answer" }, { id: "two", question: "Second question", answer: "Second answer" }];
describe("FAQ disclosure group", () => {
  it("toggles independent rows with Enter and Space in one group", async () => {
    const user = userEvent.setup();
    const { container } = render(<Faq items={items} />);
    expect(container.querySelector('[data-part="disclosure-group"]')).not.toBeNull();
    const first = screen.getByRole("button", { name: "First question" });
    const second = screen.getByRole("button", { name: "Second question" });
    first.focus(); await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-expanded", "true");
    second.focus(); await user.keyboard(" ");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-expanded", "true");
    first.focus(); await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-expanded", "false");
  });
  it("keeps every answer in server HTML", () => {
    const html = renderToStaticMarkup(<ServerFaq items={items} />);
    expect(html).toContain("First answer"); expect(html).toContain("Second answer");
    expect(html.match(/<details/g)).toHaveLength(2);
  });
});
