/** @vitest-environment jsdom */
/**
 * The vitest harness loads `component-leaf.client` twice (src and the built dist reached through package
 * imports such as `#designer-frame-skip-link`). An explicit src selection must reach dist leaves as that same
 * selection, never as an empty strict context, and a selection that lacks a leaf must still refuse it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SiteSkipLink } from "#designer-frame-skip-link";
import { fixtureConsumerComponents } from "../catalog-core/__fixtures__/surface-consumer-components.js";
import { ConsumerComponentProvider } from "./component-leaf.client.js";

afterEach(cleanup);

describe("vitest harness: explicit selection across module instances", () => {
  it("renders a dist leaf from the explicit src selection", () => {
    render(<ConsumerComponentProvider value={fixtureConsumerComponents()}><main id="main" /><SiteSkipLink targetId="main" label="Skip to content" /></ConsumerComponentProvider>);
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main");
  });

  it("still refuses a leaf the explicit selection does not hold", () => {
    const selection = fixtureConsumerComponents();
    const components = { ...selection.profile.components.components };
    delete components["components.link"];
    const missing = { ...selection, profile: { components: { ...selection.profile.components, components } } };
    expect(() => render(<ConsumerComponentProvider value={missing}><SiteSkipLink targetId="main" label="Skip to content" /></ConsumerComponentProvider>)).toThrow("NEED component selection: components.link");
  });
});
