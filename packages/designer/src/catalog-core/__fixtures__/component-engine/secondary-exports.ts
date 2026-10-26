/** SYNTHETIC secondary API mechanism; never real component/runtime evidence. */
import { syntheticSource } from "./synthetic.js";
import { materializeSourceFill, applyComponentLibraryChange } from "../../changeset-components.js";
import { componentLibraryHash, resolveComponents } from "../../resolve-components.js";
import { componentSourceHash } from "../../check-components.js";
import { sha256 } from "../../digest.js";
import type { ComponentCandidate } from "../../resolve-components.js";

export const secondaryNames = ["ButtonContent", "ButtonGroup", "ButtonItem", "ButtonTrigger", "ButtonValue"];
export const secondaryInventory = () => secondaryNames.map(name => ({ name, export: name }));
export const secondarySourceText = [
  'import { Button } from "react-aria-components";',
  ...[...secondaryNames, "ButtonPrivate", "ButtonTypeOnly"].map(name => `function ${name}<T extends object>(props: T) { return null; }`),
  `export { Button, ${secondaryNames.join(", ")}, ButtonPrivate };`,
  "export type { ButtonTypeOnly };",
  "",
].join("\n");
type InventoryCandidate = ComponentCandidate & { secondaryExports?: readonly { name: string; export: string }[] };
export function secondaryFixture(inventory: unknown = secondaryInventory(), source = secondarySourceText) {
  const input = syntheticSource();
  const candidate = input.candidate as InventoryCandidate;
  if (inventory !== undefined) candidate.secondaryExports = inventory as InventoryCandidate["secondaryExports"];
  input.file.content = source;
  candidate.outputSha256 = [input.file, input.notice].map(file => ({ path: file.path, sha256: sha256(file.content) }));
  const observed = input.check.observations[candidate.slot]!;
  observed.files = [input.file, input.notice];
  observed.sourceHash = componentSourceHash(observed.files);
  observed.outputSha256 = candidate.outputSha256;
  return { ...input, candidate };
}
export async function secondaryProfile(input = secondaryFixture()) {
  const bundle = await materializeSourceFill(input.candidate, async () => input.upstream.content, [{ id: "synthetic@1", run: () => ({ files: [input.file, input.notice], blockers: [] }) }]);
  const library = applyComponentLibraryChange(input.catalog, input.library, { baseHash: componentLibraryHash(input.library), changes: [{ op: "adopt", slot: input.candidate.slot, source: input.candidate.source }] }, [bundle]);
  const resolve = () => resolveComponents({ catalog: input.catalog, library, values: input.check, evidence: input.check, packageExports: { "react-aria-components": ["Button"] } });
  return { ...input, bundle, library, resolve, profile: resolve() };
}
