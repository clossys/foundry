import type { CompositeResolved } from '@clossys/designer/catalog';
import { agentModule } from './cells.js';

/** A provider and its selected implementation namespaces share one compiled graph. */
export async function studioComponentProviderSource(profile: CompositeResolved, files: ReadonlyMap<string, string>, request?: (leaf: string, module: string) => string): Promise<string> {
  const [identity, emitter] = await Promise.all([agentModule('designer', 'catalog-core/resolve-components.js'), agentModule('designer', 'catalog-core/emit-components.js')]);
  const imports: string[] = [];
  const modules = new Map<string, Map<string, string>>();
  for (const [leaf, component] of Object.entries(profile.components.components).sort(([a], [b]) => a.localeCompare(b))) {
    const module = component.impl.kind === 'package' ? component.impl.module : component.impl.entry;
    const bindings = [{ module, name: component.impl.export }, ...Object.entries(component.propMap).map(([member, pointer]) => emitter.componentMemberBinding(component, member, pointer)), ...(component.descriptor.secondaryExports ?? []).map(row => ({ module, name: row.export }))];
    for (const binding of bindings) {
      const exports = modules.get(binding.module) ?? new Map<string, string>();
      if (exports.has(binding.name)) continue;
      const local = `Selected${imports.length}`;
      const specifier = request?.(leaf, binding.module) ?? (files.has(binding.module) ? './' + binding.module : binding.module);
      imports.push(`import { ${binding.name} as ${local} } from ${JSON.stringify(specifier)};`);
      exports.set(binding.name, local); modules.set(binding.module, exports);
    }
  }
  const descriptors = Object.fromEntries(Object.entries(profile.components.components).map(([leaf, component]) => [leaf, identity.componentDescriptorHash(component.descriptor)]));
  return [
    'import { createElement } from "react";',
    'import { ConsumerComponentProvider } from "@clossys/designer/frames";',
    ...imports,
    `const modules = { ${[...modules].map(([module, exports]) => `${JSON.stringify(module)}: { ${[...exports].map(([name, local]) => `${JSON.stringify(name)}: ${local}`).join(', ')} }`).join(', ')} };`,
    `const descriptors = ${JSON.stringify(descriptors)};`,
    `const selectionHash = ${JSON.stringify(profile.components.selectionHash)};`,
    'export function ComponentProvider({ profile, children }) { return createElement(ConsumerComponentProvider, { value: { profile, modules, descriptors, selectionHash }, children }); }',
    '',
  ].join('\n');
}
