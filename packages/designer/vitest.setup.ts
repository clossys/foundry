import { afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type * as ReactModule from "react";
import type { ConsumerComponentSelection } from "./src/runtime/component-leaf.client.js";

// React 18+ uses this flag to know that a test renderer will flush updates
// through `act()`. Without it, React Aria's scheduled toast updates produce
// false-positive warnings even when the tests await the real interaction.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `globals: false` in vitest.config.ts (deliberate — see that file) means
// @testing-library/react's own auto-cleanup, which only registers itself
// when it finds a GLOBAL `afterEach`, never fires on its own. Without this,
// every rendered tree leaks into the next test in the same file, which is
// exactly what multi-render tests (Button's variant sweep, Badge's variant
// sweep) and any two tests querying the same accessible name both do.
afterEach(cleanup);

const harness = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  facade: false,
  selection: undefined as ConsumerComponentSelection | undefined,
}));

// Server entries keep client modules behind `React.lazy` boundaries (the
// component-leaf facade, Frames' AppFrame/ShellCopyProvider/FrameStage, the
// surface runtime). A streaming or RSC renderer resolves those boundaries; the
// synchronous renderers most tests use (renderToStaticMarkup, renderToString,
// a first `render`) would instead see a suspension. Start every boundary's
// import as it is declared and settle them before any test runs, so a test
// renders the same resolved client module production streams.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof ReactModule>();
  const lazy: typeof actual.lazy = factory => {
    const type = actual.lazy(factory) as ReturnType<typeof actual.lazy> & { _init?: (payload: unknown) => unknown; _payload?: unknown };
    try {
      type._init?.(type._payload);
    } catch (thrown) {
      if (thrown && typeof (thrown as PromiseLike<unknown>).then === "function") harness.pending.push(Promise.resolve(thrown).catch(() => undefined));
    }
    return type;
  };
  return { ...actual, lazy, default: { ...actual, lazy } };
});

// Blocks render component leaves through the consumer's selected components
// (runtime/component-leaf). A block rendered through the componentLeaf facade
// without its own ConsumerComponentProvider gets the selection Studio renders
// frames and sections with (studio/marketing-component-selection) as the
// ambient one. An explicit provider always wins, and SelectedComponentLeaf
// used directly stays strict, so the bridge's own refusal tests still refuse.
const marker = vi.hoisted(() => ({ provided: undefined as ReactModule.Context<boolean> | undefined, ambient: undefined as ReactModule.Context<boolean> | undefined }));
async function markers() {
  const React = await import("react");
  marker.provided ??= React.createContext(false);
  marker.ambient ??= React.createContext(false);
  return { React, provided: marker.provided, ambient: marker.ambient };
}
type ClientModule = typeof import("./src/runtime/component-leaf.client.js");
type FacadeModule = typeof import("./src/runtime/component-leaf.js");
async function selectedClient(actual: ClientModule): Promise<ClientModule> {
  const { React, provided, ambient } = await markers();
  function ConsumerComponentProvider(props: Parameters<ClientModule["ConsumerComponentProvider"]>[0]) {
    return React.createElement(provided.Provider, { value: true }, React.createElement(actual.ConsumerComponentProvider, props));
  }
  function SelectedComponentLeaf(props: Parameters<ClientModule["SelectedComponentLeaf"]>[0]) {
    const leaf = React.createElement(actual.SelectedComponentLeaf, props);
    if (React.useContext(provided) || !React.useContext(ambient)) return leaf;
    if (!harness.selection) throw new Error("vitest.setup: the ambient fixture component selection is not loaded");
    return React.createElement(actual.ConsumerComponentProvider, { value: harness.selection, children: leaf });
  }
  return { ...actual, ConsumerComponentProvider, SelectedComponentLeaf };
}
async function ambientFacade(actual: FacadeModule): Promise<FacadeModule> {
  const { React, ambient } = await markers();
  harness.facade = true;
  const cache = new Map<string, unknown>();
  const wrap = (target: unknown): unknown => {
    const key = String((target as { displayName?: string }).displayName);
    const known = cache.get(key);
    if (known) return known;
    const Component = React.forwardRef<unknown, Record<string, unknown>>((props, ref) =>
      React.createElement(ambient.Provider, { value: true }, React.createElement(target as ReactModule.ElementType, ref ? { ...props, ref } : props)));
    Object.defineProperty(Component, "displayName", { value: key });
    const wrapped = new Proxy(Component, { get(self, prop, receiver) {
      if (typeof prop !== "string" || Reflect.has(self, prop)) return Reflect.get(self, prop, receiver);
      const part = (target as Record<string, unknown>)[prop];
      return part === undefined ? undefined : wrap(part);
    } });
    cache.set(key, wrapped);
    return wrapped;
  };
  return { ...actual, componentLeaf: ((leaf: `components.${string}`, part?: string) => wrap(actual.componentLeaf(leaf, part))) as FacadeModule["componentLeaf"] };
}
// Source modules, and the built copies the package's own `#designer-*` subpath imports resolve to.
vi.mock("./src/runtime/component-leaf.client.js", async importOriginal => selectedClient(await importOriginal<ClientModule>()));
vi.mock("./src/runtime/component-leaf.js", async importOriginal => ambientFacade(await importOriginal<FacadeModule>()));
vi.mock("./dist/runtime/component-leaf.client.js", async importOriginal => selectedClient(await importOriginal<ClientModule>()));
vi.mock("./dist/runtime/component-leaf.js", async importOriginal => ambientFacade(await importOriginal<FacadeModule>()));

beforeAll(async () => {
  while (harness.pending.length) await Promise.all(harness.pending.splice(0));
  if (harness.facade && !harness.selection) {
    const { marketingComponentSelection } = await import("./src/studio/marketing-component-selection.js");
    harness.selection = marketingComponentSelection();
  }
  while (harness.pending.length) await Promise.all(harness.pending.splice(0));
});
