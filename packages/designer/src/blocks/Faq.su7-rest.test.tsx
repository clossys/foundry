import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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

// The same native motion policy serves client panels and server details.
it.each(["details-motion", "disclosure-panel-motion", "disclosure-icon-motion"])("keeps the reduced-motion branch for %s", name => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../styles/theme-keys.css"), "utf8");
  const start = css.indexOf(`@utility ${name} {`);
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("@utility ", start + 1);
  const body = css.slice(start, end < 0 ? undefined : end);
  expect(body).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0s/);
});

it("keeps group row ids unique across FAQ instances with the same authored keys", () => {
  const { container } = render(<><Faq items={items} /><Faq items={items} /></>);
  const ids = Array.from(container.querySelectorAll("[id]")).map(element => element.id);
  expect(new Set(ids).size).toBe(ids.length);
});
