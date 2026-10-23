#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function checkExamples(packageRoot = fileURLToPath(new URL("../", import.meta.url))) {
  const root = resolve(packageRoot), examples = join(root, "examples"), configPath = join(root, "tsconfig.examples.json");
  if (!existsSync(examples)) {
    console.log("No examples directory; example typecheck skipped.");
    return 0;
  }
  if (!existsSync(configPath)) {
    console.error("Examples require tsconfig.examples.json.");
    return 2;
  }
  try {
    const ts = createRequire(join(root, "package.json"))("typescript");
    const host = { getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => "\n" };
    const report = diagnostics => console.error(ts.formatDiagnostics(diagnostics, host).trimEnd());
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) { report([config.error]); return 2; }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { noEmit: true }, configPath);
    if (parsed.errors.length) { report(parsed.errors); return 2; }
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences });
    const configuration = [...program.getConfigFileParsingDiagnostics(), ...program.getOptionsDiagnostics()];
    const selected = ts.getPreEmitDiagnostics(program).filter(diagnostic => {
      if (!diagnostic.file) return true;
      const path = relative(examples, resolve(diagnostic.file.fileName));
      return path !== "" && path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
    });
    const diagnostics = ts.sortAndDeduplicateDiagnostics([...configuration, ...selected]);
    if (diagnostics.length) report(diagnostics);
    return diagnostics.some(item => item.category === ts.DiagnosticCategory.Error) ? 1 : 0;
  } catch (error) {
    console.error(`Example typecheck failed: ${String(error.message).replace(/\s+/g, " ")}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = checkExamples();
