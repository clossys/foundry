import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { RecordError } from "../records/validate.js";
import { libraryRecordSource, libraryRecordStore, listLibraryElements, locateLibraryElement } from "./library-source.js";

const library = fileURLToPath(new URL("./__fixtures__/library/", import.meta.url));
const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), "producer-library-source-"));
  temps.push(dir);
  cpSync(library, dir, { recursive: true });
  return dir;
};

describe("library record source (SU-2A records through the slot engine loaders)", () => {
  it("lists and locates elements by slot/element or a bare element", () => {
    expect(listLibraryElements([library])).toEqual(["components.button/sample-button", "components.card/sample-card", "themes.preset/neutral"]);
    expect(locateLibraryElement([library], "sample-card")).toMatchObject({ slot: "components.card", element: "sample-card" });
    expect(locateLibraryElement([library], "components.card/sample-card")).toMatchObject({ slot: "components.card" });
    expect(locateLibraryElement([library], "../sample-card")).toBeUndefined();
    expect(locateLibraryElement([library], "missing")).toBeUndefined();
  });

  it("hands Publisher a validated record with its preview adapted", async () => {
    const source = libraryRecordSource({ roots: [library], defaultTheme: "neutral" });
    const card = await source.read("sample-card");
    expect(card).toMatchObject({ id: "components.card/sample-card", version: 1, kind: "visual" });
    expect(card!.payload.path).toBe("sample-card.json");
    expect(card!.payload.files.map(file => file.path)).toEqual(["registry/blocks/sample-card.tsx"]);
    expect(card!.preview).toMatchObject({ width: 480, container: "canvas" });
    // A clossys.preview/1 theme is a mode ("light"), never a theme id; the default theme applies.
    expect(card!.preview.theme).toBeUndefined();
    expect(card!.preview.copy?.["card.title"]).toBeDefined();
    expect(card!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await source.read("sample-card", 2)).toBeUndefined();
    const theme = await source.theme();
    expect(theme).toMatchObject({ id: "themes.preset/neutral" });
  });

  it("refuses a record whose payload no longer matches its hash", async () => {
    const dir = copy();
    writeFileSync(join(dir, "components.button/sample-button/v1/sample-button.json"), "{}\n");
    await expect(libraryRecordStore([dir]).load("sample-button")).rejects.toBeInstanceOf(RecordError);
  });

  it("names both slots when a bare element is ambiguous", () => {
    const dir = copy();
    cpSync(join(dir, "components.card/sample-card"), join(dir, "components.panel/sample-card"), { recursive: true });
    expect(() => locateLibraryElement([dir], "sample-card")).toThrow(/2 slots/);
  });
});
