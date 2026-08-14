import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INTERNATIONALIZED_DATE_DECLARED_RANGE,
  REACT_ARIA_COMPONENTS_DECLARED_RANGE,
  REACT_DECLARED_RANGE,
  REACT_DOM_DECLARED_RANGE,
  TAILWIND_MERGE_DECLARED_RANGE,
  TAILWINDCSS_DECLARED_RANGE,
} from "./declared-peer-ranges.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  peerDependencies: Record<string, string>;
};

describe("declared peer ranges", () => {
  it("matches package.json's peerDependencies exactly, for every declared optional peer", () => {
    expect(REACT_DECLARED_RANGE).toBe(packageJson.peerDependencies["react"]);
    expect(REACT_DOM_DECLARED_RANGE).toBe(packageJson.peerDependencies["react-dom"]);
    expect(REACT_ARIA_COMPONENTS_DECLARED_RANGE).toBe(packageJson.peerDependencies["react-aria-components"]);
    expect(TAILWIND_MERGE_DECLARED_RANGE).toBe(packageJson.peerDependencies["tailwind-merge"]);
    expect(TAILWINDCSS_DECLARED_RANGE).toBe(packageJson.peerDependencies["tailwindcss"]);
    expect(INTERNATIONALIZED_DATE_DECLARED_RANGE).toBe(packageJson.peerDependencies["@internationalized/date"]);
  });
});
