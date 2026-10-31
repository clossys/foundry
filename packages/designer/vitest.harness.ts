// Shared Vitest harness for packages that render Designer blocks (designer, publisher).
// Each package's vitest.setup.ts registers the mocks (vi.mock paths are relative to
// the calling file) and delegates to these factories; state lives on a global symbol
// so every module instance a setup file loads shares one harness.
import type * as ReactModule from "react";
import type { ConsumerComponentSelection } from "./src/runtime/component-leaf.client.js";

type ClientModule = typeof import("./src/runtime/component-leaf.client.js");
type FacadeModule = typeof import("./src/runtime/component-leaf.js");
interface HarnessState {
  pending: Promise<unknown>[];
  facade: boolean;
  selection?: ConsumerComponentSelection;
  provided?: ReactModule.Context<boolean>;
  ambient?: ReactModule.Context<boolean>;
}
const KEY = Symbol.for("clossys.designer.vitest-harness");
function state(): HarnessState {
  const scope = globalThis as unknown as Record<symbol, HarnessState | undefined>;
  return (scope[KEY] ??= { pending: [], facade: false });
}

// Server entries keep client modules behind `React.lazy` boundaries (the
// component-leaf facade, Frames' AppFrame/ShellCopyProvider/FrameStage, the
// surface runtime). A streaming or RSC renderer resolves those boundaries; the
// synchronous renderers most tests use (renderToStaticMarkup, renderToString,
// a first `render`) would instead see a suspension. Start every boundary's
// import as it is declared and settle them before any test runs, so a test
// renders the same resolved client module production streams.
export function preloadingReact(actual: typeof ReactModule): typeof ReactModule {
  const lazy: typeof actual.lazy = factory => {
    const type = actual.lazy(factory) as ReturnType<typeof actual.lazy> & { _init?: (payload: unknown) => unknown; _payload?: unknown };
    try {
      type._init?.(type._payload);
    } catch (thrown) {
      if (thrown && typeof (thrown as PromiseLike<unknown>).then === "function") state().pending.push(Promise.resolve(thrown).catch(() => undefined));
    }
    return type;
  };
  return { ...actual, lazy, default: { ...actual, lazy } } as typeof ReactModule;
}

// Blocks render component leaves through the consumer's selected components
// (runtime/component-leaf). A block rendered through the componentLeaf facade
// without its own ConsumerComponentProvider gets the selection Studio renders
// frames and sections with (studio/marketing-component-selection) as the
// ambient one. An explicit provider always wins, and SelectedComponentLeaf
// used directly stays strict, so the bridge's own refusal tests still refuse.
async function markers() {
  const React = await import("react");
  const harness = state();
  harness.provided ??= React.createContext(false);
  harness.ambient ??= React.createContext(false);
  return { React, provided: harness.provided, ambient: harness.ambient };
}

export async function selectedClient(actual: ClientModule): Promise<ClientModule> {
  const { React, provided, ambient } = await markers();
  function ConsumerComponentProvider(props: Parameters<ClientModule["ConsumerComponentProvider"]>[0]) {
    return React.createElement(provided.Provider, { value: true }, React.createElement(actual.ConsumerComponentProvider, props));
  }
  function SelectedComponentLeaf(props: Parameters<ClientModule["SelectedComponentLeaf"]>[0]) {
    const leaf = React.createElement(actual.SelectedComponentLeaf, props);
    if (React.useContext(provided) || !React.useContext(ambient)) return leaf;
    const selection = state().selection;
    if (!selection) throw new Error("vitest harness: the ambient Studio component selection is not loaded");
    return React.createElement(actual.ConsumerComponentProvider, { value: selection, children: leaf });
  }
  return { ...actual, ConsumerComponentProvider, SelectedComponentLeaf };
}

export async function ambientFacade(actual: FacadeModule): Promise<FacadeModule> {
  const { React, ambient } = await markers();
  state().facade = true;
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

/** Settle pending lazy boundaries and load the ambient selection once a facade was mocked. */
export async function settleHarness(loadSelection: () => Promise<{ marketingComponentSelection(): ConsumerComponentSelection }>): Promise<void> {
  const harness = state();
  while (harness.pending.length) await Promise.all(harness.pending.splice(0));
  if (harness.facade && !harness.selection) harness.selection = (await loadSelection()).marketingComponentSelection();
  while (harness.pending.length) await Promise.all(harness.pending.splice(0));
}
