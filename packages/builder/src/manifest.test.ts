import { describe, expect, it } from "vitest";
import { loadManifest } from "./manifest.js";

const base = { version: 1 };

describe("loadManifest", () => {
  it("accepts a minimal manifest and normalizes absent collections", () => {
    const manifest = loadManifest(base);
    expect(manifest.links).toEqual([]);
    expect(manifest.copies).toEqual([]);
    expect(manifest.managedBlocks).toEqual([]);
    expect(manifest.privateDirectories).toEqual([]);
  });

  it("rejects an unsupported version", () => {
    expect(() => loadManifest({ version: 2 })).toThrow(/supported version 1/);
  });

  // Two entries owning one destination is a race whose loser leaves no trace.
  it("rejects a destination managed more than once, across collections", () => {
    expect(() =>
      loadManifest({
        ...base,
        links: [{ source: "a", destination: "${HOME}/x" }],
        copies: [{ source: "b", destination: "${HOME}/x" }],
      }),
    ).toThrow(/manages destination more than once/);
  });

  // The rule the templated-defaults decision requires: a symlink has no content
  // of its own, so a templated link installs a literal token that reads like an
  // instruction.
  it("rejects a templated link", () => {
    expect(() =>
      loadManifest({
        ...base,
        links: [{ source: "guidance.txt", destination: "${HOME}/g.txt", template: true }],
      }),
    ).toThrow(/links entries cannot be templated/);
  });

  it("requires exactly one of source or target on a link", () => {
    expect(() => loadManifest({ ...base, links: [{ destination: "${HOME}/x" }] })).toThrow(
      /exactly one of source or target/,
    );
    expect(() =>
      loadManifest({ ...base, links: [{ source: "a", target: "/b", destination: "${HOME}/x" }] }),
    ).toThrow(/exactly one of source or target/);
  });

  it("accepts a link declared by target", () => {
    const manifest = loadManifest({
      ...base,
      links: [{ target: "${HOME}/.agents/guidance.txt", destination: "${HOME}/.codex/guidance.txt" }],
    });
    expect(manifest.links).toHaveLength(1);
  });

  it("rejects a non-octal mode", () => {
    expect(() =>
      loadManifest({ ...base, copies: [{ source: "a", destination: "${HOME}/x", mode: "rw-" }] }),
    ).toThrow(/octal string/);
  });

  it("rejects managed blocks with missing, identical, or empty markers", () => {
    expect(() =>
      loadManifest({
        ...base,
        managedBlocks: [{ source: "a", destination: "${HOME}/.zshrc", startMarker: "#>", endMarker: "#>" }],
      }),
    ).toThrow(/markers must be distinct/);
    expect(() =>
      loadManifest({
        ...base,
        managedBlocks: [{ source: "a", destination: "${HOME}/.zshrc", startMarker: "#>" }],
      }),
    ).toThrow(/endMarker/);
  });

  it("requires an explicit create flag on a private directory", () => {
    expect(() => loadManifest({ ...base, privateDirectories: [{ path: "${HOME}/.ssh" }] })).toThrow(
      /must declare create/,
    );
  });

  it("rejects a non-object manifest", () => {
    expect(() => loadManifest(null)).toThrow(/must be an object/);
    expect(() => loadManifest({ ...base, links: "nope" })).toThrow(/must be an array/);
  });
});
