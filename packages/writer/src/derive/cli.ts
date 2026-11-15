#!/usr/bin/env node
/** `node dist/derive/cli.js [--check]`: writes (or checks) src/catalog/ia/copy.json from the Designer catalog. */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { deriveCopyTree, loadDesignerCopyInput } from "./copy.js";

export const COPY_TREE_FILE = new URL("../../src/catalog/ia/copy.json", import.meta.url);

export interface DeriveCopyIo { args: readonly string[]; stdout: (text: string) => void; stderr: (text: string) => void }

export function runDeriveCopy(io: DeriveCopyIo): number {
  const unknown = io.args.filter(arg => arg !== "--check");
  if (unknown.length) { io.stderr(`writer derive: unknown argument ${unknown[0]}\n`); return 2; }
  const next = `${JSON.stringify(deriveCopyTree(loadDesignerCopyInput()), null, 2)}\n`;
  let current = "";
  try { current = readFileSync(COPY_TREE_FILE, "utf8"); } catch { current = ""; }
  if (io.args.includes("--check")) {
    if (current !== next) { io.stderr("writer derive: src/catalog/ia/copy.json is stale; run node dist/derive/cli.js\n"); return 1; }
    io.stdout("writer derive: copy.json is current\n");
    return 0;
  }
  if (current !== next) writeFileSync(COPY_TREE_FILE, next);
  io.stdout(`writer derive: ${current === next ? "unchanged" : "wrote"} src/catalog/ia/copy.json\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runDeriveCopy({ args: process.argv.slice(2), stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) });
}
