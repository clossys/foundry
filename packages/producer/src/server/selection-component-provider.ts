import type { CompositeResolved } from '@clossys/designer/catalog';
import { agentModule } from './cells.js';

/** A provider and its selected implementation namespaces share one compiled graph. */
export async function studioComponentProviderSource(profile: CompositeResolved, files: ReadonlyMap<string, string>, request?: (leaf: string, module: string) => string): Promise<string> {
  const [identity, emitter, sourceIdentity] = await Promise.all([agentModule('designer', 'catalog-core/resolve-components.js'), agentModule('designer', 'catalog-core/emit-components.js'), agentModule('designer', 'studio/selected-component-source.js')]);
  const imports: string[] = [];
  const modules = new Map<string, Map<string, string>>();
  const sourceBindings = new Map<string, Map<string, string>>();
  for (const [leaf, component] of Object.entries(profile.components.components).sort(([a], [b]) => a.localeCompare(b))) {
    const module = component.impl.kind === 'package' ? component.impl.module : component.impl.entry;
    const bindings = [{ module, name: component.impl.export }, ...Object.entries(component.propMap).map(([member, pointer]) => emitter.componentMemberBinding(component, member, pointer)), ...(component.descriptor.secondaryExports ?? []).map(row => ({ module, name: row.export }))];
    for (const binding of bindings) {
      const exports = modules.get(binding.module) ?? new Map<string, string>();
      if (exports.has(binding.name)) {
        if (component.impl.kind === 'source') (sourceBindings.get(leaf) ?? sourceBindings.set(leaf, new Map()).get(leaf)!).set(binding.name, exports.get(binding.name)!);
        continue;
      }
      const local = `Selected${imports.length}`;
      const specifier = request?.(leaf, binding.module) ?? (files.has(binding.module) ? './' + binding.module : binding.module);
      imports.push(`import { ${binding.name} as ${local} } from ${JSON.stringify(specifier)};`);
      exports.set(binding.name, local); modules.set(binding.module, exports);
      if (component.impl.kind === 'source') (sourceBindings.get(leaf) ?? sourceBindings.set(leaf, new Map()).get(leaf)!).set(binding.name, local);
    }
  }
  const descriptors = Object.fromEntries(Object.entries(profile.components.components).map(([leaf, component]) => [leaf, identity.componentDescriptorHash(component.descriptor)]));
  const sources = Object.fromEntries(Object.keys(profile.components.components).flatMap(leaf => {
    const selected = sourceIdentity.selectedComponentSourceIdentity(profile.components, leaf);
    return selected ? [[leaf, selected]] : [];
  }));
  const provider = files.has('component-index.ts');
  return [
    'import { createElement } from "react";',
    'import { ConsumerComponentProvider } from "@clossys/designer/frames";',
    ...(provider ? ['import { LibraryProvider } from "./component-index.ts";'] : []),
    ...imports,
    `const modules = { ${[...modules].map(([module, exports]) => `${JSON.stringify(module)}: { ${[...exports].map(([name, local]) => `${JSON.stringify(name)}: ${local}`).join(', ')} }`).join(', ')} };`,
    'export const componentModules = modules;',
    `export const componentSourceIdentities = ${JSON.stringify(sources)};`,
    `export function matchesComponentSource(leaf, namespace) { return ${[...sourceBindings].map(([leaf, bindings]) => `(leaf === ${JSON.stringify(leaf)} && ${[...bindings].map(([name, local]) => `namespace[${JSON.stringify(name)}] === ${local}`).join(' && ')})`).join(' || ') || 'false'}; }`,
    `const descriptors = ${JSON.stringify(descriptors)};`,
    `const selectionHash = ${JSON.stringify(profile.components.selectionHash)};`,
    `export function ComponentProvider({ profile, children }) { return createElement(ConsumerComponentProvider, { value: { profile, modules, descriptors, selectionHash }, children: ${provider ? 'createElement(LibraryProvider, null, children)' : 'children'} }); }`,
    '',
  ].join('\n');
}
