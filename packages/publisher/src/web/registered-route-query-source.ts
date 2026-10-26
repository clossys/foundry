import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { consumerDogfoodSources } from "@clossys/designer/catalog/server";
import { runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeRendererDescriptor } from "@clossys/designer/catalog";

/** Read the actual fixed public query and state-only provider runtime graphs.
 * No consumer source map or caller-provided expected hash selects these files. */
export async function registeredDesignerQuerySources(): Promise<{ implementation: RuntimeRendererDescriptor; provider: RuntimeRendererDescriptor }> {
  const entry = fileURLToPath(import.meta.resolve("@clossys/designer/studio/queries"));
  const root = resolve(dirname(entry), "..");
  async function descriptor(file: string, id: string): Promise<RuntimeRendererDescriptor> {
    const source = await consumerDogfoodSources([file], { version: 1, sources: {}, pages: [file] }, root, root);
    const closure = { entry: relative(root, file).split("\\").join("/"), files: Object.fromEntries(source.files.map(row => [row.file, row.content])), dependencies: {} };
    return { id, source: closure, sourceHash: runtimeHash(closure) };
  }
  return { implementation: await descriptor(entry, "designer.layer-boards@1"), provider: await descriptor(resolve(dirname(entry), "WholeStudioProvider.js"), "WholeStudioProvider") };
}
