import type { SurfaceDocument } from "@clossys/publisher/core";

const acmeCapabilities: SurfaceDocument["bindings"][number] = {
  slot: "capabilities",
  items: [
    { copy: { id: "acme.capability.one" } },
    { copy: { id: "acme.capability.two" } },
    { assetId: "acme.capability.icon.three" },
  ],
};

export { acmeCapabilities };
