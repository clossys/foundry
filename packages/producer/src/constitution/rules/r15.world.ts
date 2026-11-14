/**
 * The R15/R16 test world: a fixture workspace with the W2-I test standard and recipe
 * (`../__fixtures__/{standards,recipes}/`) copied into `packages/writer/`. Test support only.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContext } from "../context.js";
import { NO_FOUNDRY_LEAVES, NO_HISTORY, slotDoc, writeWorkspace, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import type { ConstitutionContext } from "../types.js";

const FIXTURES = fileURLToPath(new URL("../__fixtures__/", import.meta.url));
export const STANDARD_ID = "fixture-headline";
export const RECIPE_ID = "fixture-headline-craft";

export type Edit = (root: string, consumer: string) => void;
export const put = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`); };

/** One live Writer slot judged by the fixture standard, with one candidate (the R15 clean world). */
export function standardSpec(extra: Partial<WorkspaceSpec["writer"]> = {}): WorkspaceSpec {
  return {
    writer: {
      "home.hero": { slot: { ...slotDoc("writer", "home.hero"), standard: STANDARD_ID }, candidates: { "hero-v1.md": "---\nsource:\n  kind: authored\n---\nShip the page you meant to write.\n" } },
      ...extra,
    } as NonNullable<WorkspaceSpec["writer"]>,
  };
}

/** The workspace with the fixture standard and recipe copied into packages/writer/, then `edit` applied. */
export function standardWorld(spec: WorkspaceSpec = standardSpec(), edit?: Edit): { ctx: ConstitutionContext; root: string; consumer: string } {
  const { root, consumer } = writeWorkspace(spec);
  cpSync(join(FIXTURES, "standards", STANDARD_ID), join(root, "packages", "writer", "standards", STANDARD_ID), { recursive: true });
  cpSync(join(FIXTURES, "recipes", RECIPE_ID), join(root, "packages", "writer", "recipes", RECIPE_ID), { recursive: true });
  edit?.(root, consumer);
  return { ctx: buildContext(root, consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES }), root, consumer };
}
export const standardDir = (root: string) => join(root, "packages", "writer", "standards", STANDARD_ID);
export const recipeDir = (root: string) => join(root, "packages", "writer", "recipes", RECIPE_ID);
