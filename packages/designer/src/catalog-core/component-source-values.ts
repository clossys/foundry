/** Finite source-value grammar; receipts and import closure are independent checks. */
import { CatalogError } from "./api.js";

interface Token { text: string; quoted?: true }
const refuse = (): never => { throw new CatalogError("components: unsupported secondary export source or inventory"); };
const isName = (token: Token | undefined): token is Token => !!token && !token.quoted && /^[A-Za-z_$][\w$]*$/.test(token.text);
interface Binding { module: string; imported: string; erased: boolean }

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
  return { functions, exports, types };
}
