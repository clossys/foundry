import { Suspense, useState } from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Configurator } from "./catalog-browser/Configurator.js";
import type { CatalogBrowserConfig } from "./catalog-browser/types.js";
import * as nativeSwitch from "../components/preview-runtime/components/switch/switch.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { componentDescriptorHash, type ResolvedComponents } from "../catalog-core/resolve-components.js";
import stored from "../studio/__fixtures__/default-component-preview-profile.json" with { type: "json" };

it("keeps Configurator labels and complete host configuration through the native Switch", async () => {
  const changed = vi.fn(), user = userEvent.setup();
  function Controlled() {
    const [config, setConfig] = useState<CatalogBrowserConfig>({ updates: false, untouched: "retained" });
    return <Configurator controls={[{ id: "updates", type: "toggle", label: "Product updates", defaultValue: false }]} config={config}
      onChange={next => { setConfig(next); changed(next); }} noControls="No controls" resetLabel="Reset" />;
  }
  render(<Controlled />);
  const control = screen.getByRole("switch", { name: "Product updates" });
  expect(control.closest("[data-slot=switch]")).toHaveClass("cn-switch-aria");
  await user.click(control);
  expect(control).toBeChecked();
  expect(changed).toHaveBeenCalledWith({ updates: true, untouched: "retained" });
});

it("binds the producer-derived Switch closure through the real consumer provider", async () => {
  const profile = stored as unknown as ResolvedComponents;
  const selection: ConsumerComponentSelection = { profile: { components: profile }, selectionHash: profile.selectionHash,
    descriptors: Object.fromEntries(Object.entries(profile.components).map(([id, row]) => [id, componentDescriptorHash(row.descriptor)])),
    modules: { "components/switch/switch.tsx": nativeSwitch } };
  const SelectedSwitch = componentLeaf<typeof nativeSwitch.Switch>("components.switch");
  const changed = vi.fn();
  render(<ConsumerComponentProvider value={selection}><Suspense><SelectedSwitch onChange={changed}>Selected setting</SelectedSwitch></Suspense></ConsumerComponentProvider>);
  const control = await screen.findByRole("switch", { name: "Selected setting" });
  await userEvent.click(control);
  expect(control).toBeChecked();
  expect(changed).toHaveBeenCalledWith(true);
});
