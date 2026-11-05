import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeHash, runtimeSnapshot } from "@clossys/designer/catalog";
import type { RuntimeRendererDescriptor } from "@clossys/designer/catalog";
import { registeredLayoutSourceMatches, registeredLayoutSourcePin } from "../core/layout-fill-source.js";
import type { FlowInstanceBinding } from "../core/instance-binding.js";

/** Node-only: read the actual shipped authored Layout source closure selected by
 * its existing pin record. Neither caller paths nor expected hashes are accepted. */
export async function registeredFlowLayoutSource(leaf: FlowInstanceBinding["layout"]["leaf"]): Promise<RuntimeRendererDescriptor> {
  const pin = registeredLayoutSourcePin(leaf);
  if (!pin) throw new TypeError("Registered authored flow Layout source unavailable");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
  const files = Object.fromEntries(await Promise.all(Object.keys(pin.files).map(async file => [file, await readFile(resolve(root, file), "utf8")])));
  const source = { entry: pin.entry, files, dependencies: {} };
  if (!registeredLayoutSourceMatches(leaf, source)) throw new TypeError("Shipped authored Layout source differs from its pins");
  return runtimeSnapshot({ id: pin.export, source, sourceHash: runtimeHash(source) });
}
