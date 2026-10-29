import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { SiteMegaNavigation, type SiteMegaGroup } from "./SiteHeader.mega.client.js";

afterEach(cleanup);
const groups: SiteMegaGroup[] = [
  { id: "product", label: "Product", columns: [{ heading: "Explore", links: [{ label: "Overview", href: "/overview" }] }], featured: { label: "Featured", href: "/featured", description: "Learn more" } },
  { id: "company", label: "Company", columns: [{ heading: "Company", links: [{ label: "About", href: "/about" }] }] },
];

it("opens one disclosure, exposes ordinary links and returns focus on Escape", async () => {
  const user = userEvent.setup();
  render(<SiteMegaNavigation groups={groups} />);
  const product = screen.getByRole("button", { name: "Product" });
  const company = screen.getByRole("button", { name: "Company" });
  expect(product).toHaveAttribute("aria-expanded", "false");
  await user.click(product);
  const panel = document.getElementById(product.getAttribute("aria-controls")!);
  expect(panel).toBeVisible();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(company);
  expect(product).toHaveAttribute("aria-expanded", "false");
  expect(company).toHaveAttribute("aria-expanded", "true");
  screen.getByRole("link", { name: "About" }).focus();
  await user.keyboard("{Escape}");
  expect(company).toHaveFocus();
  expect(company).toHaveAttribute("aria-expanded", "false");
});

it("closes when Tab leaves the navigation", async () => {
  const user = userEvent.setup();
  render(<><SiteMegaNavigation groups={groups} /><a href="/next">Next</a></>);
  await user.click(screen.getByRole("button", { name: "Company" }));
  screen.getByRole("link", { name: "About" }).focus();
  await user.tab();
  expect(screen.getByRole("link", { name: "Next" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Company" })).toHaveAttribute("aria-expanded", "false");
});

it("folds all columns and featured links into mobile sheet content without a second menu", () => {
  render(<SiteMegaNavigation groups={groups} mobile />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Overview" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Featured" })).toBeVisible();
  fireEvent.keyDown(screen.getByRole("link", { name: "Overview" }), { key: "Escape" });
  expect(screen.getByRole("link", { name: "Overview" })).toBeVisible();
});
