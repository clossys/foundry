/**
 * The R03 test world: a Designer slot whose candidate adopts a reference-manifest item verbatim
 * (rung L1, byte-exact seed file), a Designer slot whose candidate is created under the slot's
 * adopt-first standard after a `create` verdict, and a Writer slot whose second candidate adopts the
 * first. The Designer provenance rule and reference manifest are written where R03 reads them.
 * Test support only.
 */
import { cpSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { elementItem, LABEL, writerText } from "../certify/certify.world.js";
import { sha256 } from "../certify/source.js";
import { buildContext } from "../context.js";
import { NO_FOUNDRY_LEAVES, NO_HISTORY, slotDoc, writeWorkspace, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import type { ConstitutionContext } from "../types.js";
import { PROVENANCE_RULE_PATH, REFERENCE_MANIFEST_PATH } from "./r03.js";
import { put } from "./r15.world.js";

const FIXTURES = fileURLToPath(new URL("../__fixtures__/", import.meta.url));
export const ADOPT_FIRST = "component";
export const SEED_PATH = "registry/ui/button.tsx";
export const SEED_REF = "shadcn/button@1.0.0";
export const SEED_HASH = "sha256:seed";
export type Edit = (root: string, consumer: string) => void;

export const MANIFEST = {
  registries: { shadcn: { url: "https://ui.shadcn.com" } },
  items: [{ registry: "shadcn", name: "button", version: "1.0.0", hash: SEED_HASH, type: "registry:ui", files: [{ path: SEED_PATH, sha256: sha256(LABEL) }] }],
};
export const RULE = { consumerAssets: { slots: ["assets.*"] }, classes: [{ slots: "ui.*", sourceTypes: ["registry:ui"] }] };

/** The adopted Designer candidate: verbatim lineage and a byte-exact mapped seed file. */
export const adoptedItem = (code = LABEL, source: Record<string, unknown> = { kind: "registry", ref: [SEED_REF], hash: SEED_HASH }) =>
  elementItem("ui/ui.button.tsx", code, { meta: { source, refVerbatim: { files: { "ui/ui.button.tsx": SEED_PATH } } } });
export const createdItem = (code = LABEL) => elementItem("ui/ui.dial.tsx", code, { meta: { source: { kind: "original", ref: [] } } });
export const createVerdict = (gapClass = "missing-behavior") => ({ op: "verdict", create: true, reason: "no seed has a dial", gaps: [{ id: "dial", class: gapClass }] });
export const submit = (name: string, rung: string, extra: Record<string, unknown> = {}) => ({ op: "submit", name, rung, ...extra });
const COPY = writerText("home.hero", { title: "Welcome." });

export function r03Spec(): WorkspaceSpec {
  return {
    designer: {
      "ui.button": {
        slot: { ...slotDoc("designer", "ui.button"), standard: ADOPT_FIRST },
        candidates: { "button-v1.json": adoptedItem() },
        ledger: { events: [submit("button-v1.json", "L1", { seed: SEED_REF })] },
      },
      "assets.dial": {
        slot: { ...slotDoc("designer", "assets.dial"), standard: ADOPT_FIRST },
        candidates: { "dial-v1.json": createdItem() },
        ledger: { events: [createVerdict(), submit("dial-v1.json", "L4", { reason: "no seed has a dial" })] },
      },
    },
    writer: {
      "home.hero": {
        candidates: { "hero-v1.md": COPY, "hero-v2.md": COPY },
        ledger: { events: [createVerdict(), submit("hero-v1.md", "create", { reason: "first copy" }), submit("hero-v2.md", "adopt", { seed: "home.hero/hero-v1.md" })] },
      },
    },
  };
}

/** The workspace with the provenance rule, the manifest and the adopt-first standard, then `edit` applied. */
export function r03World(spec: WorkspaceSpec = r03Spec(), edit?: Edit): ConstitutionContext {
  const { root, consumer } = writeWorkspace(spec);
  put(join(root, PROVENANCE_RULE_PATH), RULE);
  put(join(root, REFERENCE_MANIFEST_PATH), MANIFEST);
  const standard = join(root, "packages", "designer", "standards", ADOPT_FIRST);
  cpSync(join(FIXTURES, "standards", "fixture-headline"), standard, { recursive: true });
  put(join(standard, "requirements.json"), { schema: "clossys.standard/1", id: ADOPT_FIRST, kinds: ["element"], mode: "adopt-first", craftTier: "mid", seeds: [], createGaps: ["missing-behavior", "a11y-failure", "foundry-signature"], requirements: [] });
  edit?.(root, consumer);
  return buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES });
}
