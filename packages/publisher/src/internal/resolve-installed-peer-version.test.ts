import { describe, expect, it } from "vitest";
import { resolveInstalledPeerVersion } from "./resolve-installed-peer-version.js";

describe("resolveInstalledPeerVersion", () => {
  it("resolves a real installed package's version from disk", () => {
    // "react" is this package's own peer AND devDependency, so it is
    // guaranteed to be on disk in this repository's own workspace.
    const version = resolveInstalledPeerVersion("react", import.meta.url);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("returns undefined for a package that is not installed at all", () => {
    expect(resolveInstalledPeerVersion("this-package-does-not-exist-anywhere-1234", import.meta.url)).toBeUndefined();
  });
});
