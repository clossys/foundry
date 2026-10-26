// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FORMAT_LEAVES } from "../../formats/index.js";
import { PublisherFormatsView } from "./PublisherFormatsView.js";
import { FIXTURE_BREAKPOINTS, FIXTURE_INSTANCE_LIBRARY, STANDARD_INSTANCE_FIXTURES } from "../instances/__fixtures__/standard-instances.js";

afterEach(cleanup);
const props = { formats: FORMAT_LEAVES, instances: STANDARD_INSTANCE_FIXTURES, library: FIXTURE_INSTANCE_LIBRARY, breakpointValues: FIXTURE_BREAKPOINTS, designerHref: "/designer" };
const selectFormat = (id: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Formats by medium and family" })).getByRole("row", { name: FORMAT_LEAVES.find(format => format.id === id)!.label, exact: true }));

it("shows supplied format details and its allowed composition choices", async () => {
  const user = userEvent.setup(), onSelectFormat = vi.fn();
  render(<PublisherFormatsView {...props} fixtureLibrary onSelectFormat={onSelectFormat} />);
  expect(screen.getByText("fixture library")).toBeVisible();
  expect(screen.getByText("HTML", { exact: true })).toBeVisible();
  expect(screen.getByText("tokens.breakpoint.tablet · 768 px")).toBeVisible();
  expect(screen.getByText("frames.site-shell · frames.app-shell")).toBeVisible();
  expect(screen.getByText(/8 instance references/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Config/ }));
  expect(await screen.findByRole("option", { name: /stack.landing/ })).toBeVisible();
  expect(screen.queryByRole("option", { name: /staggered-grid/ })).toBeNull();
  await user.keyboard("{Escape}");
  selectFormat("deck.16x9");
  expect(onSelectFormat).toHaveBeenLastCalledWith("deck.16x9");
});

it("keeps concept deliveries inspectable without a renderer or production readiness", () => {
  const resolveFill = vi.fn(() => undefined);
  render(<PublisherFormatsView {...props} library={{ ...props.library, resolveFill }} deliveriesLabel="Handoff inventory" fidelityChoiceLabel="Fidelity choice" />);
  resolveFill.mockClear();
  selectFormat("deck.16x9");
  expect(screen.getByText("Concept only", { exact: true })).toBeVisible();
  expect(screen.getByText("16:9", { exact: true })).toBeVisible();
  const deliveries = screen.getByRole("region", { name: "Handoff inventory" });
  expect(deliveries).toHaveTextContent("PowerPoint · concept-only · Fidelity choice: editable / flat");
  expect(deliveries).toHaveTextContent("Google Slides · concept-only");
  expect(screen.getByText(/No renderer is available/)).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "Composition arrangements" })).toBeNull();
  expect(document.querySelector("iframe")).toBeNull();
  expect(resolveFill).not.toHaveBeenCalled();
  expect(screen.queryByText(/Ready/)).toBeNull();
});

it("uses replacement registry data and refuses an empty allowed composition set", () => {
  const web = FORMAT_LEAVES[0]!;
  const { rerender } = render(<PublisherFormatsView {...props} formats={[{ ...web, allowedCompositions: ["layouts.split"] }]} instances={[STANDARD_INSTANCE_FIXTURES[2]!]} />);
  expect(screen.getByText(/1 instance references/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Skeleton preview · split.default" })).toBeVisible();
  rerender(<PublisherFormatsView {...props} formats={[{ ...web, allowedCompositions: [] }]} />);
  expect(screen.getByText("No allowed compositions are available for this format.")).toBeVisible();
  rerender(<PublisherFormatsView {...props} formats={[]} />);
  expect(screen.getByText("No registered formats supplied.")).toBeVisible();
  expect(document.querySelector("iframe")).toBeNull();
});
