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
