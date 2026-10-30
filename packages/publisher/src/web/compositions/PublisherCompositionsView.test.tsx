// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublisherCompositionsView, type CompositionsConsumerLibrary } from "./PublisherCompositionsView.js";
import { FIXTURE_BREAKPOINTS } from "../instances/__fixtures__/standard-instances.js";

// Current public Select interaction: open its labelled trigger, choose a listbox option.
afterEach(cleanup);
const empty: CompositionsConsumerLibrary = { id: "example", role: "consumer", instances: [], resolveFill: () => undefined };
const props = { library: empty, breakpointValues: FIXTURE_BREAKPOINTS, designerHref: "/designer" };

it("selects an offered configuration without implying consumer adoption", async () => {
  const user = userEvent.setup(), resolveFill = vi.fn(() => undefined);
  render(<PublisherCompositionsView {...props} library={{ ...empty, resolveFill }} />);
  expect(screen.getByRole("button", { name: "staggered-grid · held" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "split", exact: true }));
  expect(screen.getByRole("button", { name: /Config/ })).toHaveTextContent("split.default");
  await user.click(screen.getByRole("button", { name: /Config/ }));
  await user.click(await screen.findByRole("option", { name: /stack.focus/ }));
  expect(screen.getByRole("heading", { name: "Skeleton preview · stack.focus" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Slots" })).toHaveTextContent("Accepts: sections.form");
  expect(screen.getByRole("region", { name: "Closed members" })).toHaveTextContent("start | center · center");
  expect(screen.getByText("not adopted")).toBeVisible();
  expect(screen.getByRole("link", { name: "Adopt in Designer" })).toHaveAttribute("href", "/designer");
  expect(resolveFill).toHaveBeenLastCalledWith("layouts.stack", "stack.focus");
});

it("restricts config choices to the current format and retains unique observed usage", async () => {
  const user = userEvent.setup();
  const library: CompositionsConsumerLibrary = { ...empty,
    instances: ["one", "one", "two"].map(instanceId => ({ instanceId, layout: { leaf: "layouts.split", config: "split.default" } })),
    resolveFill: (leaf, config) => ({ library: "example", leaf, config, headings: [], states: [] }),
  };
  const { rerender } = render(<PublisherCompositionsView {...props} library={library} allowedLayoutIds={["layouts.split"]} />);
  expect(screen.getByText("adopted into example")).toBeVisible();
  expect(screen.getByText(/used by 2 instances/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Config/ }));
  expect(await screen.findByRole("option", { name: /split.default/ })).toBeVisible();
  expect(screen.queryByRole("option", { name: /stack/ })).toBeNull();
  await user.keyboard("{Escape}");
  rerender(<PublisherCompositionsView {...props} library={library} allowedLayoutIds={[]} />);
  expect(screen.getByText("No allowed compositions are available for this format.")).toBeVisible();
  expect(document.querySelector("iframe")).toBeNull();
});

it.each(["wrong-library", "wrong-leaf", "wrong-config", "missing"])("rejects %s evidence as consumer adoption", mode => {
  render(<PublisherCompositionsView {...props} library={{ ...empty,
    instances: [{ instanceId: "home", layout: { leaf: "layouts.stack", config: "stack.landing" } }],
    resolveFill: (leaf, config) => mode === "missing" ? undefined : ({
      leaf: mode === "wrong-leaf" ? "layouts.split" : leaf,
      config: mode === "wrong-config" ? "stack.document" : config,
      library: mode === "wrong-library" ? "foundry" : "example", headings: [], states: [],
    }),
  }} />);
  expect(screen.getByText("not adopted")).toBeVisible();
  expect(screen.getByText(/used by 1 instance ·/)).toBeVisible();
});

it("keeps viewport/theme previews as contract placeholders with no consumer section rendering", () => {
  render(<PublisherCompositionsView {...props} />);
  for (const width of [320, 1280]) for (const theme of ["light", "dark"]) {
    const frame = screen.getByTitle(`${width} px ${theme} contract preview`) as HTMLIFrameElement;
    fireEvent.load(frame);
    expect(frame.style.width).toBe(`${width}px`);
    expect(frame.contentDocument!.body.querySelector("[data-preview-shape]")).not.toBeNull();
    expect(frame.contentDocument!.body.querySelector("[data-section]")).toBeNull();
  }
  expect(screen.getByText("Contract preview · no consumer sections rendered")).toBeVisible();
});

// Row 310 (REAL, hand-styled scroll region): each skeleton preview scroller is a Foundry Card, never a raw div.
it("renders every skeleton preview scroller through the Foundry Card surface", () => {
  render(<PublisherCompositionsView {...props} />);
  const regions = screen.getAllByRole("region", { name: /px (light|dark) skeleton$/ });
  expect(regions.map(region => region.getAttribute("aria-label"))).toEqual(["320 px light skeleton", "320 px dark skeleton", "1280 px light skeleton", "1280 px dark skeleton"]);
  for (const region of regions) {
    expect(region).toHaveAttribute("data-variant", "outline");
    expect(region).toHaveAttribute("tabindex", "0");
  }
});
