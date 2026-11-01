/** Finite surface-only lexical grammar. This is not a TypeScript semantic parser. */
import type { SurfaceCandidate, SurfaceFile, SurfaceFinding, SurfacePackageEvidence } from "./surface-types.js";
import type { ComponentFile, ResolvedComponents } from "./resolve-components.js";
interface Token {
    text: string;
    literal?: boolean;
    jsx?: true;
    start?: number;
    end?: number;
}
export interface ParsedSurfaceModule {
    functions: readonly string[];
    values: readonly string[];
    /** Export identities differ from local function names for a default declaration. */
    functionExports: readonly { export: string; local: string }[];
    types: readonly string[];
    imports: readonly {
        module: string;
        /** Namespace imports expand to exact static members; never a wildcard. */
        name: string;
        local: string;
        kind: "value" | "type";
    }[];
    client: boolean;
}
const refuse = (): never => { throw new Error("unsupported or malformed surface source"); };
// Default import/function locals are strict-mode bindings, not export identities.
const reservedDefaultBindings = new Set("arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(" "));
/** Strings/comments/JSX text never manufacture declarations, edges or exports. */
export function parseSurfaceModule(source: string, richer = true): ParsedSurfaceModule {
    let i = 0;
    const tokens: Token[] = [];
    const quoted = (quote: string): string => { let text = ""; while (i < source.length) {
        const c = source[i++]!;
        if (c === quote)
            return text;
        if (c === "\n" || c === "\r")
            return refuse();
        if (c === "\\") {
            const next = source[i++];
            if (next === undefined)
                return refuse();
            text += "\\" + next;
        }
        else
            text += c;
    } return refuse(); };
    const template = (): void => { if (!richer)
        return refuse(); while (i < source.length) {
        const c = source[i++]!;
        if (c === "`")
            return;
        if (c === "\\") {
            i++;
            continue;
        }
        if (c === "$" && source[i] === "{") {
            i++;
            tokens.push({ text: "(" });
            scan("}");
            tokens.push({ text: ")" });
        }
    } refuse(); };
    const jsx = (): void => {
        const tag = source[i] === ">" ? "" : /^[A-Za-z][A-Za-z0-9-]*/.exec(source.slice(i))?.[0];
        if (tag === undefined)
            return refuse();
        i += tag.length;
        if (source[i] === "." || source[i] === ":")
            return refuse();
        let closed = false;
        while (i < source.length) {
            const c = source[i++]!;
            if (c === '"' || c === "'") {
                quoted(c);
                continue;
            }
            if (c === "{") {
                tokens.push({ text: "(" });
                scan("}");
                tokens.push({ text: ")" });
                continue;
            }
            if (c === "/" && source[i] === ">") {
                i++;
                return;
            }
            if (c === ">") {
                closed = true;
                break;
            }
            if (!/[\w$\s=:-]/.test(c))
                return refuse();
        }
        if (!closed)
            return refuse();
        while (i < source.length) {
            const c = source[i++]!;
            if (c === "{") {
                tokens.push({ text: "(" });
                scan("}");
                tokens.push({ text: ")" });
            }
            else if (c === "<") {
                if (source[i] !== "/") {
                    jsx();
                    continue;
                }
                i++;
                if (source.slice(i, i + tag.length) !== tag)
                    return refuse();
                i += tag.length;
                if (source[i++] !== ">")
                    return refuse();
                return;
            }
            else if (c === "}")
                return refuse();
        }
        refuse();
    };
    const scan = (end?: string): void => {
        let prior: Token | undefined;
        while (i < source.length) {
            const start = i;
            const c = source[i++]!;
            if (/\s/.test(c))
                continue;
            if (c === "/" && source[i] === "/") {
                i++;
                while (i < source.length && source[i] !== "\n")
                    i++;
                continue;
            }
            if (c === "/" && source[i] === "*") {
                const stop = source.indexOf("*/", i + 1);
                if (stop < 0)
                    return refuse();
                i = stop + 2;
                continue;
            }
            if (c === end)
                return;
            if (c === '"' || c === "'") {
                prior = { text: quoted(c), literal: true, start, end: i };
                tokens.push(prior);
                continue;
            }
            if (c === "`") {
                tokens.push({ text: "(" });
                template();
                tokens.push({ text: ")" });
                prior = { text: "literal", literal: true };
                continue;
            }
            if (c === "<" && /^[A-Za-z>]/.test(source.slice(i)) && (!prior || ["return", "=", "(", "?", ":", ",", ">", "=>", "&&", "||"].includes(prior.text))) {
                tokens.push({ text: "(", jsx: true, start, end: i });
                jsx();
                tokens.push({ text: ")", start: i, end: i });
                prior = { text: ")" };
                continue;
            }
            if (c === "/" && (!richer || !prior || !prior.literal && (!/^(?:[\w$]+|\)|\])$/.test(prior.text) || ["return", "throw", "case", "yield", "await", "typeof", "void", "delete", "new", "in", "instanceof"].includes(prior.text))))
                return refuse();
            if (/[A-Za-z_$]/.test(c)) {
                const tail = /^[A-Za-z0-9_$]*/.exec(source.slice(i))![0];
                i += tail.length;
                prior = { text: c + tail, start, end: i };
                tokens.push(prior);
                continue;
            }
            if (end && ["}", "]", ")"].includes(c))
                return refuse();
            if (["{", "[", "("].includes(c)) {
                const close = ({ "{": "}", "[": "]", "(": ")" } as Record<string, string>)[c]!;
                tokens.push({ text: c, start, end: i });
                scan(close);
                prior = { text: close, start: i - 1, end: i };
                tokens.push(prior);
                continue;
            }
            if (["}", "]", ")"].includes(c))
                return refuse();
            if (c === "=" && source[i] === ">") {
                prior = { text: "=>", start: i - 1, end: i + 1 };
                i++;
            }
            else if ((c === "&" || c === "|") && source[i] === c) {
                i++;
                prior = { text: c + c, start, end: i };
            }
            else
                prior = { text: c, start, end: i };
            tokens.push(prior);
        }
        if (end)
            refuse();
    };
    scan();
    let at = 0;
    const functions = new Set<string>(), exports = new Map<string, string>(), types = new Set<string>(), typeExports = new Set<string>(), locals = new Set<string>();
    const imports: ParsedSurfaceModule["imports"][number][] = [];
    const helperValues = new Set<string>(), refValues = new Set<string>(), arrows = new Set<string>();
    const namespaces = new Map<string, { module: string; kind: "value" | "type"; start: number; end: number }>();
    const erased = new Set<number>();
    const peek = () => tokens[at];
    const is = (text: string) => !!peek() && !peek()!.literal && peek()!.text === text;
    const take = (text: string) => { const token = tokens[at++]; if (!token || token.literal || token.text !== text)
        return refuse(); };
    const id = () => { const token = tokens[at++]; if (!token || token.literal || !/^[A-Za-z_$][\w$]*$/.test(token.text))
        return refuse(); return token.text; };
    const balanced = (open: string): void => { take(open); const close = ({ "(": ")", "[": "]", "{": "}", "<": ">" } as Record<string, string>)[open]!; while (peek() && !(!peek()!.literal && peek()!.text === close)) {
        const token = peek()!;
        if (!token.literal && (["(", "[", "{"].includes(token.text) || open === "<" && token.text === "<")) {
            balanced(token.text);
            continue;
        }
        at++;
    } take(close); };
    const newline = (left: Token | undefined, right: Token | undefined) => left?.end !== undefined && right?.start !== undefined && /[\r\n\u2028\u2029]/.test(source.slice(left.end, right.start));
    const finish = () => { if (is(";")) at++; else if (peek() && !newline(tokens[at - 1], peek())) refuse(); };
    const imported = (local: string, module: string, name: string) => imports.some(row => row.local === local && row.module === module && row.name === name && row.kind === "value");
    const markErased = (start: number, end: number) => { for (let k = start; k < end; k++) erased.add(k); };
    const staticValue = (): void => {
        if (peek()?.literal || ["null", "true", "false"].includes(peek()?.text ?? "")) { at++; return; }
        if (is("{") || is("[")) {
            const object = is("{");
            at++;
            const close = object ? "}" : "]";
            while (!is(close)) {
                if (object) {
                    if (peek()?.literal) at++;
                    else id();
                    take(":");
                }
                staticValue();
                if (!is(",")) break;
                at++;
            }
            take(close);
            return;
        }
        const start = peek()?.start;
        const number = start === undefined ? undefined : /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(start))?.[0];
        if (!number || start === undefined) return refuse();
        const end = start + number.length;
        while (peek()?.end !== undefined && peek()!.end! <= end) at++;
        if (tokens[at - 1]?.end !== end) return refuse();
    };
    const staticCva = (): void => {
        take("(");
        if (!peek()?.literal) return refuse();
        at++;
        if (is(",")) {
            at++;
            if (!is(")")) {
                if (!is("{")) return refuse();
                staticValue();
                if (is(",")) at++;
            }
        }
        take(")");
    };
    const inlineRef = (): void => {
        take("(");
        balanced("(");
        if (newline(tokens[at - 1], peek())) return refuse();
        take("=>");
        if (is("{")) balanced("{");
        else {
            const body = at;
            // Calls in an inline arrow body run when the callback runs, not at construction.
            while (peek() && !is(")")) {
                if (is(",")) return refuse();
                if (["(", "[", "{"].includes(peek()!.text)) balanced(peek()!.text);
                else at++;
            }
            if (at === body) return refuse();
        }
        take(")");
    };
    // Only finite atoms/arrays/objects, concrete arrows and the two evidenced helper factories.
    const initializer = (bindingName: string): "plain" | "function" | "ref" | "helper" => {
        const begin = at;
        let shape: "plain" | "function" | "ref" | "helper" = "plain";
        if (is("(")) {
            balanced("(");
            if (!is("=>") || newline(tokens[at - 1], peek())) return refuse();
            at++;
            shape = "function";
            if (is("{") || is("(")) {
                const open = peek()!.text;
                const body = at;
                balanced(open);
                if (open === "(" && (at === body + 2 || !tokens.slice(body + 1, at - 1).some(row => row.jsx))) return refuse();
            }
            else if (peek()?.literal || ["null", "true", "false"].includes(peek()?.text ?? "")) at++;
            else return refuse();
        }
        else if (is("[") || is("{")) staticValue();
        else if (peek()?.literal || /^(?:[0-9]|null$|true$|false$)/.test(peek()?.text ?? "")) {
            const numeric = !peek()?.literal && /^[0-9]$/.test(peek()?.text ?? "");
            at++;
            if (numeric) while (/^[0-9]$/.test(peek()?.text ?? "") && tokens[at - 1]?.end === peek()?.start) at++;
        }
        else {
            const local = id();
            if (is(".")) {
                at++;
                if (id() !== "forwardRef" || !(imported(local, "react", "default") || namespaces.get(local)?.module === "react" && namespaces.get(local)?.kind === "value")) return refuse();
                shape = "ref";
                if (is("<")) { const start = at; balanced("<"); markErased(start, at); }
            }
            else if (imported(local, "class-variance-authority", "cva")) shape = "helper";
            else return refuse();
            if (shape === "ref") inlineRef();
            else staticCva();
        }
        if (at === begin) return refuse();
        // A line terminator is not a boundary before a call, index, member or operator.
        if (peek() && !is(";") && (!newline(tokens[at - 1], peek()) || !["export", "import", "function", "const", "let", "type", "interface"].includes(peek()!.text) && !refValues.has(peek()!.text) && !(shape === "ref" && peek()!.text === bindingName))) return refuse();
        finish();
        return shape;
    };
    const add = (set: Set<string>, key: string) => { if (locals.has(key))
        return refuse(); locals.add(key); set.add(key); };
    for (let k = 0; k < tokens.length; k++) {
        const token = tokens[k]!;
        if (!token.literal && ["require", "eval"].includes(token.text) && tokens[k + 1]?.text === "(")
            refuse();
        if (!token.literal && token.text === "import" && tokens[k + 1]?.text === "(")
            refuse();
    }
    let client = false;
    while (peek()) {
        if (peek()!.literal) {
            if (peek()!.text === "use client")
                client = true;
            at++;
            if (peek()?.text === ";")
                at++;
            continue;
        }
        if (peek()!.text === ";") {
            at++;
            continue;
        }
        let exported = false;
        let defaultExport = false;
        if (peek()!.text === "export") {
            at++;
            exported = true;
            if (peek()?.text === "default" && !peek()?.literal) {
                at++;
                defaultExport = true;
            }
        }
        const token = peek();
        if (!token || token.literal || defaultExport && token.text !== "function")
            return refuse();
        if (token.text === "import" && !exported) {
            const importAt = at;
            at++;
            let allType = false;
            if (is("type")) {
                allType = true;
                at++;
            }
            const rows: {
                name: string;
                local: string;
                kind: "value" | "type";
            }[] = [];
            const binding = (name: string, local: string, kind: "value" | "type") => {
                if (locals.has(local))
                    return refuse();
                locals.add(local);
                rows.push({ name, local, kind });
            };
            if (is("*")) {
                if (!richer) return refuse();
                at++;
                take("as");
                const local = id();
                if (reservedDefaultBindings.has(local) || locals.has(local)) return refuse();
                locals.add(local);
                take("from");
                const module = tokens[at++];
                if (!module?.literal || module.text.includes("\\")) return refuse();
                namespaces.set(local, { module: module.text, kind: allType ? "type" : "value", start: importAt, end: at });
                finish();
                continue;
            }
            if (peek()?.text !== "{") {
                const local = id();
                if (reservedDefaultBindings.has(local))
                    return refuse();
                binding("default", local, allType ? "type" : "value");
                if (is(",")) {
                    at++;
                    if (allType || peek()?.text !== "{")
                        return refuse();
                }
                else if (!is("from"))
                    return refuse();
            }
            if (peek()?.text === "{") {
                take("{");
                while (peek()?.text !== "}") {
                    let kind: "value" | "type" = allType ? "type" : "value";
                    if (is("type")) {
                        kind = "type";
                        at++;
                    }
                    const name = id();
                    let local = name;
                    if (is("as")) {
                        at++;
                        local = id();
                    }
                    if (local === "default")
                        return refuse();
                    binding(name, local, kind);
                    if (!is(","))
                        break;
                    at++;
                }
                take("}");
            }
            take("from");
            const module = tokens[at++];
            if (!module?.literal || module.text.includes("\\"))
                return refuse();
            rows.forEach(row => imports.push({ module: module.text, ...row }));
            if (peek()?.text === ";")
                at++;
            continue;
        }
        if (exported && (token.text === "{" || token.text === "type" && tokens[at + 1]?.text === "{")) {
            let typeOnly = false;
            if (token.text === "type") {
                at++;
                typeOnly = true;
            }
            take("{");
            while (peek()?.text !== "}") {
                let erased = typeOnly;
                if (peek()?.text === "type") {
                    erased = true;
                    at++;
                }
                const local = id();
                if ((erased ? typeExports : exports).has(local))
                    return refuse();
                if (erased)
                    typeExports.add(local);
                else
                    exports.set(local, local);
                if (peek()?.text !== ",")
                    break;
                at++;
            }
            take("}");
            if (peek()?.text === ";")
                at++;
            continue;
        }
        if (token.text === "function") {
            at++;
            const local = id();
            if (local === "default" || defaultExport && reservedDefaultBindings.has(local))
                return refuse();
            add(functions, local);
            if (peek()?.text === "<")
                balanced("<");
            balanced("(");
            if (peek()?.text === ":") {
                if (!richer)
                    return refuse();
                at++;
                if (peek()?.text === "{")
                    balanced("{");
                else
                    while (peek() && peek()!.text !== "{") {
                        if (["(", "["].includes(peek()!.text))
                            balanced(peek()!.text);
                        else
                            at++;
                    }
            }
            balanced("{");
            if (exported) {
                const name = defaultExport ? "default" : local;
                if (exports.has(name))
                    return refuse();
                exports.set(name, local);
            }
            continue;
        }
        if (richer && ["type", "interface"].includes(token.text)) {
            const typeAt = at;
            at++;
            const local = id();
            add(types, local);
            if (peek()?.text === "<")
                balanced("<");
            if (token.text === "interface") {
                while (peek() && peek()!.text !== "{")
                    at++;
                balanced("{");
                if (peek()?.text === ";")
                    at++;
            }
            else {
                take("=");
                let count = 0;
                while (peek() && peek()!.text !== ";") {
                    if (!peek()!.literal && ["export", "import", "function", "const", "let", "var", "type", "interface", "class"].includes(peek()!.text)) return refuse();
                    if (["(", "[", "{"].includes(peek()!.text))
                        balanced(peek()!.text);
                    else
                        at++;
                    count++;
                }
                if (!count)
                    return refuse();
                take(";");
            }
            markErased(typeAt, at);
            if (exported)
                typeExports.add(local);
            continue;
        }
        if (richer && ["const", "let"].includes(token.text)) {
            at++;
            const local = id();
            if (locals.has(local) || reservedDefaultBindings.has(local)) return refuse();
            locals.add(local);
            take("=");
            const shape = initializer(local);
            if (shape === "function") arrows.add(local);
            else if (shape === "ref" || shape === "helper") helperValues.add(local);
            if (shape === "ref") refValues.add(local);
            if (exported) {
                if (shape === "plain" || token.text !== "const" || exports.has(local)) return refuse();
                exports.set(local, local);
            }
            continue;
        }
        if (richer && !exported && refValues.has(token.text)) {
            at++;
            take(".");
            take("displayName");
            take("=");
            if (!peek()?.literal) return refuse();
            at++;
            finish();
            continue;
        }
        return refuse();
    }
    const directNamespaceCall = (start: number): boolean => {
        if (tokens[start]?.text === "(") return true;
        if (tokens[start]?.text !== "<") return false;
        let depth = 0;
        for (let k = start; k < tokens.length; k++) {
            const token = tokens[k]!;
            if (token.literal || [";", "=", "=>"].includes(token.text)) return false;
            if (token.text === "<") depth++;
            if (token.text === ">" && --depth === 0) return tokens[k + 1]?.text === "(";
        }
        return false;
    };
    for (const [local, namespace] of namespaces) {
        const uses: ParsedSurfaceModule["imports"][number][] = [];
        for (let k = 0; k < tokens.length; k++) {
            const token = tokens[k]!;
            if (token.literal || token.text !== local || k >= namespace.start && k < namespace.end) continue;
            const member = tokens[k + 2], next = tokens[k + 3];
            const kind: "value" | "type" = erased.has(k) ? "type" : "value";
            // Type queries require value semantics beyond this finite member grammar.
            if (kind === "type" && tokens[k - 1]?.text === "typeof") return refuse();
            if (tokens[k - 1]?.text === "." || tokens[k + 1]?.text !== "." || member?.literal || !/^[A-Za-z_$][\w$]*$/.test(member?.text ?? "") || reservedDefaultBindings.has(member!.text) || next?.text === "." || next?.text === "[" || kind === "value" && (namespace.kind === "type" || !directNamespaceCall(k + 3))) return refuse();
            const row = { module: namespace.module, name: member!.text, local, kind };
            if (!uses.some(use => use.name === row.name && use.kind === row.kind)) uses.push(row);
            k += 2;
        }
        if (!uses.length) return refuse();
        imports.push(...uses);
    }
    for (const local of exports.values()) if (arrows.has(local)) functions.add(local);
    if ([...exports.values()].some(local => !functions.has(local) && !helperValues.has(local)) || [...typeExports].some(local => !types.has(local)))
        return refuse();
    return { functions: [...functions], values: [...exports.keys()], functionExports: [...exports].filter(([, local]) => functions.has(local)).map(([name, local]) => ({ export: name, local })), types: [...typeExports], imports, client };
}
export interface SurfaceSourceProof {
    values: readonly {
        file: string;
        name: string;
        export: string;
    }[];
    imports: readonly {
        file: string;
        module: string;
        name: string;
        local: string;
        kind: "value" | "type";
        target: string;
    }[];
    findings: readonly SurfaceFinding[];
}
export function relativeSurfacePath(file: string, module: string, paths: readonly string[]): string | undefined {
    if (!module.startsWith(".") || /[\\%?#:]/.test(module))
        return undefined;
    const stack = file.split("/").slice(0, -1);
    for (const part of module.split("/")) {
        if (part === ".")
            continue;
        if (part === "..") {
            if (!stack.length)
                return undefined;
            stack.pop();
        }
        else if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part))
            return undefined;
        else
            stack.push(part);
    }
    const exact = stack.join("/");
    const alternatives = [exact, ...(exact.endsWith(".js") ? [exact.slice(0, -3) + ".ts", exact.slice(0, -3) + ".tsx"] : !/\.[^/]+$/.test(exact) ? [exact + ".ts", exact + ".tsx"] : [])].filter(path => paths.includes(path));
    return alternatives.length === 1 ? alternatives[0] : undefined;
}
export function analyzeSurfaceSource(input: {
    fill: SurfaceCandidate;
    files: readonly SurfaceFile[];
    components: ResolvedComponents;
    componentFiles: readonly ComponentFile[];
    packages: readonly SurfacePackageEvidence[];
}): SurfaceSourceProof {
    const { fill } = input, findings: SurfaceFinding[] = [], values: SurfaceSourceProof["values"][number][] = [], imports: SurfaceSourceProof["imports"][number][] = [];
    const add = (code: SurfaceFinding["code"], message: string) => findings.push({ code, rule: "surfaces", severity: "error", subject: fill.slot, message });
    const paths = input.files.filter(file => /\.tsx?$/.test(file.path)).map(file => file.path), parsed = new Map<string, ParsedSurfaceModule>(), visited = new Set<string>();
    const read = (path: string): ParsedSurfaceModule | undefined => { if (parsed.has(path))
        return parsed.get(path); const file = input.files.find(file => file.path === path); if (!file) {
        add("S4", `missing source ${path}`);
        return;
    } try {
        const proof = parseSurfaceModule(file.content);
        parsed.set(path, proof);
        return proof;
    }
    catch {
        add("S3", `unsupported source ${path}`);
        return;
    } };
    const visit = (path: string): void => {
        if (visited.has(path))
            return;
        visited.add(path);
        const proof = read(path);
        if (!proof)
            return;
        if (fill.rendering === "server" && proof.client)
            add("S5", "server surface reaches client source");
        for (const edge of proof.imports) {
            let target = "";
            if (edge.module.startsWith(".")) {
                const owned = relativeSurfacePath(path, edge.module, paths);
                if (owned) {
                    target = owned;
                    const imported = read(owned);
                    if (imported && !(edge.kind === "value" ? imported.values : imported.types).includes(edge.name))
                        add("S4", `unknown ${edge.kind} export ${edge.name}`);
                    visit(owned);
                }
                else {
                    const componentPath = relativeSurfacePath(path, edge.module, input.componentFiles.map(file => file.path));
                    const binding = fill.bindings.filter(row => row.file === path && row.module === edge.module && row.name === edge.name && row.local === edge.local);
                    if (edge.kind !== "value" || binding.length !== 1 || componentPath !== `components/${binding[0]?.slot.slice(11)}/index.ts`)
                        add("S4", `unbound selected import ${edge.module}#${edge.name}`);
                    else {
                        target = componentPath!;
                        const component = input.components.components[binding[0]!.slot];
                        const leaf = input.componentFiles.find(file => file.path === target);
                        const allowed = component ? [{ name: binding[0]!.slot.slice(11).split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join(""), export: component.impl.export }, ...(component.descriptor.secondaryExports ?? [])] : [];
                        if (!leaf || !allowed.some(row => row.name === edge.name) || !new RegExp(`\\b${edge.name}\\b`).test(leaf.content))
                            add("S4", `selected public API unavailable ${edge.name}`);
                    }
                }
            }
            else {
                target = edge.module;
                const dependency = fill.dependencies.find(row => row.module === edge.module), evidence = input.packages.filter(row => row.module === edge.module);
                if (!dependency || evidence.length !== 1 || evidence[0]!.version !== dependency.version || !/^[a-f0-9]{64}$/.test(evidence[0]!.artifactSha256) || !(edge.kind === "value" ? evidence[0]!.values : evidence[0]!.types).includes(edge.name))
                    add("S4", `unproven dependency export ${edge.module}#${edge.name}`);
            }
            imports.push({ file: path, ...edge, target });
        }
    };
    visit(fill.impl.entry);
    const entry = read(fill.impl.entry);
    for (const api of fill.api.exports) {
        if (!entry?.functionExports.some(row => row.export === api.export && entry.functions.includes(row.local)) || !entry.values.includes(api.export))
            add("S4", `API is not a concrete same-entry function ${api.export}`);
        else
            values.push({ file: fill.impl.entry, name: api.name, export: api.export });
    }
    for (const path of paths)
        if (!visited.has(path))
            add("S4", `source outside entry closure ${path}`);
    for (const row of fill.bindings)
        if (!imports.some(edge => edge.file === row.file && edge.module === row.module && edge.name === row.name && edge.local === row.local && edge.kind === "value"))
            add("S4", "extra component binding");
    return { values, imports, findings };
}
