import { componentDescriptorHash, verifyComponentOutput, type ResolvedComponents } from '../catalog-core/resolve-components.js';
import { sha256 } from '../catalog-core/digest.js';
import { stableStringify } from '../catalog-core/stable.js';

/** Current consumer source identity, independent of the approved default execution registry. */
export function selectedComponentSourceIdentity(profile: ResolvedComponents, leaf: string) {
  const selected = profile.components[leaf];
  if (selected?.impl.kind !== 'source') return undefined;
  verifyComponentOutput(selected.descriptor, profile.files);
  const files = selected.descriptor.outputSha256!.map(receipt => {
    const file = profile.files.find(file => file.path === receipt.path)!;
    return { path: file.path, sha256: sha256(file.content) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const identity = { version: 1, leaf, selectionHash: profile.selectionHash, descriptorHash: componentDescriptorHash(selected.descriptor), entry: selected.impl.entry, export: selected.impl.export, files };
  return { ...identity, sourceHash: sha256(stableStringify(identity)) };
}
export type SelectedComponentSourceIdentity = NonNullable<ReturnType<typeof selectedComponentSourceIdentity>>;
