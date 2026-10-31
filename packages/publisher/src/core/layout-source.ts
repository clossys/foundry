import { isTailwindBreakpoint } from "@clossys/designer/catalog";
import type { PageLayoutContract } from "../layouts/contract.js";
import type { BindingToken, LayoutRendererSource } from "./instance-binding.js";

/** Host adapter for an installed parser. It supplies syntax, never a verdict or a value evaluator. */
export interface LayoutCompilerPort {
  parseSourceFile(file: string, source: string): unknown;
  kind(node: unknown): string;
  children(node: unknown): readonly unknown[];
}

type Node = Record<string, unknown>;
type Value = { kind: "unknown" } | { kind: "number" } | { kind: "literal"; value: string | number | boolean | undefined | null }
  | { kind: "object"; properties: Map<string, Value>; open: boolean } | { kind: "array"; values: Value[] }
  | { kind: "union"; values: Value[] } | { kind: "function"; node: Node; file: Module };
interface Binding { node: Node; file: Module; value?: Node; path: string[]; parameter?: boolean; mutated?: boolean; numericUpdates?: boolean; rebound?: boolean }
interface Module { name: string; source: string; root: Node; nodes: Node[]; parent: Map<Node, Node>; bindings: Map<Node, Map<string, Binding>>; imports: Map<string, { file: string; name: string }>; data: Map<string, Value> }
const UNKNOWN: Value = { kind: "unknown" }, NUMBER: Value = { kind: "number" };
const literal = (value: string | number | boolean | undefined | null): Value => ({ kind: "literal", value });
const union = (values: Value[]): Value => values.length === 1 ? values[0]! : { kind: "union", values };
const values = (value: Value): Value[] => value.kind === "union" ? value.values.flatMap(values) : [value];
const record = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);
const node = (value: unknown): Node | undefined => record(value) ? value : undefined;
const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.filter(record) : [];
const name = (value: unknown): string | undefined => node(value)?.escapedText as string | undefined ?? node(value)?.text as string | undefined;
const STYLE_KEY = /^(?:display|position|inset(?:Inline|Block)?(?:Start|End)?|top|right|bottom|left|(?:min|max)?(?:Width|Height|InlineSize|BlockSize)|width|height|inlineSize|blockSize|flex(?:Basis|Grow|Shrink|Direction|Wrap)?|grid(?:TemplateColumns|TemplateRows|Column(?:Start|End)?|Row(?:Start|End)?|AutoRows|AutoColumns)?|(?:row|column)?[Gg]ap|gap|padding(?:Inline|Block|Top|Bottom|Left|Right|Start|End)?|margin(?:Inline|Block|Top|Bottom|Left|Right|Start|End)?|scrollMargin(?:Top|Bottom|Inline|Block)?|overflow(?:X|Y)?|alignSelf|justifySelf|aspectRatio|visibility|pointerEvents)$/;
const KEYWORD = /^(?:0|auto|none|normal|block|inline-block|flex|grid|contents|hidden|visible|relative|absolute|fixed|sticky|static|start|end|center|stretch|contain|clip|scroll|row|column|wrap|nowrap|100%|100vh|100dvh)$/;
const FORBIDDEN = new Set(["eval", "Function", "require", "createElement", "jsx", "jsxs", "innerHTML", "setAttribute", "matchMedia", "insertRule", "adoptedStyleSheets", "CSSStyleSheet", "document", "window", "globalThis", "global", "Reflect", "Proxy"]);
const COLLECTION = new Set(["map", "flatMap", "reduce", "some", "every", "find", "filter", "includes", "entries", "keys", "values", "push", "pop", "reverse", "has", "add", "get", "set", "test", "split", "startsWith", "slice", "join", "replace", "indexOf"]);
const CHILD_FIELDS = ("statements endOfFileToken declarationList declarations name initializer expression type arguments argumentExpression typeArguments equalsGreaterThanToken questionDotToken asteriskToken parameters body properties elements propertyName condition whenTrue whenFalse left right operatorToken operand thenStatement elseStatement tagName attributes children openingElement closingElement openingFragment closingFragment importClause moduleSpecifier namedBindings exportClause modifiers typeParameters members heritageClauses types objectType indexType elementType questionToken dotDotDotToken exclamationToken assertClause qualifier templateSpans head literal template typeName constraint default readonlyToken nameType statement incrementor variableDeclaration tryBlock catchClause finallyBlock caseBlock clauses").split(" ");
function jsonValue(value: unknown): Value {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return literal(value as string | number | boolean | null);
  if (Array.isArray(value)) return { kind: "array", values: value.map(jsonValue) };
  if (record(value)) return { kind: "object", properties: new Map(Object.entries(value).map(([key, value]) => [key, jsonValue(value)])), open: false };
  return UNKNOWN;
}
const KINDS = new Set(("SourceFile EndOfFileToken ImportDeclaration ImportClause NamedImports ImportSpecifier NamespaceImport AssertClause AssertEntry ImportAttributes ImportAttribute ExportDeclaration ExportClause NamedExports ExportSpecifier VariableStatement VariableDeclarationList VariableDeclaration Identifier StringLiteral NumericLiteral TrueKeyword FalseKeyword NullKeyword UndefinedKeyword ObjectLiteralExpression PropertyAssignment ShorthandPropertyAssignment SpreadAssignment ArrayLiteralExpression SpreadElement FunctionDeclaration ArrowFunction FunctionExpression Parameter Block ReturnStatement IfStatement ThrowStatement NewExpression CallExpression PropertyAccessExpression ElementAccessExpression BinaryExpression PrefixUnaryExpression PostfixUnaryExpression ConditionalExpression ParenthesizedExpression AsExpression TypeAssertionExpression NonNullExpression SatisfiesExpression AwaitExpression ExpressionStatement ForStatement ForOfStatement WhileStatement BreakStatement ContinueStatement EmptyStatement SwitchStatement CaseBlock CaseClause DefaultClause TryStatement CatchClause JsxElement JsxOpeningElement JsxClosingElement JsxSelfClosingElement JsxAttributes JsxAttribute JsxSpreadAttribute JsxExpression JsxText JsxFragment JsxOpeningFragment JsxClosingFragment ObjectBindingPattern ArrayBindingPattern BindingElement TemplateExpression TemplateSpan TemplateHead TemplateMiddle TemplateTail NoSubstitutionTemplateLiteral RegularExpressionLiteral InterfaceDeclaration TypeAliasDeclaration TypeReference TypeLiteral PropertySignature MethodSignature FunctionType UnionType IntersectionType ArrayType TupleType NamedTupleMember OptionalType RestType LiteralType IndexedAccessType TypeOperator TypeQuery TypeParameter MappedType ConditionalType InferType ParenthesizedType NumberKeyword StringKeyword BooleanKeyword UnknownKeyword NeverKeyword AnyKeyword VoidKeyword ObjectKeyword ThisType ImportType TypePredicate QualifiedName HeritageClause ExpressionWithTypeArguments ReadonlyKeyword ExportKeyword DeclareKeyword ConstKeyword DotDotDotToken QuestionToken ExclamationToken EqualsToken PlusToken MinusToken AsteriskToken SlashToken PercentToken AsteriskAsteriskToken PlusPlusToken MinusMinusToken LessThanToken LessThanEqualsToken GreaterThanToken GreaterThanEqualsToken EqualsEqualsEqualsToken ExclamationEqualsEqualsToken EqualsEqualsToken ExclamationEqualsToken BarBarToken AmpersandAmpersandToken QuestionQuestionToken PlusEqualsToken MinusEqualsToken AsteriskEqualsToken SlashEqualsToken BarToken AmpersandToken ExclamationToken TildeToken InKeyword InstanceOfKeyword KeyOfKeyword TypeOfExpression VoidExpression TemplateLiteralType TemplateLiteralTypeSpan OmittedExpression ColonToken QuestionDotToken EqualsGreaterThanToken").split(/\s+/));

function readToken(value: string, contract: PageLayoutContract, tokens: readonly BindingToken[]): boolean {
  const token = tokens.find(entry => entry.property === value || entry.id === value);
  return !!token && contract.allowedReads.some(read => token.id.startsWith(`${read}.`));
}
function styleValue(value: Value, contract: PageLayoutContract, tokens: readonly BindingToken[]): boolean {
  return values(value).every(item => {
    if (item.kind === "number") return true;
    if (item.kind !== "literal") return false;
    if (item.value === undefined || typeof item.value === "number" && Number.isFinite(item.value)) return true;
    if (typeof item.value !== "string") return false;
    if (KEYWORD.test(item.value)) return true;
    const variable = /^var\((--[a-z0-9-]+)\)$/.exec(item.value);
    if (variable) return readToken(variable[1]!, contract, tokens);
    if (!item.value.startsWith("calc(") || !item.value.endsWith(")")) return false;
    let valid = true;
    const remaining = item.value.slice(5, -1).replace(/var\((--[a-z0-9-]+)\)/g, (_, token: string) => { valid &&= readToken(token, contract, tokens); return "0"; });
    return valid && /^[\d\s.+*/()-]+$/.test(remaining);
  });
}
function classToken(value: string, contract: PageLayoutContract, tokens: readonly BindingToken[]): boolean {
  const parts = value.split(":"), utility = parts.pop()!;
  if (parts.some(part => !isTailwindBreakpoint(part) && !/^(?:hover|focus|focus-visible|motion-safe|motion-reduce|forced-colors|aria-[a-z-]+|data-[a-z-]+)$/.test(part))) return false;
  if (/^(?:block|inline-block|inline-flex|flex|grid|contents|hidden|sr-only|not-sr-only|flex-(?:row|col|wrap|1|none|auto)|grow|shrink-0|basis-(?:0|auto|full)|grid-cols-[1-4]|col-span-[1-4]|row-span-[1-4]|(?:items|justify|self|place-items|place-content|content)-(?:start|end|center|between|around|evenly|stretch|baseline)|text-(?:start|center|end)|(?:w|h|min-w|min-h|max-w|max-h|size)-(?:full|auto|min|max|fit|screen|dvh|0)|static|relative|absolute|fixed|sticky|isolate|z-0|overflow(?:-x|-y)?-(?:hidden|auto|scroll|visible|clip)|truncate|whitespace-(?:normal|nowrap|pre|pre-wrap)|break-(?:normal|words|all|keep)|list-none|pointer-events-(?:none|auto)|select-(?:none|text|all|auto))$/.test(utility)) return true;
  const spacing = /^(gap(?:-x|-y)?|p[xytsbelr]?|m[xytsbelr]?|scroll-mt|scroll-m|inset|top|bottom|start|end)-(.+)$/.exec(utility);
  if (spacing && (spacing[2] === "0" || spacing[2] === "auto" && spacing[1]!.startsWith("m") || /^\d+(?:\.5)?$/.test(spacing[2]!) && readToken("--spacing", contract, tokens))) return true;
  const variable = /^(?:w|h|min-w|min-h|max-w|max-h|size|gap(?:-x|-y)?|p[xytsbelr]?|m[xytsbelr]?|inset|top|bottom|start|end)-\[var\((--[a-z0-9-]+)\)\]$/.exec(utility);
  return !!variable && readToken(variable[1]!, contract, tokens);
}
function resolve(file: string, specifier: string, files: LayoutRendererSource["files"]): string | undefined {
  const parts = file.split("/"); parts.pop();
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    if (part === "..") { if (!parts.length) return undefined; parts.pop(); } else parts.push(part);
  }
  const path = parts.join("/");
  return [path, path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx"), `${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(key => Object.hasOwn(files, key));
}

/** Bounded source inspection. The compiler port parses; all closure and purity decisions stay here. */
export function analyzeLayoutSource(renderer: LayoutRendererSource, contract: PageLayoutContract, tokens: readonly BindingToken[], compiler?: LayoutCompilerPort): string[] {
  if (!compiler || typeof compiler.parseSourceFile !== "function" || typeof compiler.kind !== "function" || typeof compiler.children !== "function") return ["LK11 compiler parser is unavailable"];
  const failures = new Set<string>(), modules = new Map<string, Module>();
  const fail = (file: string, message: string) => failures.add(`${file}: ${message}`);
  const kind = (value: unknown) => value ? compiler.kind(value) : "";
  let budget = 100_000;
  try {
    if (!renderer || !record(renderer.files) || typeof renderer.entry !== "string" || !Object.hasOwn(renderer.files, renderer.entry)) return ["missing renderer source closure"];
    if (Object.keys(renderer.files).length > 64 || Object.values(renderer.files).reduce((sum, source) => sum + source.length, 0) > 1_000_000) return ["renderer source closure exceeds inspection bounds"];
    for (const [file, source] of Object.entries(renderer.files)) {
      if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:tsx?|json)$/.test(file) || file.split("/").includes("..") || typeof source !== "string" || !source.trim() || source.length > 200_000) { fail(file, "unsupported source"); continue; }
      if (/token-gate\s*:\s*ignore/.test(source)) fail(file, "R1 suppression is not source clearance");
      if (file.endsWith(".json")) { JSON.parse(source); continue; }
      const root = node(compiler.parseSourceFile(file, source));
      if (!root || kind(root) !== "SourceFile" || root.text !== source || !Array.isArray(root.statements) || !root.statements.length || !Array.isArray(root.parseDiagnostics) || root.parseDiagnostics.length) { fail(file, "malformed or unparsed compiler source"); continue; }
      const module: Module = { name: file, source, root, nodes: [], parent: new Map(), bindings: new Map(), imports: new Map(), data: new Map() };
      const stack: Node[] = [root], seen = new Set<Node>();
      while (stack.length) {
        const current = stack.pop()!;
        if (--budget < 0 || seen.has(current)) throw new Error("syntax budget or cycle");
        seen.add(current);
        const syntax = kind(current);
        if (!KINDS.has(syntax) || !Number.isInteger(current.pos) || !Number.isInteger(current.end) || (current.pos as number) < 0 || (current.end as number) < (current.pos as number) || (current.end as number) > source.length) { fail(file, `unknown syntax or invalid compiler range (${syntax})`); break; }
        module.nodes.push(current);
        const children = compiler.children(current);
        if (!Array.isArray(children)) throw new Error("malformed children");
        for (const field of CHILD_FIELDS) {
          const fieldValue = current[field], declared = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
          for (const child of declared) if (record(child) && typeof child.kind === "number" && !children.includes(child)) throw new Error("omitted syntax child");
        }
        for (const child of children) {
          if (!record(child) || (child.pos as number) < (current.pos as number) || (child.end as number) > (current.end as number)) throw new Error("malformed child range");
          module.parent.set(child, current); stack.push(child);
        }
      }
      if (!nodes(root.statements).every(statement => seen.has(statement)) || !seen.has(node(root.endOfFileToken)!)) fail(file, "incomplete compiler tree");
      modules.set(file, module);
    }
    if (!modules.has(renderer.entry)) return [...failures, "missing parsed entry module"];
    const scope = (module: Module, at: Node): Node => {
      let parent = module.parent.get(at);
      while (parent && !["SourceFile", "Block", "FunctionDeclaration", "FunctionExpression", "ArrowFunction"].includes(kind(parent))) parent = module.parent.get(parent);
      return parent ?? module.root;
    };
    const declare = (module: Module, at: Node, pattern: Node | undefined, value: Node | undefined, path: string[] = [], parameter = false): void => {
      if (!pattern) return;
      if (kind(pattern) === "Identifier") {
        const owner = scope(module, at), bindings = module.bindings.get(owner) ?? new Map<string, Binding>();
        bindings.set(name(pattern)!, { node: pattern, file: module, value, path, parameter }); module.bindings.set(owner, bindings);
      } else if (["ObjectBindingPattern", "ArrayBindingPattern"].includes(kind(pattern))) nodes(pattern.elements).forEach((element, index) => {
        if (element.dotDotDotToken) fail(module.name, "unclosed rest binding");
        declare(module, at, node(element.name), value, [...path, kind(pattern) === "ArrayBindingPattern" ? String(index) : name(element.propertyName ?? element.name)!], parameter);
      });
    };
    for (const module of modules.values()) for (const at of module.nodes) {
      const syntax = kind(at);
      if (syntax === "VariableDeclaration") declare(module, at, node(at.name), node(at.initializer));
      if (["FunctionDeclaration", "FunctionExpression"].includes(syntax) && at.name) declare(module, at, node(at.name), at);
      if (syntax === "Parameter") declare(module, at, node(at.name), node(at.initializer), [], true);
      if (syntax === "ImportDeclaration") {
        const specifier = name(at.moduleSpecifier), clause = node(at.importClause);
        if (clause?.isTypeOnly) continue;
        if (!specifier || !clause) { fail(module.name, "unclosed side-effect import"); continue; }
        const bindings = node(clause.namedBindings), elements = nodes(bindings?.elements).filter(item => !item.isTypeOnly);
        if (specifier.startsWith(".")) {
          const target = resolve(module.name, specifier, renderer.files);
          if (!target) { fail(module.name, "missing local source dependency"); continue; }
          if (target.endsWith(".json")) {
            if (!clause.name || bindings) fail(module.name, "JSON requires a data-only default import");
            else module.data.set(name(clause.name)!, jsonValue(JSON.parse(renderer.files[target]!)));
            continue;
          }
          if (clause.name || kind(bindings) === "NamespaceImport") { fail(module.name, "only named source imports are inspected"); continue; }
          if (!modules.has(target)) { fail(module.name, "unparsed local dependency"); continue; }
          for (const element of elements) module.imports.set(name(element.name)!, { file: target, name: name(element.propertyName ?? element.name)! });
        } else if (clause.name || kind(bindings) === "NamespaceImport" || specifier !== "react" || elements.some(element => name(element.propertyName ?? element.name) !== "Children")) fail(module.name, "non-allowlisted runtime import");
      }
      if (syntax === "ExportDeclaration" && at.moduleSpecifier && !at.isTypeOnly) {
        const target = resolve(module.name, name(at.moduleSpecifier) ?? "", renderer.files);
        if (!target || !modules.has(target)) fail(module.name, "missing re-export closure");
      }
    }
    const lookup = (module: Module, at: Node, id: string): Binding | undefined => {
      let cursor: Node | undefined = at;
      while (cursor) { const binding = module.bindings.get(cursor)?.get(id); if (binding) return binding; cursor = module.parent.get(cursor); }
      const imported = module.imports.get(id), other = imported && modules.get(imported.file);
      return other && other.bindings.get(other.root)?.get(imported!.name);
    };
    for (const module of modules.values()) for (const imported of module.imports.values()) {
      const target = modules.get(imported.file), binding = target?.bindings.get(target.root)?.get(imported.name);
      let declaration = binding?.node;
      while (declaration && !["VariableStatement", "FunctionDeclaration"].includes(kind(declaration))) declaration = target?.parent.get(declaration);
      if (!declaration || !nodes(declaration.modifiers).some(modifier => kind(modifier) === "ExportKeyword")) fail(module.name, "imported binding is not a directly exported source declaration");
    }
    const mutate = (module: Module, at: Node, target: Node | undefined, numeric = false, seen = new Set<Node>()): void => {
      if (!target || seen.has(target)) return;
      seen.add(target);
      if (["PropertyAccessExpression", "ElementAccessExpression", "ParenthesizedExpression", "NonNullExpression", "AsExpression"].includes(kind(target))) return mutate(module, at, node(target.expression), false, seen);
      const binding = lookup(module, at, name(target) ?? "");
      if (!binding) { fail(module.name, "mutation escapes a local binding"); return; }
      if (binding.parameter) fail(module.name, "mutation of an unclosed helper argument");
      binding.mutated = true;
      binding.numericUpdates = binding.numericUpdates === false ? false : numeric;
      if (binding.value && kind(binding.value) === "Identifier") mutate(binding.file, binding.value, binding.value, false, seen);
    };
    const memberWrites = new Set<Node>();
    const markMemberWrite = (module: Module, at: Node, owner: Node | undefined, seen = new Set<Node>()): void => {
      if (!owner || seen.has(owner)) return;
      seen.add(owner);
      if (["PropertyAccessExpression", "ElementAccessExpression", "AsExpression", "NonNullExpression", "ParenthesizedExpression"].includes(kind(owner))) return markMemberWrite(module, at, node(owner.expression), seen);
      const binding = lookup(module, at, name(owner) ?? "");
      if (binding) { memberWrites.add(binding.node); if (binding.value && kind(binding.value) === "Identifier") markMemberWrite(binding.file, binding.value, binding.value, seen); }
    };
    for (const module of modules.values()) for (const at of module.nodes) {
      const syntax = kind(at), op = kind(at.operatorToken);
      if (syntax === "BinaryExpression" && ["EqualsToken", "PlusEqualsToken", "MinusEqualsToken", "AsteriskEqualsToken", "SlashEqualsToken"].includes(op)) {
        const left = node(at.left);
        if (["PropertyAccessExpression", "ElementAccessExpression"].includes(kind(left))) {
          markMemberWrite(module, at, node(left?.expression));
        }
        if (kind(left) === "Identifier") { const binding = lookup(module, at, name(left) ?? ""); if (binding) binding.rebound = true; }
        mutate(module, at, left, kind(left) === "Identifier" && ["MinusEqualsToken", "AsteriskEqualsToken", "SlashEqualsToken"].includes(op) || op === "PlusEqualsToken" && kind(at.right) === "NumericLiteral");
      }
      if (["PrefixUnaryExpression", "PostfixUnaryExpression"].includes(syntax) && ["PlusPlusToken", "MinusMinusToken"].includes(compiler.kind({ kind: at.operator }))) mutate(module, at, node(at.operand), true);
      if (syntax === "CallExpression") {
        const target = node(at.expression), owner = node(target?.expression), method = name(target?.name);
        if (name(owner) === "Object" && method === "assign") mutate(module, at, nodes(at.arguments)[0]);
        else if (["push", "pop", "reverse", "add", "set"].includes(method ?? "")) mutate(module, at, owner);
      }
    }
    const select = (value: Value, key: string): Value => union(values(value).map(item => {
      if (item.kind === "object") return item.open ? UNKNOWN : item.properties.get(key) ?? literal(undefined);
      if (item.kind === "array" && /^\d+$/.test(key)) return item.values[Number(key)] ?? literal(undefined);
      return UNKNOWN;
    }));
    let evaluations = 0;
    const evaluate = (module: Module, at: Node | undefined, env = new Map<Node, Value>(), active = new Set<Node>()): Value => {
      if (!at || ++evaluations > 80_000 || active.has(at)) return UNKNOWN;
      const chain = new Set(active); chain.add(at);
      const read = (child: unknown) => evaluate(module, node(child), env, chain);
      const syntax = kind(at);
      if (["StringLiteral", "NoSubstitutionTemplateLiteral"].includes(syntax)) return literal(name(at)!);
      if (syntax === "NumericLiteral") return Number.isFinite(Number(at.text)) ? literal(Number(at.text)) : UNKNOWN;
      if (syntax === "TrueKeyword" || syntax === "FalseKeyword") return literal(syntax === "TrueKeyword");
      if (syntax === "NullKeyword") return literal(null);
      if (syntax === "Identifier") {
        const id = name(at)!;
        if (id === "undefined") return literal(undefined);
        const data = module.data.get(id);
        if (data) return data;
        const binding = lookup(module, at, id);
        if (!binding) return UNKNOWN;
        if (env.has(binding.node)) return env.get(binding.node)!;
        let value = evaluate(binding.file, binding.value, env, chain);
        if (binding.mutated) return UNKNOWN;
        for (const part of binding.path) value = select(value, part);
        return value;
      }
      if (["ParenthesizedExpression", "AsExpression", "TypeAssertionExpression", "NonNullExpression", "SatisfiesExpression"].includes(syntax)) return read(at.expression);
      if (syntax === "ConditionalExpression") return union([read(at.whenTrue), read(at.whenFalse)]);
      if (syntax === "BinaryExpression") {
        const op = kind(at.operatorToken);
        if (["BarBarToken", "AmpersandAmpersandToken", "QuestionQuestionToken"].includes(op)) return union([read(at.left), read(at.right)]);
        if (["PlusToken", "MinusToken", "AsteriskToken", "SlashToken", "PercentToken", "AsteriskAsteriskToken"].includes(op)) {
          const result: Value[] = [];
          for (const left of values(read(at.left))) for (const right of values(read(at.right))) {
            if (left.kind !== "literal" || right.kind !== "literal" || typeof left.value !== "number" || typeof right.value !== "number") return UNKNOWN;
            const a = left.value, b = right.value;
            const value = op === "PlusToken" ? a + b : op === "MinusToken" ? a - b : op === "AsteriskToken" ? a * b : op === "SlashToken" ? a / b : op === "PercentToken" ? a % b : a ** b;
            if (!Number.isFinite(value)) return UNKNOWN;
            result.push(literal(value));
          }
          return union(result);
        }
        return UNKNOWN;
      }
      if (syntax === "PrefixUnaryExpression") {
        const op = compiler.kind({ kind: at.operator }), operand = read(at.operand);
        if (!["PlusToken", "MinusToken"].includes(op)) return UNKNOWN;
        return union(values(operand).map(value => value.kind === "literal" && typeof value.value === "number" && Number.isFinite(value.value) ? literal(op === "MinusToken" ? -value.value : value.value) : UNKNOWN));
      }
      if (syntax === "ArrayLiteralExpression") return { kind: "array", values: nodes(at.elements).map(element => kind(element) === "SpreadElement" ? UNKNOWN : read(element)) };
      if (syntax === "ObjectLiteralExpression") {
        const properties = new Map<string, Value>(); let open = false;
        for (const property of nodes(at.properties)) {
          const key = name(property.name);
          if (kind(property) === "SpreadAssignment" || !key) { open = true; continue; }
          properties.set(key, read(kind(property) === "ShorthandPropertyAssignment" ? property.name : property.initializer));
        }
        return { kind: "object", properties, open };
      }
      if (syntax === "PropertyAccessExpression") return select(read(at.expression), name(at.name)!);
      if (syntax === "ElementAccessExpression") {
        const source = read(at.expression), key = read(at.argumentExpression);
        return union(values(key).map(index => {
          if (index.kind === "literal" && (typeof index.value === "string" || typeof index.value === "number")) return select(source, String(index.value));
          if (index.kind === "number") return union(values(source).flatMap(item => item.kind === "array" ? [...item.values, literal(undefined)] : [UNKNOWN]));
          return UNKNOWN;
        }));
      }
      if (["FunctionDeclaration", "ArrowFunction", "FunctionExpression"].includes(syntax)) return { kind: "function", node: at, file: module };
      const invoke = (functionValue: Value, args: Value[]): Value => union(values(functionValue).map(fn => {
        if (fn.kind !== "function") return UNKNOWN;
        const bound = new Map(env);
        nodes(fn.node.parameters).forEach((parameter, index) => {
          const pattern = node(parameter.name);
          if (pattern && kind(pattern) === "Identifier") bound.set(pattern, args[index] ?? literal(undefined));
          else if (pattern) for (const element of nodes(pattern.elements)) {
            const key = name(element.propertyName ?? element.name);
            if (node(element.name) && key) bound.set(node(element.name)!, select(args[index] ?? UNKNOWN, key));
          }
        });
        const body = node(fn.node.body);
        if (!body) return UNKNOWN;
        // Recognize one small runtime proof, not a type assertion or a trusted helper name.
        // The whole body must reject nonnumbers/nonfinite values and return the same parameter.
        const statements = nodes(body.statements), parameters = nodes(fn.node.parameters);
        if (kind(body) === "Block" && statements.length === 2 && parameters.length === 1) {
          const parameter = node(parameters[0]!.name), first = statements[0]!, last = statements[1]!;
          const sameParameter = (value: unknown) => kind(value) === "Identifier" && name(value) === name(parameter);
          const clauses = (value: Node | undefined): Node[] => kind(value) === "BinaryExpression" && kind(value?.operatorToken) === "BarBarToken" ? [...clauses(node(value?.left)), ...clauses(node(value?.right))] : value ? [value] : [];
          const checks = clauses(node(first.expression));
          const rejectsType = (check: Node) => kind(check) === "BinaryExpression" && kind(check.operatorToken) === "ExclamationEqualsEqualsToken" && kind(check.left) === "TypeOfExpression" && sameParameter(node(check.left)?.expression) && name(check.right) === "number";
          const rejectsNonfinite = (check: Node) => {
            if (kind(check) !== "PrefixUnaryExpression" || compiler.kind({ kind: check.operator }) !== "ExclamationToken") return false;
            const call = node(check.operand), target = node(call?.expression);
            return kind(call) === "CallExpression" && kind(target) === "PropertyAccessExpression" && name(target?.expression) === "Number" && !lookup(fn.file, check, "Number") && ["isFinite", "isSafeInteger"].includes(name(target?.name) ?? "") && nodes(call?.arguments).length === 1 && sameParameter(nodes(call?.arguments)[0]);
          };
          const rangeCheck = (check: Node) => kind(check) === "BinaryExpression" && ["LessThanToken", "GreaterThanToken", "LessThanEqualsToken", "GreaterThanEqualsToken"].includes(kind(check.operatorToken)) && sameParameter(check.left) && kind(check.right) === "NumericLiteral" && Number.isFinite(Number(node(check.right)?.text));
          const thrown = node(first.thenStatement), thrownStatements = kind(thrown) === "Block" ? nodes(thrown?.statements) : thrown ? [thrown] : [];
          if (parameter && kind(parameter) === "Identifier" && kind(first) === "IfStatement" && !first.elseStatement && checks.some(rejectsType) && checks.some(rejectsNonfinite) && checks.every(check => rejectsType(check) || rejectsNonfinite(check) || rangeCheck(check)) && thrownStatements.length === 1 && kind(thrownStatements[0]) === "ThrowStatement" && kind(last) === "ReturnStatement" && sameParameter(last.expression)) bound.set(parameter, NUMBER);
        }
        if (kind(body) !== "Block") return evaluate(fn.file, body, bound, chain);
        const returned = fn.file.nodes.filter(candidate => kind(candidate) === "ReturnStatement" && (() => {
          let parent = fn.file.parent.get(candidate);
          while (parent && !["FunctionDeclaration", "ArrowFunction", "FunctionExpression"].includes(kind(parent))) parent = fn.file.parent.get(parent);
          return parent === fn.node;
        })()).map(candidate => evaluate(fn.file, node(candidate.expression), bound, chain));
        return returned.length ? union(returned) : literal(undefined);
      }));
      if (syntax === "CallExpression") {
        const target = node(at.expression), args = nodes(at.arguments), targetName = name(target), owner = node(target?.expression), method = name(target?.name);
        if (kind(target) === "Identifier" && targetName === "Number" && !lookup(module, at, "Number")) {
          if (args.length !== 1) return UNKNOWN;
          return union(values(read(args[0])).map(value => {
            if (value.kind !== "literal" || !["number", "string"].includes(typeof value.value)) return UNKNOWN;
            const converted = Number(value.value);
            return Number.isFinite(converted) ? literal(converted) : UNKNOWN;
          }));
        }
        if (name(owner) === "Math" && !lookup(module, at, "Math") && ["min", "max", "floor", "ceil", "round", "abs"].includes(method ?? "")) {
          const operands = args.map(read);
          if (!operands.length || operands.some(value => values(value).some(item => item.kind !== "number" && !(item.kind === "literal" && typeof item.value === "number" && Number.isFinite(item.value))))) return UNKNOWN;
          return NUMBER;
        }
        if (method === "map" || method === "flatMap") {
          const argument = args[0];
          const source = read(target?.expression);
          if (values(source).some(item => item.kind !== "array") || method === "flatMap") return UNKNOWN;
          return union(values(source).map(item => item.kind === "array"
            ? { kind: "array", values: item.values.map((element, index) => invoke(read(argument), [element, literal(index)])) }
            : UNKNOWN));
        }
        return invoke(read(target), args.map(read));
      }
      return UNKNOWN;
    };
    // A receiver type comes from construction or an earlier rejecting guard in this block.
    // A guard hidden in another branch/try/callback cannot dominate this operation.
    const guardedArray = (module: Module, at: Node, binding: Binding): boolean => {
      let cursor: Node | undefined = at;
      while (cursor) {
        const parent = module.parent.get(cursor);
        if (!parent) return false;
        if (kind(parent) === "Block") {
          const siblings = nodes(parent.statements), index = siblings.indexOf(cursor);
          for (const statement of siblings.slice(0, index)) {
            if (kind(statement) !== "IfStatement" || statement.elseStatement) continue;
            const thrown = node(statement.thenStatement), actions = kind(thrown) === "Block" ? nodes(thrown?.statements) : thrown ? [thrown] : [];
            if (actions.length !== 1 || kind(actions[0]) !== "ThrowStatement") continue;
            const clauses = (check: Node | undefined): Node[] => kind(check) === "BinaryExpression" && kind(check?.operatorToken) === "BarBarToken" ? [...clauses(node(check?.left)), ...clauses(node(check?.right))] : check ? [check] : [];
            if (clauses(node(statement.expression)).some(check => {
              if (kind(check) !== "PrefixUnaryExpression" || compiler.kind({ kind: check.operator }) !== "ExclamationToken") return false;
              const call = node(check.operand), target = node(call?.expression), argument = nodes(call?.arguments)[0];
              return kind(call) === "CallExpression" && name(target?.expression) === "Array" && name(target?.name) === "isArray" && !lookup(module, check, "Array") && nodes(call?.arguments).length === 1 && kind(argument) === "Identifier" && lookup(module, argument!, name(argument) ?? "") === binding;
            })) return true;
          }
        }
        if (["FunctionDeclaration", "ArrowFunction", "FunctionExpression"].includes(kind(parent))) return false;
        cursor = parent;
      }
      return false;
    };
    const collectionReceiver = (module: Module, at: Node | undefined, method: string, seen = new Set<Node>()): boolean => {
      if (!at || seen.has(at)) return false;
      seen.add(at);
      const syntax = kind(at);
      if (["AsExpression", "NonNullExpression", "ParenthesizedExpression"].includes(syntax)) return collectionReceiver(module, node(at.expression), method, seen);
      if (syntax === "Identifier") {
        const binding = lookup(module, at, name(at) ?? "");
        if (binding && !binding.rebound && !memberWrites.has(binding.node)) {
          if (guardedArray(module, at, binding) && ["map", "flatMap", "reduce", "some", "every", "find", "filter", "includes", "entries", "keys", "values", "push", "pop", "reverse", "slice", "join", "indexOf"].includes(method)) return true;
          if (!binding.parameter && !binding.path.length) return collectionReceiver(binding.file, binding.value, method, seen);
        }
      }
      if (syntax === "CallExpression") {
        const target = node(at.expression), owner = name(target?.expression), operation = name(target?.name);
        if (kind(target) === "PropertyAccessExpression" && !lookup(module, at, owner ?? "") && (owner === "Object" && ["entries", "keys", "values"].includes(operation ?? "") || owner === "Array" && operation === "from")) return ["map", "some", "every", "find", "filter", "includes", "entries", "keys", "values", "slice", "join", "indexOf"].includes(method);
        if (kind(target) === "PropertyAccessExpression" && operation === "map" && collectionReceiver(module, node(target?.expression), "map", seen)) return ["map", "some", "find", "includes", "indexOf"].includes(method);
      }
      if (syntax === "RegularExpressionLiteral") return method === "test";
      if (syntax === "NewExpression" && !lookup(module, at, name(at.expression) ?? "")) return name(at.expression) === "Set" ? ["has", "add", "values", "entries", "keys"].includes(method) : name(at.expression) === "Map" && ["has", "get", "set", "values", "entries", "keys"].includes(method);
      const value = evaluate(module, at);
      return values(value).length > 0 && values(value).every(item => item.kind === "array" ? ["map", "flatMap", "reduce", "some", "every", "find", "filter", "includes", "entries", "keys", "values", "push", "pop", "reverse", "slice", "join", "indexOf"].includes(method)
        : item.kind === "literal" && typeof item.value === "string" && ["split", "includes", "startsWith", "slice", "replace"].includes(method));
    };
    for (const module of modules.values()) for (const at of module.nodes) {
      const syntax = kind(at), id = name(at);
      if (syntax === "Identifier" && id && FORBIDDEN.has(id)) fail(module.name, "dynamic construction or ambient access");
      if (["JsxSpreadAttribute", "SpreadElement", "AwaitExpression"].includes(syntax)) fail(module.name, "uninspected JSX spread or deferred construction");
      if (["StringLiteral", "NoSubstitutionTemplateLiteral", "TemplateHead", "TemplateMiddle", "TemplateTail"].includes(syntax) && /@(?:media|container)\b|\(\s*(?:min|max)-(?:width|height)\s*:|var\([^)]*,|grid-auto-flow\s*:\s*dense|(?:row|column)-reverse/.test(String(at.text))) fail(module.name, "raw query, fallback or reading order");
      if (syntax === "CallExpression") {
        const target = node(at.expression), method = name(target?.name), owner = node(target?.expression);
        if (kind(target) === "Identifier") {
          if (!(["Number", "String"].includes(name(target) ?? "") && !lookup(module, at, name(target) ?? "")) && !values(evaluate(module, target)).every(value => value.kind === "function")) fail(module.name, `unresolved callable dependency at ${at.pos}`);
        } else {
          const builtin = kind(target) === "PropertyAccessExpression" && !lookup(module, at, name(owner) ?? "") && (Object.entries({ Object: ["fromEntries", "entries", "keys", "values", "assign", "freeze"], Number: ["isFinite", "isSafeInteger"], Math: ["min", "max", "floor", "ceil", "round", "abs"], Array: ["isArray", "from"] }).some(([id, methods]) => name(owner) === id && methods.includes(method ?? ""))
            || name(owner) === "Children" && method === "count" && module.nodes.some(statement => kind(statement) === "ImportDeclaration" && name(statement.moduleSpecifier) === "react" && nodes(node(node(statement.importClause)?.namedBindings)?.elements).some(element => name(element.name) === "Children" && name(element.propertyName ?? element.name) === "Children")));
          if (kind(target) !== "PropertyAccessExpression" || !method || !builtin && (!COLLECTION.has(method) || !collectionReceiver(module, owner, method))) fail(module.name, `unproved callable receiver at ${at.pos}`);
          if (["map", "flatMap", "reduce", "some", "every", "find", "filter"].includes(method ?? "")) {
            const callback = nodes(at.arguments)[0];
            if (!(name(callback) === "Number" && !lookup(module, at, "Number")) && !values(evaluate(module, callback)).every(value => value.kind === "function")) fail(module.name, "unclosed collection callback");
          }
        }
      }
      if (syntax === "NewExpression" && (!["Error", "Set", "Map"].includes(name(at.expression) ?? "") || !!lookup(module, at, name(at.expression) ?? ""))) fail(module.name, "uninspected constructor");
      if (syntax === "ElementAccessExpression") {
        const key = node(at.argumentExpression);
        if (["constructor", "__proto__", "prototype", "style", "className", "cssText"].includes(name(key) ?? "")) fail(module.name, "reflective or member style access");
      }
      if (syntax === "PropertyAccessExpression" && ["constructor", "__proto__", "prototype", "style", "className", "cssText"].includes(name(at.name) ?? "")) fail(module.name, "uninspected member style or reflection");
      if (syntax === "JsxOpeningElement" || syntax === "JsxSelfClosingElement") {
        const tag = name(at.tagName);
        if (!tag || /^[a-z]/.test(tag) && !["div", "span"].includes(tag)) fail(module.name, "R4/R5 nonstructural element");
        if (tag && /^[A-Z]/.test(tag) && !lookup(module, at, tag)) fail(module.name, "uninspected component dependency");
      }
      if (syntax === "JsxAttribute") {
        const attribute = name(at.name) ?? "", initializer = node(at.initializer);
        if (!["className", "style", "id", "key"].includes(attribute) && !/^(?:data|aria)-[a-z-]+$/.test(attribute)) { fail(module.name, "uninspected JSX attribute"); continue; }
        if (attribute !== "style" && attribute !== "className") continue;
        const expression = kind(initializer) === "JsxExpression" ? node(initializer?.expression) : initializer;
        const value = evaluate(module, expression);
        if (attribute === "className") {
          if (!values(value).every(item => item.kind === "literal" && typeof item.value === "string" && item.value.trim().split(/\s+/).filter(Boolean).every(token => classToken(token, contract, tokens)))) fail(module.name, "R2 class value is not finite structural literals");
        } else if (!values(value).every(item => item.kind === "object" && !item.open && [...item.properties].every(([key, value]) => STYLE_KEY.test(key) && styleValue(value, contract, tokens)))) fail(module.name, "R3 style value is not a closed structural object");
      }
    }
    return [...failures];
  } catch { return [...failures, "LK11 compiler syntax could not be inspected"]; }
}
