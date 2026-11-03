import { beforeAll, beforeEach, vi } from "vitest";

// Publisher renders built Designer blocks. Settle their lazy client boundaries
// and give componentLeaf renders without an explicit provider the ambient
// Studio component selection, exactly as Designer's own suite does
// (packages/designer/vitest.harness.ts).
vi.mock("react", async importOriginal => (await import("../designer/vitest.harness.js")).preloadingReact(await importOriginal()));
vi.mock("../designer/dist/runtime/component-leaf.client.js", async importOriginal => (await import("../designer/vitest.harness.js")).selectedClient(await importOriginal()));
vi.mock("../designer/dist/runtime/component-leaf.js", async importOriginal => (await import("../designer/vitest.harness.js")).ambientFacade(await importOriginal()));
vi.mock("../designer/src/runtime/component-leaf.client.js", async importOriginal => (await import("../designer/vitest.harness.js")).selectedClient(await importOriginal()));
vi.mock("../designer/src/runtime/component-leaf.js", async importOriginal => (await import("../designer/vitest.harness.js")).ambientFacade(await importOriginal()));

// Before every test, not only once: a lazy boundary declared after the first
// settle (a late dynamic import, a mock factory, a module reset) is otherwise
// still pending when that test renders synchronously.
const settle = async () => {
  const { settleHarness } = await import("../designer/vitest.harness.js");
  await settleHarness(() => import("../designer/dist/studio/marketing-component-selection.js"));
};
beforeAll(settle);
beforeEach(settle);
