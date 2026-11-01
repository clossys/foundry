import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emptySelection, pin, PinRefusedError, restore, type Hash } from "./index.js";

// The real gate (@clossys/designer/ref-verbatim), unmocked: pin() and restore()
// refuse an element version whose code is not its reference plus allowed hunks.
const designer = resolve(dirname(fileURLToPath(import.meta.url)), "../../../designer");
const manifest = JSON.parse(readFileSync(join(designer, "references/manifest.json"), "utf8"));
const button = manifest.items.find((row: { registry: string; name: string }) => row.registry === "shadcn-aria" && row.name === "button");
const STOCK = readFileSync(join(designer, "ui/src/components/ui/button.tsx"), "utf8");
const AT = (n: number) => `2026-10-31T00:00:0${n}.000Z`;
const H = (c: string): Hash => `sha256:${c.repeat(64)}`;

function library(versions: { version: number; text: string }[]) {
  const root = mkdtempSync(join(tmpdir(), "producer-pin-gate-"));
  writeFileSync(join(root, "components.json"), readFileSync(join(designer, "ui/components.json")));
  for (const { version, text } of versions) {
    const dir = join(root, "library", "components.button", "button", `v${version}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "button.tsx"), text);
    const source = { registry: "shadcn-aria", item: "button", version: button.version, hash: button.hash, files: { "button.tsx": "registry/aria-nova/ui/button.tsx" } };
    writeFileSync(join(dir, "element.json"), JSON.stringify({ schema: "clossys.element/1", id: "button", slot: "components.button", version, hash: H(String(version)), lineage: { mode: "verbatim", source }, payload: ["button.tsx"], reads: { copyKeys: [], themeVars: [] } }));
  }
  return root;
}
const el = (version: number) => ({ slot: "components.button", id: "button", version, hash: H(String(version)) });

describe("pin() ref-verbatim gate", () => {
  it("pins a stock reference copy", () => {
    const root = library([{ version: 1, text: STOCK }]);
    const s = pin(emptySelection(), { root, element: el(1), at: AT(1), by: "owner" });
    expect(s.pins["components.button"]).toMatchObject({ element: "button", version: 1 });
  });

  it("mutation 4: refuses a failing candidate and leaves the selection unchanged", () => {
    const root = library([
      { version: 1, text: STOCK },
      { version: 2, text: STOCK.replace("hover:bg-primary/80", "hover:bg-primary/80 shadow-xl") },
    ]);
    const s = pin(emptySelection(), { root, element: el(1), at: AT(1), by: "owner" });
    let refused: unknown;
    try {
      pin(s, { root, element: el(2), at: AT(2), by: "owner" });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(PinRefusedError);
    expect((refused as PinRefusedError).findings.map((f) => f.code)).toEqual(["REF-HUNK-CLASS"]);
    expect((refused as Error).message).toMatch(/pin refused: components\.button\/button@v2/);
    expect(s.history).toHaveLength(1);
  });

  it("refuses a version that is not in the library, and gates restore() the same way", () => {
    const root = library([{ version: 1, text: STOCK }]);
    expect(() => pin(emptySelection(), { root, element: el(3), at: AT(1), by: "owner" })).toThrow(/REF-NO-SOURCE/);
    const s = pin(emptySelection(), { root, element: el(1), at: AT(1), by: "owner" });
    writeFileSync(join(root, "library", "components.button", "button", "v1", "button.tsx"), `${STOCK}\nconsole.log("x")\n`);
    expect(() => restore(s, "e1", { root, at: AT(2), by: "owner" })).toThrow(/REF-HUNK-LOGIC/);
  });
});
