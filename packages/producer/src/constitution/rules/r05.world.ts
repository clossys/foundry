/**
 * The R05 test world: one live Writer slot judged by the W2-I fixture standard
 * (`../__fixtures__/standards/fixture-headline`, copied into `packages/writer/`), with a strings
 * contract fixture and one pinned candidate that fits it, so every candidate is certified. Test
 * support only.
 */
import { cpSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writerText } from "../certify/certify.world.js";
import { buildContext } from "../context.js";
import { NO_FOUNDRY_LEAVES, NO_HISTORY, slotDoc, writeWorkspace, type SlotSpec, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import type { ConstitutionContext } from "../types.js";

const FIXTURES = fileURLToPath(new URL("../__fixtures__/", import.meta.url));
export const STANDARD_ID = "fixture-headline";
export type Edit = (root: string, consumer: string) => void;

/** The certified Writer slot `home.hero`; `extra` adds candidates, `slot` overrides the slot spec. */
export function heroSlot(extra: Record<string, string> = {}, slot: Partial<SlotSpec> = {}): SlotSpec {
  return {
    slot: { ...slotDoc("writer", "home.hero"), standard: STANDARD_ID },
    candidates: { "hero-v1.md": writerText("home.hero", { title: "Ship the page you meant to write." }), ...extra },
    ...slot,
  };
}

export const certifiedSpec = (hero: SlotSpec = heroSlot()): WorkspaceSpec => ({ writer: { "home.hero": hero } });

/** The workspace with the fixture standard in packages/writer/standards/, then `edit` applied. */
export function certifiedWorld(spec: WorkspaceSpec = certifiedSpec(), edit?: Edit): ConstitutionContext {
  const { root, consumer } = writeWorkspace(spec);
  cpSync(join(FIXTURES, "standards", STANDARD_ID), join(root, "packages", "writer", "standards", STANDARD_ID), { recursive: true });
  edit?.(root, consumer);
  return buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES });
}
