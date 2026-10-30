#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Follow the native source module graph, including JSON imports, on every invocation.
// No generated usage report or previous dist/ build supplies this gate's inventory.
const source = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const prefix = pathToFileURL(source).href + "/";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".js") && context.parentURL?.startsWith(prefix)) {
      const target = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(target)) return { url: target.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(prefix) && url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true };
    return next(url, context);
  },
});
try {
  const { runDefaultCandidatesCli } = await import(pathToFileURL(resolve(source, "library-cli/default-candidates-cli.ts")).href);
  process.exitCode = runDefaultCandidatesCli(process.argv.slice(2));
} catch (error) {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, sourceHead: null, status: "invalid-input", missing: [], invalid: [error instanceof Error ? error.message : String(error)] }, null, 2) + "\n");
  process.exitCode = 2;
}
