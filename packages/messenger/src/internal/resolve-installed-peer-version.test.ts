import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { resolveInstalledPeerVersion } from "./resolve-installed-peer-version.js";

describe("resolveInstalledPeerVersion", () => {
  it("resolves a real installed package's version from disk", () => {
    // "resend" is this package's own peer AND devDependency, so it is
    // guaranteed to be on disk in this repository's own workspace.
    const version = resolveInstalledPeerVersion("resend", import.meta.url);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("resolves a peer whose own exports map does not expose ./package.json (the resend case)", () => {
    // `require.resolve("resend/package.json")` throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED against a real install — the walk-up
    // this module does instead is what makes the version readable at all.
    const require = createRequire(import.meta.url);
    // Asserted on `code`, not on the message: Node words this one as
    // "Package subpath './package.json' is not defined by \"exports\"" and
    // embeds an absolute path, so matching the prose would be brittle.
    let code: string | undefined;
    try {
      require.resolve("resend/package.json");
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code;
    }
    expect(code).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
    expect(resolveInstalledPeerVersion("resend", import.meta.url)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("returns undefined for a package that is not installed at all", () => {
    expect(resolveInstalledPeerVersion("this-package-does-not-exist-anywhere-1234", import.meta.url)).toBeUndefined();
  });
});
