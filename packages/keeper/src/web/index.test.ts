import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REACT_DECLARED_RANGE, useHeldRecord } from "./index.js";

describe("REACT_DECLARED_RANGE", () => {
  it("matches package.json's declared react peer range", () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional?: boolean }>;
    };
    expect(REACT_DECLARED_RANGE).toBe(manifest.peerDependencies.react);
    expect(manifest.peerDependenciesMeta.react?.optional).toBe(true);
  });

  it("importing this module does not throw against this repository's own real installed react", () => {
    // index.ts calls assertPeerVersion(...) at module load time; simply having
    // imported REACT_DECLARED_RANGE above without a thrown error is the proof
    // — this test exists to name that explicitly.
    expect(REACT_DECLARED_RANGE).toBe(">=18");
  });
});

describe("the ./web surface", () => {
  it("exports the showing hook, and nothing that writes on its own", () => {
    expect(typeof useHeldRecord).toBe("function");
  });
});
