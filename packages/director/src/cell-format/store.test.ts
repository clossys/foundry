import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activate, listCells, propose, readActive } from "./store.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function temp() { const root = mkdtempSync(join(tmpdir(), "cell-format-")); roots.push(root); return root; }
function source(id = "components.button", version = 1, status = "active", newline = "\n") {
  return ["---", `id: ${id}`, `version: ${version}`, `status: ${status}`, "updated: 2026-10-29", "links: []", ...(status === "active" ? ["confirmed: migration:2026-10-29"] : []), "note: Keep exact punctuation.", "originKinds: [authored]", "---", "## Rationale", "- Keep the body byte for byte.  ", "", "## Fill", "```json", '{"value":"A: B","nested":{"keep":true}}', "```", ""].join(newline);
}
function put(root: string, id: string, version: number, text = source(id, version, "draft")) {
  mkdirSync(join(root, "cells", id), { recursive: true }); writeFileSync(join(root, "cells", id, `v${version}.md`), text);
}
function fixture() {
  const root = temp(); put(root, "components.button", 1, source());
  writeFileSync(join(root, "tree.json"), JSON.stringify({ schemaVersion: 1, active: { "components.button": 1 }, retired: [], meta: { keep: "unchanged" } }, null, 2) + "\n");
  return root;
}
function bytes(root: string) { return Object.fromEntries(["tree.json", ...readdirSync(join(root, "cells")).flatMap(id => readdirSync(join(root, "cells", id)).map(name => `cells/${id}/${name}`))].map(path => [path, readFileSync(join(root, path), "utf8")])); }

describe("generic cell store", () => {
  it("lists permanent flat paths and reads tree pointers rather than the highest draft", async () => {
    const root = fixture(); put(root, "components.button", 8);
    expect((await listCells(root)).map(cell => [cell.id, cell.version, cell.path])).toEqual([["components.button", 1, "cells/components.button/v1.md"], ["components.button", 8, "cells/components.button/v8.md"]]);
    const active = await readActive(root);
    expect(active.map(cell => cell.version)).toEqual([1]);
    expect(active[0]!.source).toBe(source());
    expect(await readActive(root, "components.button")).toEqual(active[0]);
    expect(await readActive(root, "assets.missing")).toBeUndefined();
  });
  it("does not parse unselected draft contents and treats null pointers as invisible", async () => {
    const root = fixture(); put(root, "components.button", 2, "unfinished draft");
    expect((await readActive(root))[0]!.version).toBe(1);
    const tree = JSON.parse(readFileSync(join(root, "tree.json"), "utf8")); tree.active["components.button"] = null;
    writeFileSync(join(root, "tree.json"), JSON.stringify(tree));
    expect(await readActive(root)).toEqual([]);
  });
  it("proposes from the active body, allocates after all existing versions, and never overwrites", async () => {
    const root = fixture(); put(root, "components.button", 4, source("components.button", 4, "draft").replace("byte for byte", "UNCONFIRMED"));
    const before = bytes(root); const draft = await propose(root, "components.button");
    expect(draft.version).toBe(5); expect(draft.status).toBe("draft");
    expect(draft.source).toBe(source().replace("version: 1", "version: 5").replace("status: active", "status: draft").replace("confirmed: migration:2026-10-29\n", ""));
    for (const [path, text] of Object.entries(before)) expect(readFileSync(join(root, path), "utf8")).toBe(text);
    expect((await propose(root, "components.button")).version).toBe(6);
  });
  it("activates only exact refs and edits old active/sibling drafts only on their status lines", async () => {
    const root = fixture(); put(root, "components.button", 2, source("components.button", 2, "draft", "\r\n")); put(root, "components.button", 3);
    put(root, "components.button", 4, source("components.button", 4, "retired"));
    const before = bytes(root); const result = await activate(root, ["components.button@2"], { confirm: "msg:2026-10-29-1#U3" });
    expect(result.map(cell => cell.version)).toEqual([2]);
    expect(readFileSync(join(root, "cells/components.button/v1.md"), "utf8")).toBe(before["cells/components.button/v1.md"]!.replace("status: active", "status: retired"));
    expect(readFileSync(join(root, "cells/components.button/v3.md"), "utf8")).toBe(before["cells/components.button/v3.md"]!.replace("status: draft", "status: retired"));
    expect(readFileSync(join(root, "cells/components.button/v4.md"), "utf8")).toBe(before["cells/components.button/v4.md"]);
    expect(result[0]!.source).toBe(before["cells/components.button/v2.md"]!.replace("status: draft", "status: active").replace("\r\n---\r\n##", "\r\nconfirmed: msg:2026-10-29-1#U3\r\n---\r\n##"));
    const tree = JSON.parse(readFileSync(join(root, "tree.json"), "utf8")); expect(tree.active["components.button"]).toBe(2); expect(tree.meta).toEqual({ keep: "unchanged" });
    expect((await readActive(root))[0]!.version).toBe(2);
  });
  it.each([undefined, "", "yes", "msg:2026-10-29-1#A3", "migration:2026-02-30", "migration:2026-10-29"])("refuses an absent or invalid target confirmation %s before mutations", async confirm => {
    const root = fixture(); put(root, "components.button", 2); const before = bytes(root);
    await expect(activate(root, ["components.button@2"], { confirm: confirm as string })).rejects.toThrow();
    expect(bytes(root)).toEqual(before);
  });
  it("allows a migration confirmation only for a v1 draft", async () => {
    const root = fixture(); put(root, "components.button", 1, source("components.button", 1, "draft"));
    const tree = JSON.parse(readFileSync(join(root, "tree.json"), "utf8")); tree.active["components.button"] = null; writeFileSync(join(root, "tree.json"), JSON.stringify(tree));
    expect((await activate(root, ["components.button@1"], { confirm: "migration:2026-10-29" }))[0]!.status).toBe("active");
  });
  it("lets profile validation veto or throw before any write", async () => {
    const root = fixture(); put(root, "components.button", 2); const before = bytes(root);
    await expect(activate(root, ["components.button@2"], { confirm: "msg:2026-10-29-1#U3", beforeActivate: async context => { expect(context.cells[0]!.version).toBe(2); expect(context.active["components.button"]).toBe(1); return false; } })).rejects.toThrow();
    expect(bytes(root)).toEqual(before);
    await expect(activate(root, ["components.button@2"], { confirm: "msg:2026-10-29-1#U3", beforeActivate: () => { throw new Error("profile rejected"); } })).rejects.toThrow("profile rejected");
    expect(bytes(root)).toEqual(before);
  });
  it.each([["components.button@2", "components.button@2"], ["components.button@2", "components.button@3"], ["components.button@2", "assets.missing@1"], ["components.button@1"], ["../escape@2"], ["designer:components.button@2"], []])("refuses invalid batches without partial activation: %j", async (...values) => {
    const refs = values as string[]; const root = fixture(); put(root, "components.button", 2); put(root, "components.button", 3); const before = bytes(root);
    await expect(activate(root, refs, { confirm: "msg:2026-10-29-1#U3" })).rejects.toThrow(); expect(bytes(root)).toEqual(before);
  });
  it("activates a validated multi-cell batch together", async () => {
    const root = fixture(); put(root, "components.button", 2); put(root, "page.home", 1);
    const tree = JSON.parse(readFileSync(join(root, "tree.json"), "utf8")); tree.active["page.home"] = null; writeFileSync(join(root, "tree.json"), JSON.stringify(tree));
    expect((await activate(root, ["components.button@2", "page.home@1"], { confirm: "msg:2026-10-29-1#U3" })).map(cell => cell.id)).toEqual(["components.button", "page.home"]);
    expect((await readActive(root)).map(cell => [cell.id, cell.version])).toEqual([["components.button", 2], ["page.home", 1]]);
  });
  it("rechecks snapshots after an asynchronous validation callback", async () => {
    const root = fixture(); put(root, "components.button", 2); const old = readFileSync(join(root, "cells/components.button/v1.md"), "utf8");
    await expect(activate(root, ["components.button@2"], { confirm: "msg:2026-10-29-1#U3", beforeActivate: async () => { writeFileSync(join(root, "cells/components.button/v2.md"), source("components.button", 2, "draft").replace("Keep exact", "Changed")); } })).rejects.toThrow(/changed/i);
    expect(readFileSync(join(root, "cells/components.button/v1.md"), "utf8")).toBe(old); expect(JSON.parse(readFileSync(join(root, "tree.json"), "utf8")).active["components.button"]).toBe(1);
  });
  it.each([source("page.wrong"), source("components.button", 2), source().replace("status: active", "status: unknown"), source().replace("confirmed: migration:2026-10-29", "confirmed: yes"), source().replace("links: []", "links: [../escape@1]")])("rejects malformed shared metadata and path disagreement", async text => {
    const root = fixture(); put(root, "components.button", 1, text); await expect(listCells(root)).rejects.toThrow();
  });
  it.each(["tree.json", "cells", "cells/components.button", "cells/components.button/v1.md"])("refuses symlink components at %s", async path => {
    const root = fixture(); const outside = temp(); const target = join(outside, "sentinel"); writeFileSync(target, "UNREAD SENTINEL"); rmSync(join(root, path), { recursive: true, force: true }); symlinkSync(target, join(root, path));
    await expect(path === "tree.json" ? readActive(root) : listCells(root)).rejects.toThrow(/symbolic|symlink/i);
  });
  it("rejects traversal, nested layouts, unsafe versions, and symlink roots", async () => {
    const root = fixture(); await expect(propose(root, "../escape")).rejects.toThrow();
    put(root, "components.button", 9007199254740992); await expect(listCells(root)).rejects.toThrow();
    rmSync(join(root, "cells/components.button/v9007199254740992.md")); mkdirSync(join(root, "cells/components.button/nested")); await expect(listCells(root)).rejects.toThrow();
    const alias = join(temp(), "alias"); symlinkSync(root, alias); await expect(listCells(alias)).rejects.toThrow(/symbolic|symlink/i);
  });
});
