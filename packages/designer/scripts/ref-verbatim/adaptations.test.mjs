import assert from "node:assert/strict";
import { test } from "node:test";
import { staticSingleOptionRow } from "./adaptations.mjs";
const menu = '<DropdownMenu><DropdownMenuTrigger asChild><Button className="flex gap-2"><span>Workspace</span></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Workspace</DropdownMenuItem></DropdownMenuContent></DropdownMenu>';
const source = `export const Row = () => ${menu}`;
const adaptation = { operation: "single-option-static-row", optionCount: 1, menu, reason: "One workspace option has no choice" };
test("data-fit keeps the stock trigger body verbatim, and cannot carry replacement code", () => {
  const result = staticSingleOptionRow(source, "row.tsx", adaptation);
  assert.equal(result, 'export const Row = () => <Button className="flex gap-2"><span>Workspace</span></Button>');
  assert.throws(() => staticSingleOptionRow(source, "row.tsx", { ...adaptation, reason: " " }));
  assert.throws(() => staticSingleOptionRow(source, "row.tsx", { ...adaptation, menu: menu.replace("gap-2", "gap-8") }));
});
test("data-fit refuses multi-option, dynamic-option and invented operations", () => {
  const multiple = menu.replace("</DropdownMenuContent>", "<DropdownMenuItem>Other</DropdownMenuItem></DropdownMenuContent>");
  assert.throws(() => staticSingleOptionRow(`export const Row = () => ${multiple}`, "row.tsx", { ...adaptation, menu: multiple }), /exactly one/);
  const dynamic = menu.replace("<DropdownMenuItem>Workspace</DropdownMenuItem>", "{options.map(option => <DropdownMenuItem>{option.label}</DropdownMenuItem>)}");
  assert.throws(() => staticSingleOptionRow(`export const Row = () => ${dynamic}`, "row.tsx", { ...adaptation, menu: dynamic }), /dynamic/);
  assert.throws(() => staticSingleOptionRow(source, "row.tsx", { ...adaptation, operation: "rewrite-layout" }));
});

// G12: an npm candidate's lockfile and install lookups stay inside the consumer's repository,
// and its LICENCE.md record is the installed package's own licence file.
test("G12: npm lookups stop at the repository, and LICENCE.md must be the package's licence byte for byte", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { checkRegistryItem } = await import("../check-ref-verbatim.mjs");
  const LICENSE = "MIT License\n\nCopyright (c) fixture\n";
  const install = (dir, { licence = LICENSE } = {}) => {
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/@xyflow/react": { version: "12.12.1" } } }));
    mkdirSync(join(dir, "node_modules/@xyflow/react"), { recursive: true });
    writeFileSync(join(dir, "node_modules/@xyflow/react/package.json"), JSON.stringify({ name: "@xyflow/react", version: "12.12.1" }));
    if (licence !== null) writeFileSync(join(dir, "node_modules/@xyflow/react/LICENSE"), licence);
  };
  const repo = (dir, { lock = true, licence } = {}) => {
    mkdirSync(join(dir, ".git"), { recursive: true });
    if (lock) install(dir, { licence });
    mkdirSync(join(dir, "clossys"), { recursive: true });
    return join(dir, "clossys");
  };
  const item = (licence) => ({ name: "canvas", type: "registry:lib", files: [...(licence === undefined ? [] : [{ path: "LICENCE.md", content: licence }]), { path: "flow-canvas.ts", content: 'export { ReactFlow } from "@xyflow/react"\n' }], meta: { source: { kind: "npm", ref: ["npm/@xyflow/react@12.12.1"] } } });
  const codes = (root, candidate) => [...new Set(checkRegistryItem(root, "components.flow.canvas", candidate, { strict: true }).findings.map(f => f.code))].sort();

  // The licence record: the package's own LICENSE passes; anything else, or a package with no licence file, fails.
  const ok = repo(mkdtempSync(join(tmpdir(), "g12-licence-")));
  assert.deepEqual(codes(ok, item(LICENSE)), []);
  assert.deepEqual(codes(ok, item("MIT")), ["REF-NPM-ASSET"]);
  assert.deepEqual(codes(repo(mkdtempSync(join(tmpdir(), "g12-nolicence-")), { licence: null }), item(LICENSE)), ["REF-NPM-ASSET"]);
  assert.deepEqual(codes(ok, item(undefined)), []);

  // A lockfile and install above the repository (a home or temp folder) resolve nothing.
  const outer = mkdtempSync(join(tmpdir(), "g12-outer-"));
  install(outer);
  const inner = repo(join(outer, "repo"), { lock: false });
  assert.deepEqual(codes(inner, item(undefined)), ["REF-NPM-VERSION"]);
  // A root in no repository is its own boundary.
  const bare = mkdtempSync(join(tmpdir(), "g12-bare-"));
  install(bare);
  mkdirSync(join(bare, "clossys"));
  assert.deepEqual(codes(join(bare, "clossys"), item(undefined)), ["REF-NPM-VERSION"]);
});
