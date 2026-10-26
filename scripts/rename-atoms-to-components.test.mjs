import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { applyRename, planRename, renameText } from "./rename-atoms-to-components.mjs";

const script = fileURLToPath(new URL("./rename-atoms-to-components.mjs", import.meta.url));
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "component-rename-test-"));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  try { return run(root, put); } finally { rmSync(root, { recursive: true, force: true }); }
}
test("moves directories before renaming files and all public layer forms, with no compatibility alias", () => fixture((root, put) => {
  put("packages/designer/src/atoms/index.ts", 'export { ATOM_GUIDANCE }; type AtomGuidance = { atoms: string[] }; const selectedAtom = "atoms"; // anatomy atomic atomically\n');
  put("packages/designer/examples/atoms/button.tsx", 'import { Button } from "@clossys/designer/atoms/server";');
  put("packages/designer/src/catalog/atoms.ts", 'export const ATOM_CATALOG = { kind: "atoms" };');
  put("packages/designer/package.json", '{"version":"0.12.0","exports":{"./atoms":"./dist/atoms/index.js"}}');
  put("packages/publisher/src/core/relations.ts", 'type Kind = "atom" | "block-atom" | "atom-token"; const atomData = "Atoms";');
  const plan = planRename(root);
  assert.equal(plan.summary.movedFiles, 3);
  applyRename(plan);
  assert.equal(existsSync(join(root, "packages/designer/src/atoms")), false);
  assert.match(readFileSync(join(root, "packages/designer/src/components/index.ts"), "utf8"), /COMPONENT_GUIDANCE.*ComponentGuidance.*components.*selectedComponent/);
  assert.match(readFileSync(join(root, "packages/designer/examples/components/button.tsx"), "utf8"), /designer\/components\/server/);
  assert.match(readFileSync(join(root, "packages/designer/src/catalog/components.ts"), "utf8"), /COMPONENT_CATALOG/);
  const manifest = JSON.parse(readFileSync(join(root, "packages/designer/package.json")));
  assert.deepEqual(manifest.exports, { "./components": "./dist/components/index.js" });
  assert.equal(manifest.version, "0.12.0");
  assert.equal(readFileSync(join(root, "packages/publisher/src/core/relations.ts"), "utf8"), 'type Kind = "component" | "block-component" | "component-token"; const componentData = "Components";');
  assert.equal(planRename(root).summary.replacements, 0);
  assert.equal(planRename(root).summary.movedFiles, 0);
}));
test("protects semantic atoms, frozen records and upstream bytes, while renaming a neighboring live file", () => fixture((root, put) => {
  const frozen = ["governance/release-qualifications/clossys-designer-0.12.0.json", "governance/public-npm-aggregate-canary.json", "governance/known-dangling-citations.json", "docs/changelogs/designer.md", "docs/DECISIONS.md", "docs/design/r2-foundations.md", "packages/designer/src/catalog-core/__fixtures__/foundry-original-fills.json", "packages/designer/src/importers/__fixtures__/registry/button.json", "packages/designer/src/catalog-assets/__fixtures__/upstream.json", "some/vendor/source.json", "packages/designer/src/tokens/internal/cascade.ts", "packages/designer/src/catalog-core/css.ts", "packages/starter/src/pnpm.ts", "packages/publisher/src/web/contact/createContactHandler.ts", "packages/writer/src/voice/internal/pattern-safety.ts"];
  for (const path of frozen) put(path, 'ATOM_GUIDANCE Atom atoms @clossys/designer/atoms\r\n');
  put("packages/designer/src/catalog/live.json", '{"kind":"atoms"}');
  applyRename(planRename(root));
  for (const path of frozen) assert.equal(readFileSync(join(root, path), "utf8"), 'ATOM_GUIDANCE Atom atoms @clossys/designer/atoms\r\n', path);
  assert.equal(readFileSync(join(root, "packages/designer/src/catalog/live.json"), "utf8"), '{"kind":"components"}');
}));
test("preserves anatomy/atomic families and retired citations", () => {
  assert.equal(renameText("/^ATOM_/"), "/^COMPONENT_/");
  assert.equal(renameText("FROZEN_ATOM_IDS ATOM ATOMS"), "FROZEN_COMPONENT_IDS COMPONENT COMPONENTS");
  const foreign = renameText('const FOREIGN_PRIMITIVE_RE = /(?:atoms|tokens|theme)/;');
  assert.match(foreign, /atoms\|components\|tokens\|theme/);
  assert.equal(renameText(foreign), foreign);
  assert.equal(renameText("anatomy AnatomyCallouts atomic atomically writeFileAtomically applyPlanAtomically"), "anatomy AnatomyCallouts atomic atomically writeFileAtomically applyPlanAtomically");
  assert.equal(renameText("// packages/ui/src/atoms/Icon.tsx\n// live atoms"), "// packages/ui/src/atoms/Icon.tsx\n// live components");
});
test("dry-run is nonmutating, check fails before migration and passes on an idempotent second pass", () => fixture((root, put) => {
  put("README.md", "Atoms compose blocks.");
  const dry = JSON.parse(execFileSync(process.execPath, [script, "--root", root, "--dry-run", "--json"], { encoding: "utf8" }));
  assert.equal(dry.summary.replacements, 1);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "Atoms compose blocks.");
  assert.equal(spawnSync(process.execPath, [script, "--root", root, "--check"]).status, 1);
  execFileSync(process.execPath, [script, "--root", root, "--write"]);
  assert.equal(spawnSync(process.execPath, [script, "--root", root, "--check"]).status, 0);
  const second = JSON.parse(execFileSync(process.execPath, [script, "--root", root, "--write", "--json"], { encoding: "utf8" }));
  assert.equal(second.summary.replacements, 0);
}));
test("refuses collisions before any edit", () => fixture((root, put) => {
  put("packages/designer/src/atoms/index.ts", "Atoms");
  put("packages/designer/src/components/index.ts", "Existing");
  put("README.md", "Atoms");
  assert.throws(() => planRename(root), /Rename conflict/);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "Atoms");
}));
test("leaves generated content to its generator and reports stale generated names", () => fixture((root, put) => {
  put("packages/designer/skill/atoms-guide.md", "# Atoms\n");
  const plan = planRename(root);
  assert.equal(plan.summary.generatedFiles, 1);
  applyRename(plan);
  assert.equal(readFileSync(join(root, "packages/designer/skill/components-guide.md"), "utf8"), "# Atoms\n");
  assert.equal(spawnSync(process.execPath, [script, "--root", root, "--check"]).status, 1);
}));
