import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #889's fix (see `client.tsx`'s, `proxy.ts`'s, `server-routes.tsx`'s, and
 * `verify.ts`'s own headers) is provable only if it is CONFIRMED against
 * what actually ships, not asserted in prose — that is exactly what let
 * #889 happen unnoticed: `README.md` claimed every Clerk web entry point
 * guarded its own optional peer with `assertPeerVersion`, and three of
 * the five did not, with nothing checking. This file is that check. It enumerates every `exports` subpath
 * from this package's own `package.json` — never a hand-maintained list,
 * which is exactly the kind of list that drifted silently before —
 * resolves each subpath's BUILT `dist/` entry point (never `src/`: what a
 * consumer actually resolves is `dist/`, per package.json's own `files`
 * allowlist), walks its real, relative import graph within `dist/`, and
 * asserts, for every optional peer (`package.json`'s
 * `peerDependenciesMeta`) that graph imports as a bare specifier: either
 * some file in that same graph calls `assertPeerVersion({ peer: "<name>",
 * ... })`, or the pair has an explicit, named entry in
 * `DELIBERATE_EXCEPTIONS` below, each carrying its own reason. A subpath
 * that imports a peer with neither is a real, newly introduced gap, and
 * this test names exactly which subpath and which peer — the same
 * enumerate-and-confirm shape `internal/peer-guard-coverage.test.ts`
 * already established in `@clossys/designer` (#182).
 *
 * `DELIBERATE_EXCEPTIONS` is checked in BOTH directions, so it cannot go
 * stale in either one: an entry whose peer the graph no longer imports
 * fails (remove the dead exception), and an entry whose peer now HAS a
 * guard also fails (remove the now-unnecessary exception) — see the loop
 * below. Today's two entries are `@clerk/nextjs` at
 * `./providers/clerk/web` (and its `/client` alias) and at
 * `./providers/clerk/web/proxy`: that peer's own `exports` map declares
 * no `./package.json` subpath and its public surface exports no version
 * constant of any kind, so there is no signal a browser- or edge-safe
 * module can read without `node:fs` — confirmed unusable there by
 * bundling `internal/resolve-installed-peer-version.ts` with `esbuild
 * --platform=browser` (fails on `node:fs`/`node:module`/`node:path`; see
 * `client.tsx`'s and `proxy.ts`'s own headers for the full measurement).
 * This is a permanent constraint of `@clerk/nextjs`'s own published
 * shape, not a gap in this package's effort.
 *
 * Run `npm run build` before this test — it reads `dist/`, and fails
 * loudly, not silently, if `dist/` does not exist yet.
 */

const testFileDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testFileDir, "..", "..");
const distRoot = join(packageRoot, "dist");

interface ExportsEntry {
  import?: string;
  types?: string;
}

interface PackageManifest {
  exports: Record<string, ExportsEntry | string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as PackageManifest;

/** Every optional peer this package declares — the universe this test checks coverage for. Never hand-copied elsewhere. */
const OPTIONAL_PEERS = Object.keys(manifest.peerDependenciesMeta ?? {});

/**
 * `[subpath, peer]` pairs whose dist graph imports `peer` but
 * deliberately calls no `assertPeerVersion` for it. See this file's own
 * header for today's two entries and why. Checked in both directions
 * below — see the per-subpath loop.
 */
const DELIBERATE_EXCEPTIONS: Record<string, readonly string[]> = {
  "./providers/clerk/web": ["@clerk/nextjs"],
  "./providers/clerk/web/client": ["@clerk/nextjs"],
  "./providers/clerk/web/proxy": ["@clerk/nextjs"],
};

function subpathEntryFile(subpath: string): string {
  const entry = manifest.exports[subpath];
  const importPath = typeof entry === "string" ? entry : entry.import;
  if (!importPath) throw new Error(`package.json's exports["${subpath}"] has no "import" condition`);
  return resolve(packageRoot, importPath);
}

/** Bare (non-relative) specifiers a compiled file's source text imports, re-exports, or dynamically imports. */
function bareSpecifiersIn(code: string): string[] {
  const specifiers: string[] = [];
  for (const match of code.matchAll(/(?:from\s+|import\()\s*["']([^"'.][^"']*)["']/g)) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

/** Relative specifiers a compiled file imports/re-exports/dynamically imports, resolved to absolute dist paths. */
function relativeImportsIn(code: string, fromFile: string): string[] {
  const resolved: string[] = [];
  for (const match of code.matchAll(/(?:from\s+|import\()\s*["'](\.[^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier) resolved.push(resolve(dirname(fromFile), specifier));
  }
  return resolved;
}

function specifierNamesPeer(specifier: string, peer: string): boolean {
  return specifier === peer || specifier.startsWith(`${peer}/`);
}

interface GraphWalkResult {
  requiredPeers: Set<string>;
  guardedPeers: Set<string>;
}

/** Walks a dist entry file's real, relative import graph (never leaving dist/), collecting which optional peers it requires and which it guards. */
function walkDistGraph(entryFile: string): GraphWalkResult {
  const visited = new Set<string>();
  const requiredPeers = new Set<string>();
  const guardedPeers = new Set<string>();
  const queue = [entryFile];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) throw new Error(`"${relative(packageRoot, entryFile)}"'s graph reaches "${relative(packageRoot, file)}", which does not exist — run \`npm run build\` first`);
    const code = readFileSync(file, "utf8");
    for (const specifier of bareSpecifiersIn(code)) {
      for (const peer of OPTIONAL_PEERS) if (specifierNamesPeer(specifier, peer)) requiredPeers.add(peer);
    }
    if (code.includes("assertPeerVersion(")) {
      for (const peer of OPTIONAL_PEERS) if (code.includes(`peer: "${peer}"`)) guardedPeers.add(peer);
    }
    for (const next of relativeImportsIn(code, file)) queue.push(next);
  }
  return { requiredPeers, guardedPeers };
}

function collectDistJsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectDistJsFiles(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("peer guard coverage (#889) — derived from package.json's own exports map", () => {
  it("dist/ has been built — this test reads compiled output, never src/", () => {
    expect(existsSync(distRoot), "run `npm run build` before this test").toBe(true);
  });

  it("package.json declares the exports subpaths and optional peers this test assumes — a change here should be a deliberate one", () => {
    expect(Object.keys(manifest.exports).sort()).toEqual([
      ".",
      "./agent",
      "./providers/clerk",
      "./providers/clerk/web",
      "./providers/clerk/web/client",
      "./providers/clerk/web/proxy",
      "./providers/clerk/web/server",
    ]);
    expect(OPTIONAL_PEERS.sort()).toEqual(["@clerk/nextjs", "next", "react", "react-dom", "svix"]);
  });

  for (const subpath of Object.keys(manifest.exports)) {
    it(`"${subpath}": every optional peer its dist graph imports is either range-guarded or a named, still-accurate exception`, () => {
      const { requiredPeers, guardedPeers } = walkDistGraph(subpathEntryFile(subpath));
      const exceptions = new Set(DELIBERATE_EXCEPTIONS[subpath] ?? []);

      for (const exceptionPeer of exceptions) {
        expect(requiredPeers.has(exceptionPeer), `"${subpath}"'s DELIBERATE_EXCEPTIONS entry names "${exceptionPeer}", but its dist graph no longer imports that peer at all — remove the stale exception`).toBe(true);
        expect(guardedPeers.has(exceptionPeer), `"${subpath}"'s DELIBERATE_EXCEPTIONS entry names "${exceptionPeer}", but a guard for it now exists in its dist graph — remove the now-unnecessary exception`).toBe(false);
      }

      const unguarded = [...requiredPeers].filter((peer) => !guardedPeers.has(peer) && !exceptions.has(peer));
      expect(unguarded, `"${subpath}" imports ${JSON.stringify(unguarded)} as a bare specifier without a range guard and without a documented DELIBERATE_EXCEPTIONS entry`).toEqual([]);
    });
  }

  it("svix is range-guarded from ./providers/clerk", () => {
    const { guardedPeers } = walkDistGraph(subpathEntryFile("./providers/clerk"));
    expect(guardedPeers.has("svix")).toBe(true);
  });

  it("@clerk/nextjs and next are BOTH range-guarded from ./providers/clerk/web/server", () => {
    const { guardedPeers } = walkDistGraph(subpathEntryFile("./providers/clerk/web/server"));
    expect(guardedPeers.has("@clerk/nextjs")).toBe(true);
    expect(guardedPeers.has("next")).toBe(true);
  });

  it("react is range-guarded from ./providers/clerk/web and its /client alias", () => {
    for (const subpath of ["./providers/clerk/web", "./providers/clerk/web/client"]) {
      const { guardedPeers } = walkDistGraph(subpathEntryFile(subpath));
      expect(guardedPeers.has("react"), subpath).toBe(true);
    }
  });

  it("next is range-guarded from ./providers/clerk/web/proxy (#889's fix)", () => {
    const { requiredPeers, guardedPeers } = walkDistGraph(subpathEntryFile("./providers/clerk/web/proxy"));
    expect(requiredPeers.has("next")).toBe(true);
    expect(guardedPeers.has("next")).toBe(true);
  });

  it("react-dom has no import site anywhere in this package's built output — nothing to guard", () => {
    const importers = collectDistJsFiles(distRoot)
      .filter((file) => bareSpecifiersIn(readFileSync(file, "utf8")).some((specifier) => specifierNamesPeer(specifier, "react-dom")))
      .map((file) => relative(packageRoot, file));
    expect(importers).toEqual([]);
  });
});
