import { componentSourceHash, componentTokensHash } from "../../check-components.js";
import type { ComponentCheckFill, ComponentCheckInput, ComponentObservation } from "../../check-components.js";
import type { ComponentSlot } from "../../types.js";

/** Synthetic checker corpus, not accessibility evidence for any shipped component. */
export function componentProfile(): ComponentCheckInput {
  const tokens: ComponentCheckInput["tokens"] = {
    "themes.foreground.default": { property: "--text", light: "#000000", dark: "#ffffff" },
    "themes.background.default": { property: "--surface", light: "#ffffff", dark: "#000000" },
    "themes.ring.default": { property: "--focus", light: "#000000", dark: "#ffffff" },
    "themes.spacing.default": { property: "--control", light: "32px", dark: "32px" },
    "themes.font-sans.default": { property: "--body", light: "16px" },
  };
  const slot: ComponentSlot = { id: "components.button", layer: "components", status: "draft", requires: [], contract: {
    kind: "component", root: "rac:Button", members: { mode: "closed", names: ["variant.primary", "state.hover", "ground.base", "ground.inverse", "size.md"] }, props: ["children"],
    allowedReads: { themes: ["themes.foreground", "themes.background", "themes.ring", "themes.spacing", "themes.font-sans"], assets: ["assets.icon-close"] },
  } };
  const fill: ComponentCheckFill = { slot: slot.id, source: "test-kit", root: slot.contract.root, members: [...(slot.contract.members.mode === "closed" ? slot.contract.members.names : [])], props: ["children"],
    propMap: { "variant.primary": "variant=primary", "state.hover": "state=hover", "ground.base": "ground=base", "ground.inverse": "ground=inverse", "size.md": "size=md" },
    reads: { themes: [...slot.contract.allowedReads.themes], assets: ["assets.icon-close"], components: [] }, composes: [],
    impl: { kind: "package", module: "test-kit/components", export: "Button" }, license: "MIT", pin: { package: "test-kit", version: "1.0.0", export: "./components#Button" }, deps: [],
    rac: { range: "^1.19.0", peer: true, instance: "consumer-rac" },
  };
  const files = [{ path: "button.tsx", content: 'import {Button} from "react-aria-components"; export const Example = () => <Button style={{color:"var(--text)",background:"var(--surface)"}}>Continue</Button>;' }];
  const observation: ComponentObservation = { files, sourceHash: componentSourceHash(files), tokensHash: componentTokensHash(tokens), root: "rac:Button", forwardsRef: true, forwardsRenderProps: true,
    rac: { version: "1.21.1", instance: "consumer-rac", dependency: "peer" }, calls: [], geometry: { "size.md": "themes.spacing.default" }, measurements: ["light", "dark"].flatMap(mode => ["base", "inverse"].map(ground => ({
      state: "hover", mode: mode as "light" | "dark", ground, roles: ["button"], keyboard: ["Enter", "Space"], axeViolations: [], focusTokens: ["themes.ring.default"],
      forcedColors: { foreground: "ButtonText", background: "ButtonFace" }, target: { width: 32, height: 32 }, contrast: [{ foreground: "themes.foreground.default", background: "themes.background.default", kind: "text" as const }],
    }))),
  };
  return { slots: [slot], fills: [fill], observations: { [fill.slot]: observation }, tokens, assets: ["assets.icon-close"], installedRac: { version: "1.21.1", instance: "consumer-rac" } };
}

export function composedProfile(): ComponentCheckInput {
  const profile = componentProfile();
  const base = profile.fills[0]!; const slot = profile.slots[0]!; const observed = profile.observations[base.slot]!;
  const parent: ComponentCheckFill = { ...structuredClone(base), slot: "components.select", root: "rac:Select", composes: [base.slot], reads: { ...base.reads, components: [base.slot] } };
  const parentSlot: ComponentSlot = { ...slot, id: parent.slot, contract: { ...slot.contract, root: "rac:Select" } };
  const files = [{ path: "select.tsx", content: 'import {Select} from "react-aria-components"; import {Button} from "library/components"; export const Example = () => <Select><Button>Continue</Button></Select>;' }];
  const parentObserved: ComponentObservation = { ...structuredClone(observed), root: "rac:Select", files, sourceHash: componentSourceHash(files), calls: [{ target: base.slot, props: ["children"], members: ["variant.primary"], contextRoot: "rac:Button" }], measurements: observed.measurements.map(item => ({ ...item, roles: ["button", "listbox"], keyboard: ["ArrowDown", "ArrowUp", "Enter", "Escape"] })) };
  return { ...profile, slots: [...profile.slots, parentSlot], fills: [...profile.fills, parent], observations: { ...profile.observations, [parent.slot]: parentObserved } };
}
