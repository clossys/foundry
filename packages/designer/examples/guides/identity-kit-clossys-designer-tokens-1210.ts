import {
  generateIdentityDirections,
  identityKitReport,
  judgeIdentityKit,
  type IdentityTokenInput,
} from "@clossys/designer/tokens";

const tokens: IdentityTokenInput = {
  ink: "oklch(0.2178 0 0)",
  onInverse: "oklch(0.9702 0 0)",
  surfaceBase: "oklch(0.9702 0 0)",
  surfaceInverse: "oklch(0.2178 0 0)",
  accent: "oklch(0.4748 0 0)",
  onAccent: "oklch(0.9702 0 0)",
  fontFamily: "system-ui, sans-serif",
};

const [wordmark, circle, square] = generateIdentityDirections({ name: "Acme Rockets" }, tokens);
const judgement = judgeIdentityKit(wordmark, tokens); // { ok, verdict, findings, checks: { contrast, "minimum-size", "clear-space", "single-colour-legibility" } }
export { judgement, identityKitReport };
export { wordmark, circle, square, tokens };
