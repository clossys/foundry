import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkElement, adaptationHash } from "@clossys/designer/ref-verbatim";
// @ts-expect-error ESM reference normalizer has no TypeScript declaration.
import { normalizeReference, configFromComponents } from "../../../designer/scripts/ref-verbatim/normalize.mjs";
// @ts-expect-error ESM AST comparator has no TypeScript declaration.
import { diffSources } from "../../../designer/scripts/ref-verbatim/diff.mjs";
import { emptySelection, pin, PinRefusedError, restore, writeSelection, hashFiles, type Hash } from "./index.js";

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
    writeFileSync(join(dir, "preview.json"), JSON.stringify({ schema: "clossys.preview/1", fixtures: {}, copy: {}, container: "canvas", theme: "light", width: 1280 }));
    writeFileSync(join(dir, "element.json"), JSON.stringify({ schema: "clossys.element/1", id: "button", slot: "components.button", version, hash: hashFiles(dir, ["button.tsx"]), package: "designer", layer: "components", kind: "registry:ui", license: { spdx: "MIT" }, creator: { agent: "fixture-agent", model: "fixture" }, reason: "Exact stock reference fixture", createdAt: AT(0), checks: [], deps: { npm: {}, elements: [] }, lineage: { mode: "verbatim", source }, payload: ["button.tsx"], reads: { copyKeys: [], themeVars: [] } }));
  }
  writeFileSync(join(root, "approvals.json"), JSON.stringify({ schema: "clossys.owner-approvals/1", records: versions.map(({ version }) => ({ id: `approve-${version}`, actor: "owner", owner: "fixture-owner", reference: "explicit owner fixture decision", at: "2026-10-30T00:00:00Z", action: "pin", slot: "components.button", element: "button", version, hash: hashFiles(join(root, "library/components.button/button", `v${version}`), ["button.tsx"]) })) }));
  return root;
}
const el = (root: string, version: number) => ({ slot: "components.button", id: "button", version,
  hash: existsSync(join(root, "library/components.button/button", `v${version}/element.json`))
    ? JSON.parse(readFileSync(join(root, "library/components.button/button", `v${version}/element.json`), "utf8")).hash : H("0"),
});

describe("pin() ref-verbatim gate", () => {
  it("stock picks and direct selection writes require provenance, not owner approval", () => {
    const root = library([{ version: 1, text: STOCK }]);
    const s = pin(emptySelection(), { root, element: el(root, 1), at: AT(1), by: "agent" });
    expect(() => writeSelection(root, s)).not.toThrow();
    expect(Object.hasOwn(s.history[0]!, "approval")).toBe(false);
    const restored = restore(s, "e1", { root, at: AT(2), by: "agent" });
    expect(Object.hasOwn(restored.history[1]!, "approval")).toBe(false);
    expect(() => writeSelection(root, restored)).not.toThrow();
  });

  it("pins a stock reference copy", () => {
    const root = library([{ version: 1, text: STOCK }]);
    const s = pin(emptySelection(), { root, element: el(root, 1), at: AT(1), by: "agent", approval: "approve-1" });
    expect(s.pins["components.button"]).toMatchObject({ element: "button", version: 1 });
    expect(s.history[0]!.approval).toBe("approve-1");
  });

  it("mutation 4: refuses a failing candidate and leaves the selection unchanged", () => {
    const root = library([
      { version: 1, text: STOCK },
      { version: 2, text: STOCK.replace("hover:bg-primary/80", "hover:bg-primary/80 shadow-xl") },
    ]);
    const s = pin(emptySelection(), { root, element: el(root, 1), at: AT(1), by: "agent", approval: "approve-1" });
    let refused: unknown;
    try {
      pin(s, { root, element: el(root, 2), at: AT(2), by: "agent", approval: "approve-2" });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(PinRefusedError);
    expect((refused as PinRefusedError).findings.map((f) => f.code)).toEqual(["REF-HUNK-CLASS"]);
    expect((refused as Error).message).toMatch(/pin refused: components\.button\/button@v2/);
    expect(s.history).toHaveLength(1);
  });

  it("binds CREATE pin, restore and direct history writes to verified payload bytes", () => {
    const root = library([{ version: 1, text: STOCK }]);
    const dir = join(root, "library/components.button/button/v1");
    const recordPath = join(dir, "element.json");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    record.lineage.path = "create";
    record.lineage.ownerRequest = "create-button";
    writeFileSync(recordPath, JSON.stringify(record));
    const approvals = JSON.parse(readFileSync(join(root, "approvals.json"), "utf8"));
    approvals.records.push({ id: "create-button", actor: "owner", owner: "fixture-owner", reference: "Owner fixture create request", at: AT(0), action: "create", slot: "components.button", element: "button" });
    writeFileSync(join(root, "approvals.json"), JSON.stringify(approvals));
    const input = { root, element: el(root, 1), at: AT(1), by: "agent", approval: "approve-1" };
    const selected = pin(emptySelection(), input);
    writeSelection(root, selected);
    expect(() => pin(emptySelection(), { ...input, approval: undefined })).toThrow(/OWNER-APPROVAL/);
    expect(() => pin(emptySelection(), { ...input, element: { ...input.element, hash: H("0") } })).toThrow(/PIN-HASH/);
    const path = "registry/aria-nova/ui/button.tsx";
    const raw = readFileSync(join(designer, "references/shadcn-aria/button@4.23.0", path), "utf8");
    const config = configFromComponents(JSON.parse(readFileSync(join(root, "components.json"), "utf8")));
    const normalized = normalizeReference(raw, path, config);
    const altered = STOCK.replace('"cn"', '"./different-utils"');
    expect(altered).not.toBe(STOCK);
    record.lineage.adaptations = diffSources(normalized, path, altered, "button.tsx").hunks.map((hunk: any) => ({
      kind: "import-paths", file: "button.tsx", reason: "Resolve this fixture's local helper", hash: adaptationHash(hunk, normalized, altered),
    }));
    writeFileSync(recordPath, JSON.stringify(record));
    writeFileSync(join(dir, "button.tsx"), altered);
    expect(hashFiles(dir, ["button.tsx"])).not.toBe(record.hash);
    expect(checkElement(root, "components.button/button/v1", { strict: true }).findings).toEqual([]);
    const direct = { ...selected, pins: { "components.button": { ...selected.pins["components.button"]!, event: "e2" } },
      history: [...selected.history, { ...selected.history[0]!, id: "e2", at: AT(2) }] };
    expect.soft(() => pin(selected, input), "pin rejects changed payload bytes").toThrow(/payload hash/);
    expect.soft(() => restore(selected, "e1", { root, at: AT(2), by: "agent", approval: "approve-1" }), "restore rejects changed payload bytes").toThrow(/payload hash/);
    expect.soft(() => writeSelection(root, direct), "direct history write rejects changed payload bytes").toThrow(/payload hash/);
    expect.soft(JSON.parse(readFileSync(join(root, "selection.json"), "utf8")), "refusal preserves selection bytes").toEqual(selected);
    record.hash = hashFiles(dir, ["button.tsx"]);
    writeFileSync(recordPath, JSON.stringify(record));
    expect(() => pin(selected, { ...input, element: el(root, 1) })).toThrow(/OWNER-APPROVAL/);
  });

  it("refuses a version that is not in the library, and gates restore() the same way", () => {
    const root = library([{ version: 1, text: STOCK }]);
    expect(() => pin(emptySelection(), { root, element: el(root, 3), at: AT(1), by: "agent", approval: "approve-3" })).toThrow(/ENOENT|REF-NO-SOURCE/);
    const s = pin(emptySelection(), { root, element: el(root, 1), at: AT(1), by: "agent", approval: "approve-1" });
    writeFileSync(join(root, "library", "components.button", "button", "v1", "button.tsx"), `${STOCK}\nconsole.log("x")\n`);
    expect(() => restore(s, "e1", { root, at: AT(2), by: "agent", approval: "approve-1" })).toThrow(/payload hash|REF-HUNK-LOGIC/);
  });
});


it("native pin and restore never fall back to legacy mappings after exact proof tampering", () => {
  const root = library([{ version: 1, text: STOCK }]);
  const input = { root, element: el(root, 1), at: AT(1), by: "agent" };
  const selected = pin(emptySelection(), input);
  writeSelection(root, selected);
  const selectionBefore = readFileSync(join(root, "selection.json"), "utf8");
  const recordPath = join(root, "library/components.button/button/v1/element.json");
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const upstream = button.files.find((file: { path: string }) => file.path === "registry/aria-nova/ui/button.tsx");
  record.lineage.exactParts = {
    schema: "ref-exact-parts/1", payload: { "button.tsx": record.hash.slice(7) },
    files: { "button.tsx": { sha256: "0".repeat(64), segments: [{
      start: 0, endExclusive: Buffer.byteLength(STOCK), edits: [], source: {
        reference: 0, path: upstream.path, upstream: manifest.registries["shadcn-aria"].upstream,
        fileSha256: upstream.sha256, start: 0, endExclusive: upstream.bytes, sha256: upstream.sha256,
        license: { path: "shadcn-aria/LICENSE.md", sha256: "0".repeat(64), payloadPath: "LICENSE" },
      },
    }] } }, closure: { roots: ["button.tsx"], imports: [] },
  };
  // Bind the actual emitted file hash; leave only the part evidence corrupted.
  record.lineage.exactParts.payload["button.tsx"] = createHash("sha256").update(STOCK).digest("hex");
  writeFileSync(recordPath, JSON.stringify(record));
  expect(() => pin(selected, { ...input, at: AT(2) })).toThrow(/REF-PART-PROOF/);
  expect(() => restore(selected, "e1", { root, at: AT(2), by: "agent" })).toThrow(/REF-PART-PROOF/);
  expect(readFileSync(join(root, "selection.json"), "utf8")).toBe(selectionBefore);
  expect(selected.history).toHaveLength(1);
});
