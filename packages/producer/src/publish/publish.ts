/** Canonical consumer roots for specimen records. */
import { join, resolve } from "node:path";
import { hasSlotModel } from "../records/slots.js";

/** Explicit consumers, else the workspace's own canonical clossys/ model. */
export function specimenRoots(root: string, given?: readonly string[]): string[] {
  if (given?.length) return given.map(dir => resolve(root, dir));
  const own = join(root, "clossys");
  return hasSlotModel(own) ? [own] : [];
}

