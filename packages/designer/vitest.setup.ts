import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

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

// jsdom ships no PointerEvent, which every browser React Aria supports has. React Aria's
// Autocomplete (the stock shadcn@aria Command) runs Enter on the virtually focused row as
// `dispatchEvent(new PointerEvent("click", ...))`; without the constructor that throws and
// the command never runs (WD-REG). Same shape as the DOM's: a MouseEvent with pointer fields.
// Node-environment test files have no DOM events at all, so they get nothing.
if (typeof globalThis.PointerEvent === "undefined" && typeof globalThis.MouseEvent === "function") {
  class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  globalThis.PointerEvent = PointerEvent as unknown as typeof globalThis.PointerEvent;
}

// Lazy client boundaries and the ambient Studio component selection: see vitest.harness.ts.
vi.mock("react", async importOriginal => (await import("./vitest.harness.js")).preloadingReact(await importOriginal()));
// Source modules, and the built copies the package's own `#designer-*` subpath imports resolve to.
vi.mock("./src/runtime/component-leaf.client.js", async importOriginal => (await import("./vitest.harness.js")).selectedClient(await importOriginal()));
vi.mock("./src/runtime/component-leaf.js", async importOriginal => (await import("./vitest.harness.js")).ambientFacade(await importOriginal()));
vi.mock("./dist/runtime/component-leaf.client.js", async importOriginal => (await import("./vitest.harness.js")).selectedClient(await importOriginal()));
vi.mock("./dist/runtime/component-leaf.js", async importOriginal => (await import("./vitest.harness.js")).ambientFacade(await importOriginal()));

// Before every test, not only once: a lazy boundary declared after the first
// settle (a late dynamic import, a mock factory, a module reset) is otherwise
// still pending when that test renders synchronously.
const settle = async () => {
  const { settleHarness } = await import("./vitest.harness.js");
  await settleHarness(() => import("./src/studio/marketing-component-selection.js"));
};
beforeAll(settle);
beforeEach(settle);
