/**
 * The layer-board projection hashes the working library once per working
 * library, not once per render of every projection reader.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { useState } from "react";

const calls = vi.hoisted(() => ({ libraryHash: 0 }));
vi.mock("../catalog-core/index.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../catalog-core/index.js")>();
  return { ...actual, libraryHash: (...args: Parameters<typeof actual.libraryHash>) => { calls.libraryHash++; return actual.libraryHash(...args); } };
});

import { render } from "./__fixtures__/frame.js";
import { libraryHash } from "../catalog-core/index.js";
import { componentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { labels, smallCatalog } from "./__fixtures__/studio.js";
import { WholeStudioProvider, useDesignerLayerBoardProjection, useWholeStudio } from "./WholeStudioProvider.js";
import type { CompositeStudioLabels, CompositeStudioSnapshot } from "./types.js";

afterEach(cleanup);
const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: "W-signoff", proposed: "W-proposed", contract: "W-contract", contentSlots: "W-slots", configurations: "W-config", unresolved: "W-unresolved", unassessed: "W-unassessed" } };

it("re-rendering projection readers and the provider hashes the unchanged working library zero times", async () => {
  const input = componentIntegration();
  const catalog = { ...input.catalog, values: smallCatalog };
  const library = { ...input.library, values: { fills: [] } };
  const adapter = { kind: "composite" as const, catalog, load: async (): Promise<CompositeStudioSnapshot> => ({ library, componentOptions: input.componentOptions }), save: vi.fn() };
  const readers: Record<string, { bump(): void; whole: NonNullable<ReturnType<typeof useWholeStudio>>; projected: ReturnType<typeof useDesignerLayerBoardProjection> }> = {};
  function Reader({ id }: { id: string }) {
    const [count, setCount] = useState(0);
    const whole = useWholeStudio()!, projected = useDesignerLayerBoardProjection();
    readers[id] = { bump: () => setCount(value => value + 1), whole, projected };
    return <output data-testid={id}>{`${projected.projection.phase}:${count}`}</output>;
  }
  render(<WholeStudioProvider adapter={adapter} labels={wholeLabels}><Reader id="a" /><Reader id="b" /><Reader id="c" /></WholeStudioProvider>);
  for (const id of ["a", "b", "c"]) await screen.findByText("ready:0", { selector: `[data-testid="${id}"]` });

  calls.libraryHash = 0;
  for (let round = 1; round <= 5; round++) act(() => { for (const reader of Object.values(readers)) reader.bump(); });
  for (const id of ["a", "b", "c"]) expect(screen.getByTestId(id)).toHaveTextContent("ready:5");
  expect(calls.libraryHash).toBe(0);

  // A provider-level re-render that leaves the working library unchanged hashes nothing either.
  act(() => readers.a!.whole.setScore(true));
  expect(readers.a!.whole.score).toBe(true);
  expect(calls.libraryHash).toBe(0);

  // The memoized hash is still the hash of the working library itself.
  const { whole, projected } = readers.a!;
  expect(projected.projection.libraryHash).toBe(libraryHash(whole.input!.library));
  expect(readers.b!.projected.projection.libraryHash).toBe(projected.projection.libraryHash);
});
