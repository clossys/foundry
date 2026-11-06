/** Finite source-value grammar; receipts and import closure are independent checks. */
import { CatalogError } from "./api.js";
import { componentSourceProof } from "./component-source-proofs.js";

interface Token { text: string; quoted?: true }
const refuse = (): never => { throw new CatalogError("components: unsupported secondary export source or inventory"); };
const isName = (token: Token | undefined): token is Token => !!token && !token.quoted && /^[A-Za-z_$][\w$]*$/.test(token.text);
interface Binding { module: string; imported: string; erased: boolean }

/**
 * A namespace cannot escape its inspected module surface. Only explicit erased
 * type grammar is exempt from runtime membership; capitalization proves nothing.
 * This is a lexical proof, not an evaluator or a replacement for the compiler.
 */
function componentNamespaceReads(source: string, namespaces: ReadonlyMap<string, { module: string; erased: boolean }>) {
  const reads: { module: string; member: string; erased: boolean; typeQuery: boolean }[] = [];
  if (!namespaces.size && !source.includes("*")) return reads;
  const tokens: Token[] = [];
  let cursor = 0;
  const scan = (brace = false): void => {
    while (cursor < source.length) {
      const rest = source.slice(cursor);
      const whitespace = /^\s+/.exec(rest);
      if (whitespace) { cursor += whitespace[0].length; continue; }
      if (rest.startsWith("//")) { const end = source.indexOf("\n", cursor + 2); cursor = end < 0 ? source.length : end + 1; continue; }
      if (rest.startsWith("/*")) { const end = source.indexOf("*/", cursor + 2); if (end < 0) return refuse(); cursor = end + 2; continue; }
      const character = source[cursor++]!;
      if (character === "\\" && namespaces.size) return refuse(); // Escaped namespace identifiers are outside the bounded grammar.
      if (character === "<" && /^[A-Za-z>]/.test(source[cursor] ?? "") && ["return", "(", "=", "?", ":", ",", ">", "&", "|", "{"].includes(tokens.at(-1)?.text ?? "")) { element(); continue; }
      if (character === '"' || character === "'") {
        const start = cursor;
        let closed = false;
        while (cursor < source.length) {
          const item = source[cursor++]!;
          if (item === character) { closed = true; break; }
          if (item === "\\") cursor++;
          else if (item === "\n" || item === "\r") return refuse();
        }
        if (!closed) return refuse();
        tokens.push({ text: source.slice(start, cursor - 1), quoted: true }); continue;
      }
      if (character === "`") {
        let closed = false;
        while (cursor < source.length) {
          const item = source[cursor++]!;
          if (item === "`") { closed = true; break; }
          if (item === "\\") cursor++;
          else if (item === "$" && source[cursor] === "{") { cursor++; tokens.push({ text: "{" }); scan(true); }
        }
        if (!closed) return refuse();
        continue;
      }
      if (/[A-Za-z_$0-9]/.test(character)) {
        const tail = /^[\w$]*/.exec(source.slice(cursor))![0]; cursor += tail.length;
        tokens.push({ text: character + tail }); continue;
      }
      tokens.push({ text: character });
      if (character === "{") scan(true);
      if (character === "}" && brace) return;
    }
    if (brace) refuse();
  };
  const element = (): void => {
    const tag = source[cursor] === ">" ? "" : /^[A-Za-z][\w$]*(?:\.[A-Za-z][\w$]*)?/.exec(source.slice(cursor))?.[0];
    if (tag === undefined) return refuse();
    cursor += tag.length;
    // Member tags read a runtime export. Intrinsic tags and attributes are text.
    if (tag.includes(".")) for (const item of tag.split(/(\.)/)) tokens.push({ text: item });
    while (cursor < source.length) {
      const character = source[cursor++]!;
      if (character === ">") break;
      if (character === "/" && source[cursor] === ">") { cursor++; return; }
      if (character === "{") { tokens.push({ text: "{" }); scan(true); }
      else if (character === '"' || character === "'") {
        const end = source.indexOf(character, cursor); if (end < 0) return refuse(); cursor = end + 1;
      } else if (!/[\s\w$=:.?-]/.test(character)) return refuse();
    }
    while (cursor < source.length) {
      const character = source[cursor++]!;
      if (character === "{") { tokens.push({ text: "{" }); scan(true); }
      if (character !== "<") continue;
      if (source[cursor] !== "/") { element(); continue; }
      cursor++;
      if (source.slice(cursor, cursor + tag.length) !== tag) return refuse();
      cursor += tag.length;
      if (source[cursor++] !== ">") return refuse();
      return;
    }
    refuse();
  };
  scan();
  const text = (index: number): string | undefined => tokens[index]?.quoted ? undefined : tokens[index]?.text;
  const declared = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    if (text(index) !== "import") continue;
    let binding = index + 1;
    const erased = text(binding) === "type"; if (erased) binding++;
    if (text(binding) !== "*") continue;
    const local = text(binding + 2), observed = namespaces.get(local ?? "");
    if (text(binding + 1) !== "as" || !local || text(binding + 3) !== "from" || !tokens[binding + 4]?.quoted || observed?.module !== tokens[binding + 4]!.text || observed.erased !== erased || declared.has(local)) throw new CatalogError("components: unsupported namespace import syntax");
    declared.add(local);
  }
  if (declared.size !== namespaces.size) throw new CatalogError("components: unsupported namespace import syntax");
  if (!namespaces.size) return reads;
  const erased = new Set<number>();
  const typeQueries = new Set<number>();
  // Return a complete finite type expression and the namespace roots it erases.
  // A type query is erased, but its named value must still exist on the module.
  const parseType = (start: number): { end: number; roots: number[]; queries: number[] } => {
    let index = start;
    const roots: number[] = [];
    const queries: number[] = [];
    const take = (value: string): void => { if (text(index++) !== value) refuse(); };
    const name = (): void => { if (!isName(tokens[index++])) refuse(); };
    const type = (): void => {
      if (text(index) === "|") index++;
      term();
      while (["|", "&"].includes(text(index) ?? "")) { index++; term(); }
    };
    const term = (): void => {
      if (text(index) === "{") {
        index++;
        while (text(index) !== "}") {
          if (tokens[index]?.quoted) index++; else name();
          if (text(index) === "?") index++;
          take(":"); type();
          if ([";", ","].includes(text(index) ?? "")) index++;
        }
        take("}");
      } else if (text(index) === "(") {
        index++;
        if (text(index) === ")" || isName(tokens[index]) && [":", "?"].includes(text(index + 1) ?? "")) {
          while (text(index) !== ")") {
            name(); if (text(index) === "?") index++;
            take(":"); type(); if (text(index) !== ",") break; index++;
          }
          take(")"); take("="); take(">"); type();
        } else { type(); take(")"); }
      } else {
        const runtime = text(index) === "typeof"; if (runtime) index++;
        const root = index;
        if (tokens[index]?.quoted || /^\d+$/.test(text(index) ?? "")) index++; else name();
        while (text(index) === ".") { index++; name(); }
        if (namespaces.has(text(root) ?? "") && text(root + 1) === ".") (runtime ? queries : roots).push(root);
        if (text(index) === "<") {
          index++; type(); while (text(index) === ",") { index++; type(); } take(">");
        }
      }
      while (text(index) === "[") { index++; take("]"); }
    };
    type(); return { end: index, roots, queries };
  };
  const typeAt = (start: number, ends: readonly string[]): number | undefined => {
    try {
      const parsed = parseType(start);
      if (!ends.includes(text(parsed.end) ?? "EOF")) return;
      for (const root of parsed.roots) erased.add(root);
      for (const root of parsed.queries) typeQueries.add(root);
      return parsed.end;
    } catch (error) { if (!(error instanceof CatalogError)) throw error; return; }
  };
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (["(", "[", "{"].includes(text(index) ?? "")) stack.push(index);
    else if ([")", "]", "}"].includes(text(index) ?? "")) {
      const open = stack.pop();
      if (open === undefined || ({ "(": ")", "[": "]", "{": "}" } as Record<string, string>)[text(open)!] !== text(index)) return refuse();
      pairs.set(open, index);
    }
  }
  if (stack.length) return refuse();
  for (let index = 0; index < tokens.length; index++) {
    const token = text(index);
    if (token === "type" && isName(tokens[index + 1]) && text(index + 2) === "=") typeAt(index + 3, [";", "EOF", "const", "function", "export", "type"]);
    if (token === "as" || token === "satisfies") typeAt(index + 1, [",", ";", ")", "]", "}", "EOF"]);
    if (["const", "let", "var"].includes(token ?? "") && isName(tokens[index + 1]) && text(index + 2) === ":") typeAt(index + 3, ["="]);
    if (token === "function" && isName(tokens[index + 1]) && text(index + 2) === "<") {
      let parameter = index + 3;
      while (isName(tokens[parameter])) {
        parameter++;
        if (text(parameter) === "extends") parameter = typeAt(parameter + 1, ["=", ",", ">"]) ?? parameter;
        if (text(parameter) === "=") parameter = typeAt(parameter + 1, [",", ">"]) ?? parameter;
        if (text(parameter) !== ",") break;
        parameter++;
      }
    }
    // Generic call arguments are types only when a complete list ends at `>(`.
    if (token === "<" && (isName(tokens[index - 1]) || text(index - 1) === ">")) {
      let end = index + 1;
      const roots: number[] = [];
      const queries: number[] = [];
      try {
        do { const parsed = parseType(end); end = parsed.end; roots.push(...parsed.roots); queries.push(...parsed.queries); if (text(end) !== ",") break; end++; } while (true);
        if (text(end) === ">" && text(end + 1) === "(") {
          for (const root of roots) erased.add(root);
          for (const root of queries) typeQueries.add(root);
        }
      } catch (error) { if (!(error instanceof CatalogError)) throw error; }
    }
    if (token !== "(") continue;
    const close = pairs.get(index)!;
    let before = index - 1;
    if (text(before) === ">") {
      let depth = 1;
      while (before >= 0 && depth) { before--; if (text(before) === ">") depth++; if (text(before) === "<") depth--; }
      before--;
    }
    const declaration = text(before - 1) === "function" && isName(tokens[before]);
    const arrow = text(close + 1) === "=" && text(close + 2) === ">";
    if (!declaration && !arrow) continue;
    // Parameter annotations start after one binding or a balanced binding pattern.
    let parameter = index + 1;
    while (parameter < close) {
      if (text(parameter) === "." && text(parameter + 1) === "." && text(parameter + 2) === ".") parameter += 3;
      let end = pairs.get(parameter);
      if (!["{", "["].includes(text(parameter) ?? "")) end = isName(tokens[parameter]) ? parameter : undefined;
      if (end === undefined) break;
      end++;
      if (text(end) === "?") end++;
      if (text(end) === ":") end = typeAt(end + 1, [",", ")", "="]) ?? end;
      // Skip the default expression without interpreting its namespace reads.
      while (end < close && text(end) !== ",") end = pairs.has(end) ? pairs.get(end)! + 1 : end + 1;
      parameter = end + 1;
    }
    if (declaration && text(close + 1) === ":") typeAt(close + 2, ["{"]);
  }
  for (let index = 0; index < tokens.length; index++) {
    const binding = namespaces.get(text(index) ?? "");
    if (!binding || erased.has(index)) continue;
    // The import declaration establishes the binding; it does not read its value.
    if (text(index - 1) === "as" && text(index - 2) === "*" && (text(index - 3) === "import" || text(index - 3) === "type" && text(index - 4) === "import") && text(index + 1) === "from" && tokens[index + 2]?.quoted) continue;
    if (text(index + 1) === "[") throw new CatalogError("components: unsupported computed namespace read");
    if (text(index + 1) !== "." || !isName(tokens[index + 2]) || ["[", "?"].includes(text(index + 3) ?? "")) throw new CatalogError("components: unsupported namespace escape or access");
    const member = text(index + 2)!;
    reads.push({ ...binding, member, typeQuery: typeQueries.has(index) });
  }
  return reads;
}

/**
 * The namespace reads of these exact bytes. Stock sources carry a TypeScript
 * AST proof keyed by path kind and sha256; the proof must agree with the
 * caller's namespace inventory. Any other bytes, including every mutation of a
 * stock source, have no proof and use the bounded lexical grammar.
 */
function provenNamespaceReads(source: string, namespaces: ReadonlyMap<string, { module: string; erased: boolean }>, path: string | undefined) {
  const proof = path === undefined ? undefined : componentSourceProof(path, source);
  if (!proof) return componentNamespaceReads(source, namespaces);
  const proven = Object.entries(proof.namespaces);
  if (proven.length !== namespaces.size || proven.some(([local, binding]) => {
    const observed = namespaces.get(local);
    return observed?.module !== binding.module || observed.erased !== binding.erased;
  })) throw new CatalogError("components: unsupported namespace import syntax");
  return proof.reads;
}

/** Runtime members and erased value queries both bind to actual module exports. */
export function assertComponentNamespaceClosure(source: string, namespaces: ReadonlyMap<string, { module: string; erased: boolean }>, packageExports: Readonly<Record<string, readonly string[]>>, path?: string): void {
  for (const read of provenNamespaceReads(source, namespaces, path)) {
    if (read.erased && !read.typeQuery || !packageExports[read.module]?.includes(read.member)) throw new CatalogError(`components: unavailable namespace member ${read.member} from ${read.module}`);
  }
}

/**
 * Admit concrete functions, erased aliases, static literals/arithmetic, static
 * CVA definitions and React context factories. Context/CVA constants never become
 * function exports. Callee identities come from imports, not identifier spelling.
 * This deliberately does not accept arbitrary top-level executable expressions.
 */
export function componentSourceValues(source: string) {
  let cursor = 0;
  const functions = new Set<string>(), exports = new Set<string>(), types = new Set<string>();
  const locals = new Set<string>(), values = new Set<string>(), cvas = new Set<string>(), contexts = new Set<string>(), consumedContexts = new Set<string>();
  const bindings = new Map<string, Binding>();
  const history: Token[] = [];
  const read = (): Token | undefined => {
    while (cursor < source.length) {
      const rest = source.slice(cursor), whitespace = /^\s+/.exec(rest);
      if (whitespace) { cursor += whitespace[0].length; continue; }
      if (rest.startsWith("//")) { const end = source.indexOf("\n", cursor + 2); cursor = end < 0 ? source.length : end + 1; continue; }
      if (rest.startsWith("/*")) { const end = source.indexOf("*/", cursor + 2); if (end < 0) return refuse(); cursor = end + 2; continue; }
      const character = source[cursor++]!;
      if (character === '"' || character === "'") {
        let text = "";
        while (cursor < source.length) {
          const item = source[cursor++]!;
          if (item === character) return { text, quoted: true };
          if (item === "\n" || item === "\r") return refuse();
          if (item === "\\") { if (cursor === source.length) return refuse(); text += item + source[cursor++]!; }
          else text += item;
        }
        return refuse();
      }
      if (/[A-Za-z_$]/.test(character)) {
        const tail = /^[\w$]*/.exec(source.slice(cursor))![0]; cursor += tail.length;
        return { text: character + tail };
      }
      if (/\d/.test(character)) {
        const tail = /^\d*/.exec(source.slice(cursor))![0]; cursor += tail.length;
        return { text: character + tail };
      }
      return { text: character };
    }
    return undefined;
  };
  const peek = (): Token | undefined => { const saved = cursor, token = read(); cursor = saved; return token; };
  const next = (): Token | undefined => { const token = read(); if (token) history.push(token); return token; };
  const at = (text: string): boolean => { const token = peek(); return !!token && !token.quoted && token.text === text; };
  const take = (text: string): void => { const token = next(); if (!token || token.quoted || token.text !== text) refuse(); };
  const name = (): string => { const token = next(); if (!isName(token)) return refuse(); return token.text; };
  const bind = (id: string): void => { if (locals.has(id)) refuse(); locals.add(id); };
  const quoted = (): string => { const token = next(); if (!token?.quoted) return refuse(); return token.text; };
  const optionalSemi = (): void => { if (at(";")) next(); };
  const origin = (id: string, module: string, imported: string): boolean => {
    const binding = bindings.get(id);
    return binding?.module === module && binding.imported === imported && !binding.erased;
  };

  const template = (): void => {
    while (cursor < source.length) {
      const character = source[cursor++]!;
      if (character === "`") return;
      if (character === "\\") { cursor++; continue; }
      if (character === "$" && source[cursor] === "{") { cursor++; group("{", true); }
    }
    refuse();
  };
  const group = (open: string, jsx: boolean): void => {
    const close = ({ "(": ")", "[": "]", "{": "}" } as Record<string, string>)[open]!;
    for (let token = next(); token; token = next()) {
      if (token.quoted) continue;
      if (token.text === close) return;
      if ([")", "]", "}"].includes(token.text) || token.text === "/") return refuse();
      if (["import", "require"].includes(token.text) && at("(")) return refuse();
      if (token.text === "`") { if (!jsx) return refuse(); template(); }
      else if (["(", "[", "{"].includes(token.text)) group(token.text, jsx);
      else if (jsx && token.text === "<" && /^[A-Za-z>]/.test(source[cursor] ?? "") && ["return", "(", "=", "?", ":", ",", ">", "&", "|"].includes(history.at(-2)?.text ?? "")) element();
    }
    refuse();
  };
  const element = (): void => {
    const tag = source[cursor] === ">" ? "" : /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)?/.exec(source.slice(cursor))?.[0];
    if (tag === undefined) return refuse();
    if (tag.includes(".")) { const [root, member] = tag.split("."); if (!contexts.has(root!) || member !== "Provider") return refuse(); }
    cursor += tag.length;
    for (let token = next(); token; token = next()) {
      if (token.quoted) continue;
      if (token.text === ">") break;
      if (token.text === "/") { take(">"); return; }
      if (token.text === "{") group("{", true);
      else if (!["=", "-", ":"].includes(token.text) && !isName(token)) return refuse();
    }
    while (cursor < source.length) {
      const character = source[cursor++]!;
      if (character === "}") return refuse();
      if (character === "{") group("{", true);
      if (character !== "<") continue;
      if (source[cursor] !== "/") { element(); continue; }
      cursor++;
      if (source.slice(cursor, cursor + tag.length) !== tag) return refuse();
      cursor += tag.length; take(">"); return;
    }
    refuse();
  };

  // Type expressions stop at their grammatical end, including semicolonless aliases.
  const type = (): void => {
    if (at("|")) next();
    typeTerm();
    while (at("|") || at("&")) { next(); typeTerm(); }
  };
  const typeTerm = (): void => {
    if (at("{")) {
      next();
      while (!at("}")) {
        if (peek()?.quoted) next(); else name();
        if (at("?")) next();
        take(":"); type();
        if (at(";") || at(",")) next();
      }
      take("}");
    } else if (at("(")) {
      // A balanced parameter type followed by =>, or a parenthesized type.
      next();
      const saved = cursor, token = next(), parameter = isName(token) && (at(":") || at("?"));
      cursor = saved; history.pop();
      if (parameter || at(")")) {
        while (!at(")")) { name(); if (at("?")) next(); take(":"); type(); if (!at(",")) break; next(); }
        take(")"); take("="); take(">"); type();
      } else { type(); take(")"); }
    } else {
      if (at("typeof")) { next(); name(); }
      else if (peek()?.quoted) next();
      else name();
      while (at(".")) { next(); name(); }
      if (at("<")) { next(); type(); while (at(",")) { next(); type(); } take(">"); }
    }
    while (at("[")) { next(); take("]"); }
  };
  const staticValue = (): void => {
    const token = peek();
    if (token?.quoted || token && /^(?:\d+|true|false|null)$/.test(token.text)) { next(); return; }
    if (at("{")) {
      next();
      while (!at("}")) {
        if (peek()?.quoted) next(); else name();
        take(":"); staticValue();
        if (!at(",")) break; next();
      }
      take("}"); return;
    }
    if (at("[")) {
      next(); while (!at("]")) { staticValue(); if (!at(",")) break; next(); } take("]"); return;
    }
    refuse();
  };
  const declaration = (): void => {
    const id = name(); bind(id); take("=");
    const initial = peek();
    if (isName(initial) && origin(initial.text, "class-variance-authority", "cva")) {
      next(); take("("); quoted(); take(","); if (!at("{")) return refuse(); staticValue();
      if (at(",")) next(); take(")"); cvas.add(id);
    } else if (isName(initial) && origin(initial.text, "react", "*")) {
      next(); take("."); take("createContext"); take("<"); type(); take(">"); take("("); take("null"); take(")"); contexts.add(id);
    } else if (isName(initial) && origin(initial.text, "react", "createContext")) {
      next(); take("<"); type(); take(">"); take("("); take("null"); take(")"); contexts.add(id);
    } else {
      if (!initial?.quoted && !initial?.text.match(/^(?:\d+|true|false|null)$/)) return refuse();
      staticValue();
      // Only integer arithmetic, with no identifier evaluation or coercion.
      if (!initial.quoted && /^\d+$/.test(initial.text)) while (["+", "-", "*"].some(at)) {
        next(); const operand = next(); if (operand?.quoted || !operand || !/^\d+$/.test(operand.text)) return refuse();
      }
    }
    values.add(id); optionalSemi();
  };
  const checkFunctionBindings = (tokens: readonly Token[]): void => {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!; if (token.quoted) continue;
      const binding = bindings.get(token.text);
      if (binding?.module === "class-variance-authority" && binding.imported === "cva") return refuse();
      if ((binding?.imported === "*" && token.text === "React") || (binding?.module === "react" && binding.imported === "*")) {
        if (tokens[i + 1]?.text !== "." || !isName(tokens[i + 2])) return refuse();
        const member = tokens[i + 2]!.text;
        if (/^[a-z]/.test(member)) {
          if (binding?.module !== "react" || binding.erased || !["useContext", "useState", "useCallback", "useEffect", "useMemo"].includes(member)) return refuse();
          if (!["(", "<"].includes(tokens[i + 3]?.text ?? "")) return refuse();
          if (member === "useContext") {
            if (tokens[i + 3]?.text !== "(" || !contexts.has(tokens[i + 4]?.text ?? "") || tokens[i + 5]?.text !== ")") return refuse();
            consumedContexts.add(tokens[i + 4]!.text);
          }
        }
      }
      if (binding?.module === "react" && binding.imported === "useContext") {
        if (binding.erased || tokens[i + 1]?.text !== "(" || !contexts.has(tokens[i + 2]?.text ?? "") || tokens[i + 3]?.text !== ")") return refuse();
        consumedContexts.add(tokens[i + 2]!.text);
      }
      if (contexts.has(token.text)) {
        const callee = tokens[i - 2]?.text;
        if (tokens[i - 1]?.text !== "(" || !(callee === "useContext" && tokens[i - 3]?.text === "." && origin(tokens[i - 4]?.text ?? "", "react", "*") || origin(callee ?? "", "react", "useContext"))) return refuse();
      }
      if (cvas.has(token.text) && tokens[i - 1]?.text !== "typeof" && tokens[i + 1]?.text !== "(") return refuse();
    }
  };
  const concreteFunction = (exported: boolean): void => {
    const id = name(); bind(id); const start = history.length;
    if (at("<")) {
      next();
      do {
        name(); if (at("extends")) { next(); type(); } if (at("=")) { next(); type(); }
        if (!at(",")) break; next();
      } while (!at(">"));
      take(">");
    }
    take("("); group("(", false);
    take("{"); group("{", true);
    checkFunctionBindings(history.slice(start));
    functions.add(id); if (exported) exports.add(id);
  };
  for (let token = next(); token; token = next()) {
    if (token.quoted || token.text === ";") continue;
    if (token.text === "import") {
      const erased = at("type"); if (erased) next();
      const imported: { local: string; imported: string; erased: boolean }[] = [];
      if (at("*")) { next(); take("as"); imported.push({ local: name(), imported: "*", erased }); }
      else {
        take("{");
        while (!at("}")) {
          const typeOnly = erased || at("type"); if (!erased && typeOnly) next();
          const original = name(); let local = original;
          if (at("as")) { next(); local = name(); }
          imported.push({ local, imported: original, erased: typeOnly });
          if (!at(",")) break; next();
        }
        take("}");
      }
      take("from"); const module = quoted();
      for (const item of imported) { bind(item.local); bindings.set(item.local, { module, imported: item.imported, erased: item.erased }); }
    } else if (token.text === "function") concreteFunction(false);
    else if (token.text === "const") declaration();
    else if (token.text === "type") { const id = name(); bind(id); types.add(id); take("="); type(); optionalSemi(); }
    else if (token.text === "export") {
      if (at("function")) { next(); concreteFunction(true); continue; }
      const typeOnly = at("type"); if (typeOnly) next();
      take("{");
      while (!at("}")) {
        const erased = typeOnly || at("type"); if (!typeOnly && erased) next();
        const id = name(); if (exports.has(id)) return refuse();
        if (!erased) exports.add(id);
        if (!at(",")) break; next();
      }
      take("}");
    } else return refuse();
  }
  for (const context of contexts) if (!consumedContexts.has(context)) return refuse();
  for (const id of exports) if (!functions.has(id) && !values.has(id) && !bindings.has(id)) return refuse();
  // The source grammar admits these React operations, not arbitrary namespace
  // evaluation. The independent import closure still proves actual module exports.
  const namespaces = new Map([...bindings].filter(([, binding]) => binding.imported === "*").map(([local, binding]) => [local, binding]));
  for (const read of componentNamespaceReads(source, namespaces)) {
    if (!read.typeQuery && (read.erased || read.module === "react" && !["createContext", "useContext", "useState", "useCallback", "useEffect", "useMemo"].includes(read.member))) return refuse();
  }
  return { functions, exports, types };
}
