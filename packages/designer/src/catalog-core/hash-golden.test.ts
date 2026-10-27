/**
 * Hash and digest goldens. Every pinned value below was taken from the
 * implementation before the hashing fast path landed; a faster implementation
 * must reproduce each byte. Reference copies of the original algorithms are
 * kept here as an independent oracle for generated inputs.
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { libraryHash, resolve } from "./resolve.js";
import { compositeLibraryHash } from "./library-components.js";
import { componentLibraryHash } from "./resolve-components.js";
import { surfacePortionHash } from "./surface-library.js";
import { compare, metaOf } from "./model.js";
import { loadCatalog } from "./index.js";
import { EXAMPLE_LIBRARY } from "./__fixtures__/example-library.js";
import { completedCatalogLibrary } from "./__fixtures__/completed-catalog-library.js";
import { packageSurfaceLibrary, type PackageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";
import type { LibraryData } from "./types.js";

/** The original stableStringify, verbatim. */
function referenceStringify(value: unknown): string {
  const unsupported = (): never => { throw new TypeError("stableStringify: unsupported value"); };
  const write = (item: unknown, depth: number): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") return Number.isFinite(item) ? JSON.stringify(item) : unsupported();
    if (typeof item !== "object") return unsupported();
    const indent = "  ".repeat(depth);
    const nested = "  ".repeat(depth + 1);
    if (Array.isArray(item)) {
      if (item.length === 0) return "[]";
      return "[\n" + Array.from(item, entry => nested + (entry === undefined ? "null" : write(entry, depth + 1))).join(",\n") + "\n" + indent + "]";
    }
    const object = item as Record<string, unknown>;
    const keys = Object.keys(object).filter(key => object[key] !== undefined).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    if (keys.length === 0) return "{}";
    return "{\n" + keys.map(key => nested + JSON.stringify(key) + ": " + write(object[key], depth + 1)).join(",\n") + "\n" + indent + "}";
  };
  return write(value, 0) + "\n";
}
/** The original BigInt FNV-1a 64 profile hash, verbatim. */
function referenceLibraryHash(library: LibraryData): string {
  let hash = 0xcbf29ce484222325n;
  const ordered = { ...library, fills: [...library.fills].sort((a, b) => compare(metaOf(a).id, metaOf(b).id)) };
  for (const byte of new TextEncoder().encode(referenceStringify(ordered))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
const nodeSha256 = (text: string) => createHash("sha256").update(Buffer.from(new TextEncoder().encode(text))).digest("hex");

/** Deterministic generator: strings exercise 1-4 byte UTF-8, lone surrogates and JSON escapes. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
  const alphabet = ["a", "Z", "0", " ", "\"", "\\", "\n", "\t", "\u0001", "\u007f", "é", "ß", "߿", "ࠀ", "中", "￿", "😀", "\ud800", "\udfff", "\ud83d", "-", "_", "."];
  const text = (max: number) => Array.from({ length: Math.floor(next() * max) }, () => alphabet[Math.floor(next() * alphabet.length)]!).join("");
  const value = (depth: number): unknown => {
    const pick = next();
    if (depth > 3 || pick < 0.25) return text(12);
    if (pick < 0.35) return Math.floor(next() * 2_000_000) - 1_000_000;
    if (pick < 0.4) return next() * 1e6;
    if (pick < 0.45) return next() < 0.5;
    if (pick < 0.5) return null;
    if (pick < 0.7) return Array.from({ length: Math.floor(next() * 5) }, () => next() < 0.1 ? undefined : value(depth + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(next() * 6) }, () => [text(6), next() < 0.1 ? undefined : value(depth + 1)]));
  };
  return { next, text, value };
}

describe("sha256 golden", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["a".repeat(55), "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"],
    ["a".repeat(56), "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"],
    ["a".repeat(63), "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34"],
    ["a".repeat(64), "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"],
    ["a".repeat(65), "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0"],
    ["a".repeat(1000), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"],
  ])("pins FIPS-shaped vectors (%#)", (text, hex) => expect(sha256(text)).toBe(hex));
  it("pins multi-byte and lone-surrogate encodings", () => {
    expect(sha256("é😀中ࠀ߿")).toMatchInlineSnapshot(`"0710405c2678f2aedc91ff02f5fe68d1bafca5991a8683c216ba1eef014a4214"`);
    expect(sha256("\ud800x\udfff\ud83d")).toMatchInlineSnapshot(`"fd9c9e8e960bff0ea544fc7fbf4c49e390455a63cd8ff3871c06d1a90b3cc036"`);
  });
  it("matches node:crypto over UTF-8 for every length across three blocks and generated text", () => {
    for (let length = 0; length <= 200; length++) {
      const text = "x".repeat(length);
      expect(sha256(text), String(length)).toBe(nodeSha256(text));
    }
    const { text } = generator(7);
    for (let i = 0; i < 400; i++) { const sample = text(300); expect(sha256(sample), JSON.stringify(sample)).toBe(nodeSha256(sample)); }
  });
});

describe("stableStringify and libraryHash golden", () => {
  it("matches the original serializer over generated values", () => {
    const { value } = generator(11);
    for (let i = 0; i < 1000; i++) { const sample = value(0); expect(stableStringify(sample)).toBe(referenceStringify(sample)); }
  });
  it("matches the original serializer on unsupported values and sparse arrays", () => {
    for (const bad of [undefined, NaN, -Infinity, () => 1, 1n, Symbol("x"), { a: [1, () => 1] }, [Symbol("y")]]) {
      expect(() => stableStringify(bad)).toThrow(new TypeError("stableStringify: unsupported value"));
      expect(() => referenceStringify(bad)).toThrow(new TypeError("stableStringify: unsupported value"));
    }
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3, undefined, -0, 1e21, 5e-7, { b: undefined }, [], {}, new Date(0)];
    expect(stableStringify(sparse)).toBe(referenceStringify(sparse));
    expect(stableStringify("top")).toBe(referenceStringify("top"));
  });
  it("pins example and completed-catalog library hashes", () => {
    expect(libraryHash(EXAMPLE_LIBRARY)).toMatchInlineSnapshot(`"fnv1a64:1c49785731fe8224"`);
    const completed = completedCatalogLibrary(loadCatalog(), { id: "golden-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-26");
    expect(libraryHash(completed)).toMatchInlineSnapshot(`"fnv1a64:a01437f615d70c71"`);
    expect(nodeSha256(stableStringify(completed))).toMatchInlineSnapshot(`"d630f7c8839bedabee219a017555d8ac297afef961105edfa2fdb5bddd627b5b"`);
    expect(libraryHash(completed)).toBe(referenceLibraryHash(completed));
    expect(resolve({ catalog: loadCatalog(), library: completed }).selectionHash).toBe(libraryHash(completed));
  }, 120_000);
  it("matches the original FNV-1a 64 over generated libraries, including lone surrogates", () => {
    const { value, text } = generator(23);
    for (let i = 0; i < 200; i++) {
      const library = { source: { id: text(8), kind: "consumer", author: "consumer", license: text(4) }, fills: Array.from({ length: i % 4 }, (_, n) => ({ $extensions: { "com.clossys.fill": { id: `${text(3)}${n}` } }, payload: value(1) })), extra: value(0) } as unknown as LibraryData;
      expect(libraryHash(library)).toBe(referenceLibraryHash(library));
    }
  });
});

describe("real package-surface library golden", () => {
  let fixture: PackageSurfaceLibrary;
  beforeAll(async () => { fixture = await packageSurfaceLibrary(); }, 300_000);
  it("pins the composite, value, component and surface portion hashes", () => {
    const { library } = fixture;
    expect(compositeLibraryHash(library)).toMatchInlineSnapshot(`"sha256:f4846eadb7384b700b166ca5f57893028f3675e6c4e07bf331bdff5cc5602b27"`);
    const values = { ...library.values, source: library.source, adoptedAt: library.adoptedAt } as LibraryData;
    expect(libraryHash(values)).toMatchInlineSnapshot(`"fnv1a64:9ef6b0d04daed3a9"`);
    expect(libraryHash(values)).toBe(referenceLibraryHash(values));
    expect(componentLibraryHash({ ...library.components, source: library.source, adoptedAt: library.adoptedAt })).toMatchInlineSnapshot(`"sha256:b22d62a9c0cd1212becdccd47ec4d4ac552808b3731ad29b91f97eae477861a9"`);
    expect(surfacePortionHash(library.surfaces!)).toMatchInlineSnapshot(`"sha256:d2e3d90c4c3b9c25c8155da771501dcfad5575ebd35696589cf23c3961325892"`);
    expect(nodeSha256(stableStringify(library))).toMatchInlineSnapshot(`"a38e8e0cbe9feeb87173e194169df7103173337decca055eae14f99475022968"`);
    expect(stableStringify(library)).toBe(referenceStringify(library));
  });
});
