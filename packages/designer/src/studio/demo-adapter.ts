import type { StudioAdapter } from "./types.js";
import { DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";

/**
 * A read-only adapter over the throwaway demo library, so a host can show the Studio before a real library exists. It
 * cannot save. It is replaced by an adapter over the shipped catalog once that lands; do not build on its data.
 */
export const demoStudioAdapter: StudioAdapter = {
  canSave: false,
  load: async () => ({ library: DEMO_LIBRARY, selection: DEMO_SELECTION }),
  save: async () => ({ ok: false, reason: "unavailable" }),
};
