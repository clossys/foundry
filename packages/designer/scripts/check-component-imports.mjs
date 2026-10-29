#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { componentImportFindings } from "../dist/component-import-lint.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configuration = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root).options;
function walk(path) { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]); }
const files = ["runtime", "blocks"].flatMap(area => walk(join(root, "src", area))).filter(path => /\.[cm]?tsx?$/.test(path) && !/\.test\.|\.check\.|__fixtures__/.test(path));
const findings = files.flatMap(path => componentImportFindings(relative(root, path), readFileSync(path, "utf8"), specifier => ts.resolveModuleName(specifier, path, options, ts.sys).resolvedModule?.resolvedFileName));
for (const finding of findings) console.error(`${finding.path}:${finding.line}: direct component import ${finding.specifier}`);
console.log(`Component injection imports: ${files.length} files; ${findings.length} findings.`);
process.exitCode = findings.length ? 1 : 0;
