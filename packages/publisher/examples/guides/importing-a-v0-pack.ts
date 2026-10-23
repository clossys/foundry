import { importLegacyV0Pack } from "@clossys/publisher/pack";

const result = importLegacyV0Pack({
  items: {
    brief: { status: "approved", iteration: "v0", approvedAt: "2026-09-20" },
    brandKit: { status: "delegated", iteration: "v0" },
    voice: { status: "draft", iteration: "v0" },
    shareCard: { status: "draft", iteration: "v0" },
    email: { status: "draft", iteration: "v0" },
    website: { status: "draft", iteration: "v0" },
  },
});
if (!result.ok) throw new Error(result.issues.map((issue) => issue.path).join(", "));
console.log(result.manifest.items.length);
