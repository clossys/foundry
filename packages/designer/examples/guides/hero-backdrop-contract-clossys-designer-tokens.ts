import {
  TOKENS,
  checkBackdropContract,
  checkBackdropElement,
  type BackdropContract,
  type TokenDefinition,
} from "@clossys/designer/tokens";

const backdrop: BackdropContract = {
  kind: "video",
  scrim: {
    token: "--color-overlay-scrim",
    textToken: "--color-neutral-50",
    worstCaseBackdrop: "#6b6b6b",
  },
  ariaHidden: true,
  pointerEvents: "none",
  reducedMotion: { fallbackFrame: "/hero/still.webp" },
  loading: { strategy: "idle", budgetBytes: 1_500_000 },
};

// Your copy of the dark theme's values, layered over the light registry:
// here, the dark scrim as the dark block of styles/tokens.css sets it. Keep
// it in step with the stylesheet you ship. --color-neutral-50 does not
// change with the theme, so it needs no dark entry; a theme-dependent token
// left at its light value here is reported as theme-unchecked.
const darkTokens: Record<string, TokenDefinition> = {
  ...TOKENS,
  "--color-overlay-scrim": {
    property: "--color-overlay-scrim",
    family: "overlay",
    value: "oklch(0 0 0 / 0.6)",
    brandable: false,
    themeDependent: true,
  },
};

const declared = checkBackdropContract(backdrop, { darkTokens });
if (!declared.ok) {
  for (const finding of declared.findings) console.error(finding.rule, finding.message);
  for (const gap of declared.unchecked) console.error(gap.rule, gap.reason);
}

const layer = document.getElementById("hero-backdrop");
if (layer !== null && !checkBackdropElement(layer).ok) {
  console.error("The rendered backdrop breaks the contract.");
}
