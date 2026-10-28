import * as fs from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { stableStringify } from "../catalog-core/stable.js";
import type { ThumbnailIndex } from "../studio/system-canvas/thumbnails/thumbnail-index.js";
import { checkLibraryReceipt, LibraryInputError } from "./fs-library.js";
import { digest, readReceipt } from "./write-receipt.js";

interface CaptureDriver { shoot(input: { html: string; width: number; height: number }): Promise<Uint8Array>; render(leaf: string): ReactNode | undefined }
export function thumbnailPath(output: string, leaf: string): string {
  const match = /^(components|sections|frames)\.[a-z0-9-]+$/.exec(leaf);
  if (match?.[0] !== leaf) throw new LibraryInputError("Invalid capture leaf");
  return join(output, `${leaf}.webp`);
}
async function canonicalOutput(path: string): Promise<string> {
  try { return await fs.realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await canonicalOutput(dirname(path)), basename(path));
  }
}
async function atomic(path: string, bytes: string | Uint8Array): Promise<void> {
  const temporary = path + "." + randomUUID() + ".tmp";
  try { await fs.writeFile(temporary, bytes, { flag: "wx" }); await fs.rename(temporary, path); }
  finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
/** Derived images live outside the library: capture never changes its manifest or receipt. */
export async function capture(input: { root: string; driver: string; out: string; leaf?: string }) {
  const root = await fs.realpath(resolve(input.root)), output = await canonicalOutput(resolve(input.out));
  const path = relative(root, output);
  if (path === "" || path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path)) throw new LibraryInputError("capture --out must be outside --root");
  const verdict = await checkLibraryReceipt(root), receipt = await readReceipt(root);
  if (!verdict.ok || !receipt || typeof receipt === "string") throw new LibraryInputError("capture requires a valid designer receipt");
  const driver = await import(/* @vite-ignore */ pathToFileURL(resolve(input.driver)).href) as Partial<CaptureDriver>;
  if (typeof driver.render !== "function" || typeof driver.shoot !== "function") throw new LibraryInputError("capture driver must export render and shoot");
  const leaves: string[] = [];
  for (const name of (await fs.readdir(join(root, "fills"))).sort()) {
    if (!/^(components|sections|frames)\.[a-z0-9-]+\.json$/.test(name)) continue;
    const doc = JSON.parse(await fs.readFile(join(root, "fills", name), "utf8")), leaf = doc?.$extensions?.["com.clossys.fill"]?.slot;
    if (typeof leaf !== "string" || name !== leaf + ".json") throw new LibraryInputError("Invalid capture fill filename");
    thumbnailPath(output, leaf); leaves.push(leaf);
  }
  if (input.leaf !== undefined && !leaves.includes(input.leaf)) throw new LibraryInputError("Capture leaf unavailable");
  const styles: string[] = [];
  for (const name of ["theme.css", "brand.css", "scales.css", "fonts.css"]) {
    try { styles.push((await fs.readFile(join(root, name), "utf8")).replace(/<\/style/gi, "<\\/style")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  await fs.mkdir(output, { recursive: true });
  const index: ThumbnailIndex = { version: 1, libraryHash: receipt.writes.at(-1)!.contentHash, leaves: {} }, failures: { leaf: string; reason: string }[] = [];
  for (const leaf of leaves.filter(leaf => input.leaf === undefined || leaf === input.leaf)) {
    try {
      const specimen = driver.render(leaf);
      if (specimen === undefined) throw new Error("No specimen");
      const width = leaf.startsWith("components.") ? 640 : 1280, height = leaf.startsWith("components.") ? 400 : 800;
      const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + styles.join("\n") + "</style></head><body>" + renderToStaticMarkup(specimen) + "</body></html>";
      const bytes = await driver.shoot({ html, width, height });
      if (!(bytes instanceof Uint8Array) || bytes.length < 12 || Buffer.from(bytes.subarray(0, 4)).toString() !== "RIFF" || Buffer.from(bytes.subarray(8, 12)).toString() !== "WEBP") throw new Error("Driver output is not WebP");
      await atomic(thumbnailPath(output, leaf), bytes);
      index.leaves[leaf] = { fill: receipt.files[`fills/${leaf}.json`]!, sha256: digest(bytes), width, height };
    } catch (error) { failures.push({ leaf, reason: error instanceof Error ? error.message : String(error) }); }
  }
  await atomic(join(output, "index.json"), stableStringify(index));
  return { ok: failures.length === 0, captured: Object.keys(index.leaves), failures };
}
