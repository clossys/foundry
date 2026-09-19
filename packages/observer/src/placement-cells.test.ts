import { describe, expect, it } from "vitest";
import { mapBundleToPlacementCells, type HubPlacementCellInput, type HubPlacementObservationBundle } from "./placement-cells.js";

function bundle(overrides: Partial<HubPlacementObservationBundle> = {}): HubPlacementObservationBundle {
  return {
    repositoryId: "consumer/repository",
    packages: [],
    ...overrides,
  };
}

describe("mapBundleToPlacementCells", () => {
  it("maps an installed @clossys package absent from devDependencies to an over-install cell", () => {
    const cells = mapBundleToPlacementCells(bundle({
      packages: [
        { repositoryId: "consumer/repository", packageName: "@clossys/advisor", installedVersion: "0.2.3" },
      ],
    }));
    expect(cells).toEqual<readonly HubPlacementCellInput[]>([
      {
        kind: "over-install",
        packageName: "@clossys/advisor",
        repositoryId: "consumer/repository",
        observed: "0.2.3",
      },
    ]);
  });

  it("maps a declared-but-unreadable package to a missing cell and keeps its declared range as expected", () => {
    const cells = mapBundleToPlacementCells(bundle({
      packages: [
        { repositoryId: "consumer/repository", packageName: "@clossys/advisor", unreadable: true, declaredRange: "^0.2.0" },
        { repositoryId: "consumer/repository", packageName: "@clossys/starter", unreadable: true },
      ],
    }));
    expect(cells).toEqual<readonly HubPlacementCellInput[]>([
      {
        kind: "missing",
        packageName: "@clossys/advisor",
        repositoryId: "consumer/repository",
        observed: "declared but unreadable",
        expected: "^0.2.0",
      },
      {
        kind: "missing",
        packageName: "@clossys/starter",
        repositoryId: "consumer/repository",
        observed: "declared but unreadable",
      },
    ]);
  });

  it("maps an installed version strictly below the declared range floor to a stale cell", () => {
    const cells = mapBundleToPlacementCells(bundle({
      packages: [
        { repositoryId: "consumer/repository", packageName: "@clossys/starter", installedVersion: "0.1.2", declaredRange: "^0.1.4", devDependencies: { "@clossys/starter": "^0.1.4" } },
      ],
    }));
    expect(cells).toEqual<readonly HubPlacementCellInput[]>([
      {
        kind: "stale",
        packageName: "@clossys/starter",
        repositoryId: "consumer/repository",
        observed: "0.1.2",
        expected: "^0.1.4",
      },
    ]);
  });

  it("emits no cell for a declared, installed, in-range package and maps bundles in packages order", () => {
    const cells = mapBundleToPlacementCells(bundle({
      packages: [
        { repositoryId: "consumer/repository", packageName: "@clossys/starter", installedVersion: "0.1.7", declaredRange: "^0.1.4", devDependencies: { "@clossys/starter": "^0.1.4" } },
        { repositoryId: "consumer/repository", packageName: "@clossys/advisor", installedVersion: "0.2.9", declaredRange: "~0.2.9", devDependencies: { "@clossys/advisor": "~0.2.9" } },
        { repositoryId: "consumer/repository", packageName: "@clossys/observer", installedVersion: "0.2.0", declaredRange: "^0.2.0", devDependencies: { "@clossys/observer": "^0.2.0" } },
      ],
    }));
    expect(cells).toEqual([]);
  });

  it("does not treat other software's placement as the hub's business", () => {
    const cells = mapBundleToPlacementCells(bundle({
      packages: [
        { repositoryId: "consumer/repository", packageName: "left-pad", installedVersion: "1.3.0" },
        { repositoryId: "consumer/repository", packageName: "@other/tooling", installedVersion: "1.0.0" },
      ],
    }));
    expect(cells).toEqual([]);
  });

  it("treats the range floor itself as satisfied and a release as newer than its own prerelease floor", () => {
    const atFloor = mapBundleToPlacementCells(bundle({
      packages: [
        { repositoryId: "consumer/repository", packageName: "@clossys/starter", installedVersion: "0.1.4", declaredRange: "^0.1.4", devDependencies: { "@clossys/starter": "^0.1.4" } },
      ],
    }));
    expect(atFloor).toEqual([]);

    // A release (0.1.3) outranks its own version's prerelease (0.1.3-beta.1)
    // per semver, so installing the release against a prerelease floor is
    // in range, not stale.
    const release = mapBundleToPlacementCells(bundle({
      packages: [
        { repositoryId: "consumer/repository", packageName: "@clossys/starter", installedVersion: "0.1.3", declaredRange: "0.1.3-beta.1", devDependencies: { "@clossys/starter": "0.1.3-beta.1" } },
      ],
    }));
    expect(release).toEqual([]);
  });

  it("refuses a bundle whose repository id is empty and a package observation with no name", () => {
    expect(() => mapBundleToPlacementCells(bundle({ repositoryId: "  " }))).toThrow(/repositoryId/);
    expect(() =>
      mapBundleToPlacementCells(bundle({ packages: [{ repositoryId: "consumer/repository", packageName: "  " }] })),
    ).toThrow(/packageName/);
  });
});
