/**
 * Compile-time proof that a finite data-fit adaptation (`./types.ts`, `ElementRecord["lineage"]`)
 * refuses what it does not declare. Named `*.check.ts`, not `*.test.ts`, so the package's real `tsc`
 * run compiles it (tsconfig excludes test files; vitest only transpiles them): every
 * `@ts-expect-error` below fails the build the day its guarded contract stops refusing. Never
 * imported by any entry; it has no runtime footprint. The accepted shapes are proven by
 * `adaptation-types.test.ts`, which compiles them through a real TypeScript program.
 */
import type { ElementRecord } from "./types.js";

type Adaptation = NonNullable<ElementRecord["lineage"]["adaptations"]>[number];
const base = { file: "index.tsx", reason: "Bind the existing finite stock input." };
const sourceHash = `sha256:${"0".repeat(64)}` as const;

export const refusedAdaptations: readonly Adaptation[] = [
  // @ts-expect-error No arbitrary replay operation.
  { ...base, kind: "data-fit", operation: "invent-layout", sourceHash, bindings: {} },
  // @ts-expect-error Frame split has only app/page regions.
  { ...base, kind: "data-fit", operation: "sidebar15-frame-split", sourceHash, bindings: { region: "footer" } },
  // @ts-expect-error Right/offcanvas does not accept the left edge.
  { ...base, kind: "data-fit", operation: "sidebar15-right-offcanvas", sourceHash, bindings: { side: "left", collapsible: "offcanvas" } },
  // @ts-expect-error Panel replay is horizontal only.
  { ...base, kind: "data-fit", operation: "sidebar-resizable-panels", sourceHash, bindings: { orientation: "vertical" } },
  // @ts-expect-error Existing Hash contract requires its prefix.
  { ...base, kind: "data-fit", operation: "sidebar-mirrored-edge", sourceHash: "not-a-hash", bindings: { side: "left" } },
];
