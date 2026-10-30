import type { CompositeResolved } from '@clossys/designer/catalog';
import { agentModule } from './cells.js';

/** A provider and its selected implementation namespaces share one compiled graph. */
export async function studioComponentProviderSource(profile: CompositeResolved, files: ReadonlyMap<string, string>): Promise<string> {
  const [identity, emitter] = await Promise.all([agentModule('designer', 'catalog-core/resolve-components.js'), agentModule('designer', 'catalog-core/emit-components.js')]);
  const selectedModules = [...new Set(Object.values(profile.components.components).flatMap(component => [component.impl.kind === 'package' ? component.impl.module : component.impl.entry, ...Object.entries(component.propMap).map(([member, pointer]) => emitter.componentMemberBinding(component, member, pointer).module)]))].sort();
  const descriptors = Object.fromEntries(Object.entries(profile.components.components).map(([leaf, component]) => [leaf, identity.componentDescriptorHash(component.descriptor)]));
  return [
    'import { createElement } from "react";',
    'import { ConsumerComponentProvider } from "@clossys/designer/frames";',
    ...selectedModules.map((module, index) => `import * as Selected${index} from ${JSON.stringify(files.has(module) ? './' + module : module)};`),
    `const modules = { ${selectedModules.map((module, index) => `${JSON.stringify(module)}: Selected${index}`).join(', ')} };`,
    `const descriptors = ${JSON.stringify(descriptors)};`,
    `const selectionHash = ${JSON.stringify(profile.components.selectionHash)};`,
    'export function ComponentProvider({ profile, children }) { return createElement(ConsumerComponentProvider, { value: { profile, modules, descriptors, selectionHash }, children }); }',
    '',
  ].join('\n');
}
