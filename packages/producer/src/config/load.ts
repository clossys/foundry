import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { transform } from "esbuild";
import { ConfigError, validateConfig, type ProducerConfig } from "../config.js";

interface Token { readonly value: string; readonly kind: "word" | "string" | "number" | "punctuation" }
function reject(): never { throw new ConfigError("Config must export a literal object or defineConfig(literal); executable expressions and extra imports are unsupported"); }

/** A bounded data grammar consumes esbuild's type-erased module, never its code. */
function literalConfig(source: string): unknown {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const tail = source.slice(at);
    const ignored = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/.exec(tail);
    if (ignored) { at += ignored[0].length; continue; }
    const match = /^("(?:[^"\\]|\\.)*"|[a-zA-Z_$][\w$]*|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\]():,;=])/.exec(tail);
    if (!match) reject();
    const text = match[0];
    tokens.push({ value: text.startsWith('"') ? JSON.parse(text) : text, kind: text.startsWith('"') ? "string" : /^[a-zA-Z_$]/.test(text) ? "word" : /^-?\d/.test(text) ? "number" : "punctuation" });
    at += text.length;
  }
  let index = 0;
  const peek = () => tokens[index];
  const take = (): Token => { const value = tokens[index++]; if (!value) return reject(); return value; };
  const expect = (value: string) => { if (take().value !== value) reject(); };
  const optional = (value: string) => { if (peek()?.value === value) { index++; return true; } return false; };
  const word = () => { const token = take(); if (token.kind !== "word") reject(); return token.value; };
  let helper: string | undefined;
  if (peek()?.value === "import") {
    expect("import"); expect("{"); expect("defineConfig"); helper = optional("as") ? word() : "defineConfig";
    expect("}"); expect("from"); const module = take();
    if (module.kind !== "string" || module.value !== "@clossys/producer/config") reject(); expect(";");
  }
  const value = (): unknown => {
    const token = take();
    if (token.kind === "string") return token.value;
    if (token.kind === "number") { const number = Number(token.value); if (!Number.isFinite(number)) reject(); return number; }
    if (token.value === "true" || token.value === "false") return token.value === "true";
    if (token.value === "null") return null;
    if (token.value === "[") {
      const result: unknown[] = [];
      while (!optional("]")) { result.push(value()); if (optional("]")) break; expect(","); }
      return result;
    }
    if (token.value === "{") {
      const result: Record<string, unknown> = Object.create(null);
      while (!optional("}")) {
        const key = take(); if (!["word", "string"].includes(key.kind) || ["__proto__", "constructor", "prototype"].includes(key.value) || Object.hasOwn(result, key.value)) reject();
        expect(":"); result[key.value] = value(); if (optional("}")) break; expect(",");
      }
      return result;
    }
    return reject();
  };
  const declaration = word(); if (declaration !== "var" && declaration !== "const") reject();
  const binding = word(); expect("=");
  const wrapped = helper !== undefined && peek()?.value === helper;
  if (wrapped) { expect(helper!); expect("("); }
  const result = value(); if (wrapped) expect(")"); expect(";");
  expect("export"); expect("{"); expect(binding); expect("as"); expect("default"); expect("}"); expect(";");
  if (index !== tokens.length) reject();
  return result;
}

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return !isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}

/** Read-only config loading. Relative target paths always resolve from the repository root. */
export async function loadConfig(root: string): Promise<ProducerConfig> {
  try {
    const base = await realpath(root), configPath = await realpath(join(base, "clossys/clossys.config.ts"));
    if (!inside(base, configPath)) throw new ConfigError("Config file must remain inside the repository");
    const transformed = await transform(await readFile(configPath, "utf8"), { loader: "ts", format: "esm", sourcefile: "clossys.config.ts", legalComments: "none" });
    const config = literalConfig(transformed.code); validateConfig(config);
    for (const [id, target] of Object.entries(config.targets)) {
      const app = await realpath(join(base, target.app));
      if (!inside(base, app) || !(await stat(app)).isDirectory()) throw new ConfigError(`Target ${id} app must be a directory inside the repository`);
    }
    return config;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`Invalid config: ${error instanceof Error ? error.message : String(error)}`);
  }
}
