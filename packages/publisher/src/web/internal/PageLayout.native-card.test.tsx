import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PageLayout } from "./PageLayout.js";

it("preserves the page heading, named card region, body, and notes with native Card content", () => {
  const { container } = render(<PageLayout title="Page title" subtitle="Page subtitle" cardLabel="Account details" notes={<a href="/help">Help</a>}><button>Continue</button></PageLayout>);
  expect(screen.getByRole("heading", { level: 1, name: "Page title" })).toBeInTheDocument();
  const region = screen.getByRole("region", { name: "Account details" });
  const card = region.querySelector("[data-slot=card]")!;
  expect(card).toHaveAttribute("data-size", "default");
  expect(card.querySelector(":scope > [data-slot=card-content]")).not.toBeNull();
  expect(within(region).getByRole("button", { name: "Continue" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
  expect(container.querySelector("[variant]")).toBeNull();
});
