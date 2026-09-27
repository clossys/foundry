import { describe, expect, it } from "vitest";
import { isUnreadable, readNpmLockfile, readPnpmLockfile } from "./lockfile-readers.js";
import type { LockfileEntry, LockfileView, RootDependency } from "./lockfile-readers.js";

function rootDep(placement: RootDependency["placement"], name: string, over: Partial<RootDependency> = {}): RootDependency {
  const merged = { placement, name, specifier: "1.0.0", version: null, integrity: null, link: false, ...over };
  return { rawVersion: merged.version, ...merged };
}

function entry(key: string, over: Partial<LockfileEntry> = {}): LockfileEntry {
  const merged = { key, name: key, version: "1.0.0", integrity: null, tarball: null, link: false, otherResolutionKeys: [], ...over };
  return { installedName: merged.name, ...merged };
}

describe("readNpmLockfile", () => {
  it("reads a v2 lockfile's root dependencies and entries", () => {
    const doc = {
      lockfileVersion: 2,
      packages: {
        "": { dependencies: { "left-pad": "^1.0.0" } },
        "node_modules/left-pad": { version: "1.3.0", resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", integrity: "sha512-AAA==" },
      },
    };
    const result = readNpmLockfile(JSON.stringify(doc));
    expect(isUnreadable(result)).toBe(false);
    const view = result as LockfileView;
    expect(view.format).toBe("npm");
    expect(view.lockfileVersion).toBe(2);
    expect(view.root).toEqual([rootDep("dependencies", "left-pad", { specifier: "^1.0.0", version: "1.3.0", integrity: "sha512-AAA==" })]);
    expect(view.entries).toEqual([
      entry("node_modules/left-pad", { name: "left-pad", version: "1.3.0", integrity: "sha512-AAA==", tarball: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz" }),
    ]);
  });

  it("reads a v3 lockfile across all root placements, a nested node_modules name, a workspace path that is not an entry, and a link root dependency", () => {
    const doc = {
      name: "root-pkg",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "root-pkg",
          dependencies: { "left-pad": "^1.0.0", "local-thing": "file:../local-thing" },
          devDependencies: { typescript: "^5.0.0" },
          optionalDependencies: { fsevents: "^2.0.0" },
          peerDependencies: { react: "^18.0.0" },
        },
        "node_modules/left-pad": { version: "1.3.0", resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", integrity: "sha512-AAA==" },
        "node_modules/typescript": { version: "5.4.5", integrity: "sha512-BBB==" },
        "node_modules/fsevents": { version: "2.3.3" },
        "node_modules/react": { version: "18.2.0", integrity: "sha512-CCC==" },
        "node_modules/local-thing": { version: "0.0.0", resolved: "local-thing", link: true },
        "node_modules/x": { version: "1.0.0" },
        "node_modules/x/node_modules/@fixture/y": { version: "2.0.0" },
        "packages/a": { name: "@scope/a", version: "1.0.0" },
      },
    };
    const result = readNpmLockfile(JSON.stringify(doc));
    expect(isUnreadable(result)).toBe(false);
    const view = result as LockfileView;
    expect(view.lockfileVersion).toBe(3);
    expect(view.root).toEqual([
      rootDep("dependencies", "left-pad", { specifier: "^1.0.0", version: "1.3.0", integrity: "sha512-AAA==" }),
      rootDep("dependencies", "local-thing", { specifier: "file:../local-thing", version: "0.0.0", link: true }),
      rootDep("devDependencies", "typescript", { specifier: "^5.0.0", version: "5.4.5", integrity: "sha512-BBB==" }),
      rootDep("optionalDependencies", "fsevents", { specifier: "^2.0.0", version: "2.3.3" }),
      rootDep("peerDependencies", "react", { specifier: "^18.0.0", version: "18.2.0", integrity: "sha512-CCC==" }),
    ]);
    const keys = view.entries.map((e) => e.key);
    expect(keys).not.toContain("packages/a"); // a workspace member path, not an entry
    expect(keys).toEqual([...keys].sort());
    const nested = view.entries.find((e) => e.key === "node_modules/x/node_modules/@fixture/y");
    expect(nested?.name).toBe("@fixture/y");
  });

  it("reports lockfileVersion 1 as format-unsupported", () => {
    const result = readNpmLockfile(JSON.stringify({ lockfileVersion: 1, packages: { "": {} } }));
    expect(result).toEqual({ unreadable: true, reason: "lockfile-format-unsupported" });
  });

  it("reports a duplicate JSON object key as unreadable", () => {
    const result = readNpmLockfile('{"lockfileVersion":3,"a":1,"packages":{"":{}},"a":2}');
    expect(result).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reports invalid JSON as unreadable", () => {
    const result = readNpmLockfile("{ this is not json");
    expect(result).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reports a missing packages map as unreadable", () => {
    const result = readNpmLockfile(JSON.stringify({ lockfileVersion: 3 }));
    expect(result).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });
});

describe("readPnpmLockfile", () => {
  const HAPPY_PATH = `
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      '@fixture/fixture-a':
        specifier: 1.0.0
        version: 1.0.0
      react-dom:
        specifier: ^18.0.0
        version: 18.2.0(react@18.2.0)
    devDependencies:
      local-thing:
        specifier: link:../local
        version: link:../local
      other-thing:
        specifier: file:../other
        version: file:../other

packages:

  '@fixture/fixture-a@1.0.0':
    resolution: {integrity: sha512-AAAA==, tarball: http://127.0.0.1:4873/@fixture/fixture-a/-/fixture-a-1.0.0.tgz}

  react-dom@18.2.0:
    resolution: {integrity: sha512-BBBB==}
    peerDependencies:
      react: ^18.2.0

  some-git@1.0.0:
    resolution: {commit: abc123, repo: https://example.invalid/x.git, type: git}
    version: 1.0.0

snapshots:

  '@fixture/fixture-a@1.0.0': {}

  react-dom@18.2.0(react@18.2.0):
    dependencies:
      react: 18.2.0
`;

  it("reads a '9.0' lockfile: a peer-suffixed root version stripped, quoted scoped keys, a flow resolution with a tarball, and link/file root dependencies", () => {
    const result = readPnpmLockfile(HAPPY_PATH);
    expect(isUnreadable(result)).toBe(false);
    const view = result as LockfileView;
    expect(view.format).toBe("pnpm");
    expect(view.lockfileVersion).toBe("9.0");
    expect(view.root).toEqual([
      rootDep("dependencies", "@fixture/fixture-a", { specifier: "1.0.0", version: "1.0.0", integrity: "sha512-AAAA==" }),
      rootDep("dependencies", "react-dom", { specifier: "^18.0.0", version: "18.2.0", rawVersion: "18.2.0(react@18.2.0)", integrity: "sha512-BBBB==" }),
      rootDep("devDependencies", "local-thing", { specifier: "link:../local", version: "link:../local", link: true }),
      rootDep("devDependencies", "other-thing", { specifier: "file:../other", version: "file:../other", link: true }),
    ]);
    expect(view.entries).toEqual([
      entry("@fixture/fixture-a@1.0.0", {
        name: "@fixture/fixture-a",
        integrity: "sha512-AAAA==",
        tarball: "http://127.0.0.1:4873/@fixture/fixture-a/-/fixture-a-1.0.0.tgz",
      }),
      entry("react-dom@18.2.0", { name: "react-dom", version: "18.2.0", integrity: "sha512-BBBB==" }),
      entry("some-git@1.0.0", { name: "some-git", integrity: null, tarball: null, otherResolutionKeys: ["commit", "repo", "type"] }),
    ]);
  });

  it("reads a workspace lockfile from '.' only; other importers' dependencies are not in root", () => {
    const doc = `
lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@fixture/fixture-a':
        specifier: 1.0.0
        version: 1.0.0

  packages/a:
    dependencies:
      '@fixture/fixture-b':
        specifier: 2.0.0
        version: 2.0.0

  packages/b: {}

packages:

  '@fixture/fixture-a@1.0.0':
    resolution: {integrity: sha512-AAAA==}

  '@fixture/fixture-b@2.0.0':
    resolution: {integrity: sha512-BBBB==}
`;
    const result = readPnpmLockfile(doc);
    expect(isUnreadable(result)).toBe(false);
    const view = result as LockfileView;
    expect(view.root).toEqual([rootDep("dependencies", "@fixture/fixture-a", { specifier: "1.0.0", version: "1.0.0", integrity: "sha512-AAAA==" })]);
    expect(view.entries.map((e) => e.key)).toEqual(["@fixture/fixture-a@1.0.0", "@fixture/fixture-b@2.0.0"]);
  });

  it("reports lockfileVersion '6.0' as format-unsupported", () => {
    expect(readPnpmLockfile("lockfileVersion: '6.0'\n")).toEqual({ unreadable: true, reason: "lockfile-format-unsupported" });
  });

  it("reports an unquoted lockfileVersion 5.4 as format-unsupported", () => {
    expect(readPnpmLockfile("lockfileVersion: 5.4\n")).toEqual({ unreadable: true, reason: "lockfile-format-unsupported" });
  });

  it("reports an anchor as unreadable", () => {
    const doc = `
lockfileVersion: '9.0'
packages:
  foo@1.0.0:
    resolution: &anchor {integrity: sha512-AAAA==}
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reports an alias as unreadable", () => {
    const doc = `
lockfileVersion: '9.0'
packages:
  foo@1.0.0:
    resolution: *anchor
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reports a tag as unreadable", () => {
    const doc = `
lockfileVersion: '9.0'
packages:
  foo@1.0.0:
    version: !!str 1.0.0
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reports a block scalar ('|') as unreadable", () => {
    const doc = `
lockfileVersion: '9.0'
packages:
  foo@1.0.0:
    resolution: |
      integrity: sha512-AAAA==
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reports a block scalar ('>') as unreadable", () => {
    const doc = `
lockfileVersion: '9.0'
packages:
  foo@1.0.0:
    resolution: >
      folded text
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reports a second document ('---') as unreadable", () => {
    const doc = `
lockfileVersion: '9.0'
packages: {}
---
lockfileVersion: '9.0'
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reports a leading '---' as unreadable", () => {
    const doc = `---
lockfileVersion: '9.0'
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reports a duplicate key as unreadable", () => {
    const doc = `
lockfileVersion: '9.0'
lockfileVersion: '9.0'
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("reads a git resolution's otherResolutionKeys", () => {
    const doc = `
lockfileVersion: '9.0'
packages:
  some-git@1.0.0:
    resolution: {commit: abc123, repo: https://example.invalid/x.git, type: git}
`;
    const result = readPnpmLockfile(doc);
    expect(isUnreadable(result)).toBe(false);
    const view = result as LockfileView;
    expect(view.entries).toEqual([entry("some-git@1.0.0", { name: "some-git", integrity: null, tarball: null, otherResolutionKeys: ["commit", "repo", "type"] })]);
  });

  // ---------------------------------------------------------------------------
  // Fix 9: the reader refuses what it cannot read exactly, rather than reading
  // a disguised structural key as merely absent, an inline flow mapping as
  // empty, a double-quoted escape literally, or a key's own colon as the
  // key/value separator.
  // ---------------------------------------------------------------------------

  it("refuses an anchored 'importers' key rather than reading the section as absent (anchorKey, fix 9)", () => {
    const doc = `
lockfileVersion: '9.0'
&a importers:
  .:
    dependencies: {}
packages: {}
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("refuses a tagged 'packages' key rather than reading the section as absent (tagKey, fix 9)", () => {
    const doc = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies: {}
!!str packages:
  foo@1.0.0:
    resolution: {integrity: sha512-AAAA==}
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("refuses 'packages' written entirely as an inline flow mapping rather than reading it as empty (inlineFlowPackages, fix 9)", () => {
    const doc = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies: {}
packages: {'@fixture/x@2.0.0': {resolution: {integrity: sha512-XXXX==, tarball: 'https://evil.example/x.tgz'}}}
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("refuses a double-quoted packages key holding a hex escape rather than reading it literally (dqkey, fix 9)", () => {
    const doc = `
lockfileVersion: '9.0'
packages:
  "@fixture/\\x66oo@1.0.0":
    resolution: {integrity: sha512-XXXX==}
`;
    expect(readPnpmLockfile(doc)).toEqual({ unreadable: true, reason: "lockfile-unreadable" });
  });

  it("splits a key holding its own colon at the line's final colon, not its first (urlKey, fix 9)", () => {
    const doc = `
lockfileVersion: '9.0'
packages:
  foo@https://codeload.example.invalid/fixture-owner/fixture-archive/tar.gz/abc:
    resolution: {integrity: sha512-XXXX==}
`;
    const result = readPnpmLockfile(doc);
    expect(isUnreadable(result)).toBe(false);
    const view = result as LockfileView;
    expect(view.entries.map((e) => e.key)).toEqual(["foo@https://codeload.example.invalid/fixture-owner/fixture-archive/tar.gz/abc"]);
    expect(view.entries[0]?.name).toBe("foo");
  });
});
