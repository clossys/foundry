/**
 * The fixed-clock consent preview, for development review only. The export
 * map resolves this entry only under the `development` condition and refuses
 * `react-server`; the factory also refuses a production environment at run
 * time.
 */
export { createConsentPreview } from "./adapter.js";
export type { ConsentPreview, ConsentPreviewOptions, ConsentPreviewSettleResult, ConsentPreviewState } from "./adapter.js";
