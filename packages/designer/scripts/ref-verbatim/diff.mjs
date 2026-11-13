/**
 * AST diff for the ref-verbatim check (TypeScript compiler API).
 *
 * Compares a normalized reference file with a payload file and returns every
 * hunk. A hunk either matches one allowed rule (H-IMPORT, H-TOKEN, H-DATA,
 * H-PROPS, H-LINK) or fails with a code (REF-HUNK-CLASS, REF-HUNK-STRUCTURE,
 * REF-HUNK-LOGIC, REF-HUNK-TEXT). The comparison is on syntax trees, so
 * formatting (quotes, wrapping, trailing commas, semicolons) never makes a hunk.
 *
 * The class helper `cn` is trusted only as the registry's own: a payload that
 * calls `cn` must bind it by one unaliased `import { cn }` from a CN_MODULES
 * module (the reference's own cn module, the registry alias "cn", or the
 * consumer's utils alias), and never redeclare it. Any other binding is
 * REF-HUNK-LOGIC: an allowed H-IMPORT must not turn `cn(...)` (and so the
 * className passthrough) into a call of arbitrary code.
 */
import { loadTypeScript } from "./typescript.mjs";
import { NormalizeError } from "./normalize.mjs";

export const ALLOWED = ["H-IMPORT", "H-TOKEN", "H-DATA", "H-PROPS", "H-LINK"];
export const HUNK_CODES = ["REF-HUNK-CLASS", "REF-HUNK-STRUCTURE", "REF-HUNK-LOGIC", "REF-HUNK-TEXT"];

const CLASS_CALLS = new Set(["cn", "cva", "clsx", "cx", "twMerge", "twJoin"]);
const TOKEN_PREFIXES = ["bg", "text", "border", "ring", "fill", "stroke", "rounded", "font", "shadow"];
const TOKEN_VAR_FAMILIES = { rounded: ["radius"], font: ["font", "font-weight"], shadow: ["shadow"], text: ["text", "color"], bg: ["color"], border: ["color"], ring: ["color"], fill: ["color"], stroke: ["color"] };
const NON_VISUAL = /^(id|role|tabIndex|aria-[a-z-]+|data-[a-z0-9-]+)$/;
const ENGINE_IMPORT = /^(@radix-ui\/|radix-ui(\/|$)|react-aria-components(\/|$)|react-aria(\/|$)|@react-aria\/|@base-ui-components\/|@base-ui\/)/;
const ENGINE_PROP = /^(asChild|data-radix[a-z-]*|isOpen|onOpenChange|onPress|isDisabled|isSelected|onSelectionChange)$/;

const parse = (ts, text, fileName) => {
  const kind = /\.tsx$|\.jsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics?.length) {
    throw new NormalizeError(`${fileName}: parse error ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ")}`);
  }
  return sf;
};

/** Split a class string at top-level whitespace. */
const classTokens = (value) => value.split(/\s+/).filter(Boolean);

/** `hover:data-[x=y]:bg-muted/50` → { variants: "hover:data-[x=y]:", utility: "bg-muted/50" }. */
function splitVariant(token) {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) cut = i;
  }
  return { variants: token.slice(0, cut + 1), utility: token.slice(cut + 1) };
}

const prefixOf = (utility) => {
  const bare = utility.replace(/^!/, "").replace(/^-/, "");
  return TOKEN_PREFIXES.find((p) => bare === p || bare.startsWith(`${p}-`));
};

/** H-TOKEN: one utility replaced by a same-prefix theme-variable utility. */
export function tokenSwapAllowed(from, to, themeVars = []) {
  const a = splitVariant(from);
  const b = splitVariant(to);
  if (a.variants !== b.variants) return false;
  const prefix = prefixOf(a.utility);
  if (!prefix || prefixOf(b.utility) !== prefix) return false;
  const value = b.utility.replace(/^!/, "").slice(prefix.length + 1).replace(/\/[0-9.]+$|\/\[[^\]]+\]$|\/\([^)]+\)$/, "");
  if (/^\(--[a-zA-Z0-9-]+\)$/.test(value) || /^\[var\(--[a-zA-Z0-9-]+\)\]$/.test(value)) return true;
  if (!value) return false;
  const vars = new Set(themeVars);
  const candidates = [`--${value}`, ...(TOKEN_VAR_FAMILIES[prefix] ?? []).map((family) => `--${family}-${value}`)];
  return candidates.some((name) => vars.has(name));
}

/** True when the code names no headless engine (no Radix, React Aria or Base UI imports or engine props). */
export function isEngineNeutral(text, fileName = "file.tsx") {
  const ts = loadTypeScript();
  const sf = parse(ts, text, fileName);
  let neutral = true;
  const visit = (node) => {
    if (!neutral) return;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (ENGINE_IMPORT.test(node.moduleSpecifier.text)) neutral = false;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg) && ENGINE_IMPORT.test(arg.text)) neutral = false;
    } else if (ts.isJsxAttribute(node) && ENGINE_PROP.test(node.name.getText(sf))) {
      neutral = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return neutral;
}

/** The modules a payload's `cn` may come from, beside the reference's own cn module: the shadcn registry alias, the default utils path. */
export const CN_MODULES = Object.freeze(["cn", "@/lib/utils"]);

/**
 * Diff a normalized reference against a payload file.
 * `utils` is the consumer's components.json utils alias, a further module the payload's `cn` may come from.
 * @returns {{ hunks: Array<{ rule: string, ok: boolean, ref: object|null, file: object|null, detail: string }> }}
 */
export function diffSources(refText, refName, fileText, fileName, { themeVars = [], linkComponents = [], utils } = {}) {
  const ts = loadTypeScript();
  const A = parse(ts, refText, refName);
  const B = parse(ts, fileText, fileName);
  const hunks = [];
  const pos = (sf, node) => {
    if (!node) return null;
    const s = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const e = sf.getLineAndCharacterOfPosition(node.getEnd());
    return { start: { line: s.line + 1, column: s.character + 1 }, end: { line: e.line + 1, column: e.character + 1 } };
  };
  const hunk = (rule, a, b, detail) => hunks.push({ rule, ok: ALLOWED.includes(rule), ref: pos(A, a), file: pos(B, b), detail });
  const text = (sf, node) => node.getText(sf).replace(/\s+/g, " ").replace(/\s*([,;:(){}[\]<>=|&])\s*/g, "$1").replace(/[,;]([)}\]>])/g, "$1");
  const same = (a, b) => text(A, a) === text(B, b);
  const unwrap = (node) => {
    let n = node;
    while (n && ts.isParenthesizedExpression(n)) n = n.expression;
    return n;
  };
  const isStringish = (n) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));
  const isLiteral = (n) => n && (isStringish(n) || ts.isNumericLiteral(n) || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword);
  const isLiteralTree = (n) => {
    const u = unwrap(n);
    if (!u) return false;
    if (isLiteral(u)) return true;
    if (ts.isArrayLiteralExpression(u)) return u.elements.every(isLiteralTree);
    if (ts.isObjectLiteralExpression(u)) return u.properties.every((p) => ts.isPropertyAssignment(p) && isLiteralTree(p.initializer));
    if (ts.isAsExpression(u) || ts.isSatisfiesExpression?.(u)) return isLiteralTree(u.expression);
    if (ts.isPrefixUnaryExpression(u)) return ts.isNumericLiteral(u.operand);
    return false;
  };
  const isJsx = (n) => n && (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n));
  const isFunctionLike = (n) => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n));

  // ---- imports -------------------------------------------------------------
  const importsOf = (sf) => {
    const map = new Map();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const key = st.moduleSpecifier.text;
      const entry = map.get(key) ?? { node: st, names: new Set() };
      const clause = st.importClause;
      if (!clause) entry.names.add("<side-effect>");
      else {
        if (clause.name) entry.names.add(`default:${clause.name.text}`);
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) entry.names.add(`*:${nb.name.text}`);
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) entry.names.add(`${(el.propertyName ?? el.name).text}:${el.name.text}`);
      }
      map.set(key, entry);
    }
    return map;
  };
  const importsA = importsOf(A);
  const importsB = importsOf(B);
  for (const key of new Set([...importsA.keys(), ...importsB.keys()])) {
    const a = importsA.get(key);
    const b = importsB.get(key);
    const names = (e) => [...(e?.names ?? [])].sort().join(",");
    if (!a || !b || names(a) !== names(b)) hunk("H-IMPORT", a?.node, b?.node, `import ${JSON.stringify(key)} ${!a ? "added" : !b ? "removed" : "changed"}`);
  }
  const nextLinkNames = new Set(
    [...(importsA.get("next/link")?.names ?? [])].map((n) => n.split(":")[1]).filter(Boolean),
  );
  const linkTargets = new Set(["a", ...linkComponents]);

  // ---- cn binding ----------------------------------------------------------
  {
    const cnModules = new Set([...CN_MODULES, ...(typeof utils === "string" ? [utils] : []), ...[...importsA].filter(([, e]) => e.names.has("cn:cn")).map(([key]) => key)]);
    const calls = [];
    const bindings = [];
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "cn") calls.push(node);
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const from = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
        if (clause?.name?.text === "cn") bindings.push({ node, ok: false, how: `the default import of ${JSON.stringify(from)}` });
        const nb = clause?.namedBindings;
        if (nb && ts.isNamespaceImport(nb) && nb.name.text === "cn") bindings.push({ node, ok: false, how: `a namespace import of ${JSON.stringify(from)}` });
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) {
          if (el.name.text !== "cn") continue;
          const imported = (el.propertyName ?? el.name).text;
          const ok = imported === "cn" && !el.isTypeOnly && !clause.isTypeOnly && cnModules.has(from);
          bindings.push({ node, ok, how: imported === "cn" ? `cn from ${JSON.stringify(from)}` : `${imported} from ${JSON.stringify(from)} renamed cn` });
        }
        return;
      }
      const named = (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isFunctionExpression(node) || ts.isEnumDeclaration(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === "cn";
      if (named) bindings.push({ node, ok: false, how: "a local declaration" });
      ts.forEachChild(node, visit);
    };
    visit(B);
    if (calls.length) {
      const bad = bindings.find((b) => !b.ok);
      if (bad) hunk("REF-HUNK-LOGIC", null, bad.node, `cn is bound to ${bad.how}; a payload's cn is the registry's own (${[...cnModules].join(", ")})`);
      else if (!bindings.length) hunk("REF-HUNK-LOGIC", null, calls[0], "cn is called but never imported; a payload's cn is the registry's own");
    }
  }

  // ---- top level -----------------------------------------------------------
  const isDirective = (st) => ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression);
  const declName = (st) => {
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) return st.name?.text ?? "default";
    if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) return st.name.text;
    if (ts.isVariableStatement(st)) return st.declarationList.declarations.map((d) => d.name.getText(st.getSourceFile())).join(",");
    return undefined;
  };
  const topKind = (st) => {
    if (ts.isFunctionDeclaration(st)) return "fn";
    if (ts.isClassDeclaration(st)) return "class";
    if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) return "type";
    if (ts.isVariableStatement(st)) return "var";
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier) return "export";
    if (ts.isExportDeclaration(st)) return "reexport";
    if (ts.isExportAssignment(st)) return "export-default";
    return "stmt";
  };
  const componentish = (st) =>
    ts.isFunctionDeclaration(st) ||
    (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1 && isFunctionLike(unwrap(st.declarationList.declarations[0].initializer)));
  const tops = (sf) =>
    sf.statements
      .filter((st) => !ts.isImportDeclaration(st) && !isDirective(st))
      .map((st, index) => {
        const kind = topKind(st);
        const name = declName(st);
        return { st, kind, key: name !== undefined ? `${kind}:${name}` : `${kind}:#${index}` };
      });
  const topA = tops(A);
  const topB = tops(B);
  const usedB = new Set();
  const pairs = [];
  const unmatchedA = [];
  for (const a of topA) {
    const b = topB.find((x) => !usedB.has(x) && x.key === a.key);
    if (b) {
      usedB.add(b);
      pairs.push([a, b]);
    } else unmatchedA.push(a);
  }
  let unmatchedB = topB.filter((x) => !usedB.has(x));
  // Export lists compare as one set; a component renamed or moved between
  // export styles pairs with the remaining component on the other side.
  const exportsOf = (list) => list.filter((x) => x.kind === "export" || x.kind === "export-default");
  const exA = exportsOf(unmatchedA);
  const exB = exportsOf(unmatchedB);
  const exportText = (sf, list) => list.map((x) => x.st.getText(sf).replace(/\s+/g, "")).sort().join("|");
  if ((exA.length || exB.length) && exportText(A, exA) !== exportText(B, exB)) {
    hunk("H-PROPS", exA[0]?.st, exB[0]?.st, "export list changed");
  }
  const restA = unmatchedA.filter((x) => !exA.includes(x));
  unmatchedB = unmatchedB.filter((x) => !exB.includes(x));
  const compA = restA.filter((x) => componentish(x.st));
  const compB = unmatchedB.filter((x) => componentish(x.st));
  const paired = Math.min(compA.length, compB.length);
  for (let i = 0; i < paired; i++) {
    hunk("H-PROPS", compA[i].st, compB[i].st, `component ${declName(compA[i].st)} renamed to ${declName(compB[i].st)}`);
    pairs.push([compA[i], compB[i], { renamed: true }]);
  }
  const leftA = restA.filter((x) => !compA.slice(0, paired).includes(x));
  const leftB = unmatchedB.filter((x) => !compB.slice(0, paired).includes(x));
  const orphan = (x, side) => {
    const a = side === "ref" ? x.st : undefined;
    const b = side === "file" ? x.st : undefined;
    const verb = side === "ref" ? "removed" : "added";
    if (x.kind === "type") return hunk("H-PROPS", a, b, `type ${declName(x.st)} ${verb}`);
    if (x.kind === "reexport") return hunk("H-IMPORT", a, b, `re-export ${verb}`);
    if (x.kind === "var" && x.st.declarationList.declarations.every((d) => d.initializer && isLiteralTree(d.initializer))) {
      return hunk("H-DATA", a, b, `literal data ${declName(x.st)} ${verb}`);
    }
    return hunk("REF-HUNK-LOGIC", a, b, `top-level ${x.kind} ${declName(x.st) ?? ""} ${verb}`.replace(/\s+/g, " "));
  };
  for (const x of leftA) orphan(x, "ref");
  for (const x of leftB) orphan(x, "file");

  const modifiersText = (sf, st) => (ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []).map((m) => m.getText(sf)).join(" ") : "");

  const fnOf = (st) =>
    ts.isFunctionDeclaration(st)
      ? st
      : ts.isVariableStatement(st) && st.declarationList.declarations.length === 1 && isFunctionLike(unwrap(st.declarationList.declarations[0].initializer))
        ? unwrap(st.declarationList.declarations[0].initializer)
        : undefined;

  function compareTop(a, b) {
    if (ts.isFunctionDeclaration(a) && ts.isFunctionDeclaration(b)) return compareFunction(a, b);
    if (a.kind !== b.kind && fnOf(a) && fnOf(b)) {
      hunk("H-PROPS", a, b, "component declared as a function instead of a const (or back)");
      return compareFunction(fnOf(a), fnOf(b));
    }
    if (ts.isVariableStatement(a) && ts.isVariableStatement(b)) {
      const da = a.declarationList.declarations;
      const db = b.declarationList.declarations;
      if (da.length !== db.length || a.declarationList.flags !== b.declarationList.flags) return hunk("REF-HUNK-LOGIC", a, b, "declaration changed");
      da.forEach((x, i) => {
        const y = db[i];
        const fa = unwrap(x.initializer);
        const fb = unwrap(y.initializer);
        if (isFunctionLike(fa) && isFunctionLike(fb)) {
          if (!same(x.name, y.name) || (x.type ? !y.type || !same(x.type, y.type) : !!y.type)) hunk("H-PROPS", x, y, "component signature changed");
          return compareFunction(fa, fb);
        }
        if (!same(x.name, y.name)) hunk("REF-HUNK-LOGIC", x.name, y.name, "binding renamed");
        if (x.type ? !y.type || !same(x.type, y.type) : !!y.type) hunk("H-PROPS", x.type ?? x, y.type ?? y, "type annotation changed");
        if (x.initializer && y.initializer) compareNode(x.initializer, y.initializer, {});
        else if (x.initializer || y.initializer) hunk("REF-HUNK-LOGIC", x, y, "initializer changed");
      });
      return;
    }
    if (ts.isInterfaceDeclaration(a) || ts.isTypeAliasDeclaration(a) || ts.isEnumDeclaration(a)) {
      if (!same(a, b)) hunk("H-PROPS", a, b, `type ${declName(a)} changed`);
      return;
    }
    compareNode(a, b, {});
  }

  function compareFunction(a, b) {
    const sig = (sf, f) =>
      [f.typeParameters?.map((p) => text(sf, p)).join(",") ?? "", f.parameters.map((p) => text(sf, p)).join(","), f.type ? text(sf, f.type) : ""].join("|");
    if (sig(A, a) !== sig(B, b)) hunk("H-PROPS", a.parameters[0] ?? a, b.parameters[0] ?? b, "component props or signature changed");
    if (!!a.asteriskToken !== !!b.asteriskToken) hunk("REF-HUNK-LOGIC", a, b, "generator changed");
    const asyncOf = (sf, f) => (ts.getModifiers(f) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    if (asyncOf(A, a) !== asyncOf(B, b)) hunk("REF-HUNK-LOGIC", a, b, "async changed");
    const bodyA = a.body;
    const bodyB = b.body;
    if (!bodyA || !bodyB) return;
    const asBlock = (body) => (ts.isBlock(body) ? body.statements : undefined);
    const sa = asBlock(bodyA);
    const sb = asBlock(bodyB);
    if (sa && sb) return compareStatements(sa, sb, bodyA, bodyB);
    if (!sa && !sb) return compareNode(bodyA, bodyB, {});
    // `=> expr` against `{ return expr }`.
    const block = sa ?? sb;
    const expr = sa ? bodyB : bodyA;
    if (block.length === 1 && ts.isReturnStatement(block[0]) && block[0].expression) {
      return sa ? compareNode(block[0].expression, expr, {}) : compareNode(expr, block[0].expression, {});
    }
    hunk("REF-HUNK-LOGIC", bodyA, bodyB, "function body changed");
  }

  function statementKey(sf, st) {
    if (ts.isVariableStatement(st)) return `var:${st.declarationList.declarations.map((d) => d.name.getText(sf)).join(",")}`;
    if (ts.isReturnStatement(st)) return "return";
    if (ts.isExpressionStatement(st)) {
      const e = st.expression;
      if (ts.isCallExpression(e)) return `call:${e.expression.getText(sf)}`;
      return `expr:${e.kind}`;
    }
    if (ts.isFunctionDeclaration(st)) return `fn:${st.name?.text}`;
    return `kind:${st.kind}`;
  }

  function compareStatements(listA, listB, parentA, parentB) {
    const ka = listA.map((s) => statementKey(A, s));
    const kb = listB.map((s) => statementKey(B, s));
    // LCS alignment on statement keys.
    const n = ka.length;
    const m = kb.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    const gapA = [];
    const gapB = [];
    const flush = () => {
      const k = Math.min(gapA.length, gapB.length);
      for (let x = 0; x < k; x++) compareNode(gapA[x], gapB[x], {});
      for (const s of gapA.slice(k)) {
        if (ts.isVariableStatement(s) && s.declarationList.declarations.every((d) => d.initializer && isLiteralTree(d.initializer))) hunk("H-DATA", s, undefined, "literal data removed");
        else hunk("REF-HUNK-LOGIC", s, parentB, "statement removed");
      }
      for (const s of gapB.slice(k)) {
        if (ts.isVariableStatement(s) && s.declarationList.declarations.every((d) => d.initializer && isLiteralTree(d.initializer))) hunk("H-DATA", undefined, s, "literal data added");
        else hunk("REF-HUNK-LOGIC", parentA, s, "statement, hook or handler added");
      }
      gapA.length = 0;
      gapB.length = 0;
    };
    while (i < n && j < m) {
      if (ka[i] === kb[j]) {
        flush();
        compareNode(listA[i], listB[j], {});
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) gapA.push(listA[i++]);
      else gapB.push(listB[j++]);
    }
    while (i < n) gapA.push(listA[i++]);
    while (j < m) gapB.push(listB[j++]);
    flush();
  }

  // ---- expressions ---------------------------------------------------------
  function children(node) {
    const out = [];
    ts.forEachChild(
      node,
      (c) => {
        out.push(c);
      },
      (arr) => {
        out.push(...arr);
      },
    );
    return out;
  }

  function compareClassString(a, b, ctx) {
    const ta = classTokens(a.text);
    const tb = classTokens(b.text);
    if (ta.join(" ") === tb.join(" ")) return;
    if (ta.length === tb.length) {
      const swaps = [];
      for (let k = 0; k < ta.length; k++) {
        if (ta[k] === tb[k]) continue;
        if (!tokenSwapAllowed(ta[k], tb[k], themeVars)) return hunk("REF-HUNK-CLASS", a, b, `class ${JSON.stringify(ta[k])} -> ${JSON.stringify(tb[k])} is not a same-prefix theme-token swap`);
        swaps.push(`${ta[k]} -> ${tb[k]}`);
      }
      return hunk("H-TOKEN", a, b, swaps.join(", "));
    }
    const added = tb.filter((t) => !ta.includes(t));
    const removed = ta.filter((t) => !tb.includes(t));
    hunk("REF-HUNK-CLASS", a, b, `classes ${[...removed.map((t) => `-${t}`), ...added.map((t) => `+${t}`)].join(" ") || "reordered"}`);
  }

  function compareClassArgs(a, b) {
    const argsA = a.arguments;
    const argsB = b.arguments;
    if (argsA.length === argsB.length) {
      argsA.forEach((x, k) => compareNode(x, argsB[k], { cls: true }));
      return;
    }
    const last = argsB[argsB.length - 1];
    if (argsB.length === argsA.length + 1 && last && ts.isIdentifier(last) && last.text === "className") {
      hunk("H-PROPS", a, last, "className passthrough added");
      argsA.forEach((x, k) => compareNode(x, argsB[k], { cls: true }));
      return;
    }
    hunk("REF-HUNK-CLASS", a, b, `${a.expression.getText(A)}() arguments added or removed`);
  }

  function compareNode(a0, b0, ctx) {
    const a = unwrap(a0);
    const b = unwrap(b0);
    if (!a || !b) {
      if (a || b) hunk(ctx.cls ? "REF-HUNK-CLASS" : "REF-HUNK-LOGIC", a, b, "node added or removed");
      return;
    }
    if (isJsx(a) && isJsx(b)) return compareJsx(a, b, ctx);
    if (a.kind !== b.kind) {
      if (ctx.cls) return hunk("REF-HUNK-CLASS", a, b, "class expression changed");
      if (isLiteral(a) && isLiteral(b)) return hunk("REF-HUNK-TEXT", a, b, "literal replaced by another literal");
      if (ctx.data && isStringish(a) && !isLiteral(b) && !isJsx(b)) return hunk("H-DATA", a, b, "literal replaced by a prop or copy expression");
      if (isJsx(a) || isJsx(b)) return hunk("REF-HUNK-STRUCTURE", a, b, "JSX element replaced");
      return hunk("REF-HUNK-LOGIC", a, b, "expression changed");
    }
    if (isStringish(a)) {
      if (a.text === b.text) return;
      if (ctx.cls) return compareClassString(a, b, ctx);
      return hunk("REF-HUNK-TEXT", a, b, `literal ${JSON.stringify(a.text)} -> ${JSON.stringify(b.text)}`);
    }
    if (ts.isNumericLiteral(a) || ts.isBigIntLiteral(a) || ts.isRegularExpressionLiteral(a)) {
      if (a.text !== b.text) hunk("REF-HUNK-TEXT", a, b, `literal ${a.getText(A)} -> ${b.getText(B)}`);
      return;
    }
    if (ts.isIdentifier(a) || ts.isPrivateIdentifier(a)) {
      if (a.text !== b.text) hunk(ctx.cls ? "REF-HUNK-CLASS" : "REF-HUNK-LOGIC", a, b, `identifier ${a.text} -> ${b.text}`);
      return;
    }
    if (ts.isTemplateExpression(a) && ctx.cls) {
      if (a.templateSpans.length !== b.templateSpans.length) return hunk("REF-HUNK-CLASS", a, b, "class template changed");
      if (a.head.text !== b.head.text) compareClassString(a.head, b.head, ctx);
      a.templateSpans.forEach((s, k) => {
        compareNode(s.expression, b.templateSpans[k].expression, ctx);
        if (s.literal.text !== b.templateSpans[k].literal.text) compareClassString(s.literal, b.templateSpans[k].literal, ctx);
      });
      return;
    }
    if (ts.isCallExpression(a) && ts.isIdentifier(a.expression) && CLASS_CALLS.has(a.expression.text)) {
      if (!same(a.expression, b.expression)) return hunk("REF-HUNK-CLASS", a.expression, b.expression, "class helper changed");
      return compareClassArgs(a, b);
    }
    if (ts.isFunctionLike(a) && (ts.isArrowFunction(a) || ts.isFunctionExpression(a))) {
      const sig = (sf, f) => f.parameters.map((p) => text(sf, p)).join(",");
      if (sig(A, a) !== sig(B, b)) hunk("REF-HUNK-LOGIC", a, b, "handler signature changed");
      const ba = a.body;
      const bb = b.body;
      if (ts.isBlock(ba) && ts.isBlock(bb)) return compareStatements(ba.statements, bb.statements, ba, bb);
      return compareNode(ba, bb, ctx);
    }
    if (ts.isBlock(a)) return compareStatements(a.statements, b.statements, a, b);
    const ca = children(a);
    const cb = children(b);
    if (ca.length === 0 && cb.length === 0) {
      if (a.getText(A) !== b.getText(B)) hunk(ctx.cls ? "REF-HUNK-CLASS" : "REF-HUNK-LOGIC", a, b, "token changed");
      return;
    }
    if (ca.length !== cb.length) return hunk(ctx.cls ? "REF-HUNK-CLASS" : "REF-HUNK-LOGIC", a, b, `${ts.SyntaxKind[a.kind]} changed`);
    // Object literal property values inside a class context stay class context;
    // inside a data context (attribute values) they are data.
    ca.forEach((x, k) => compareNode(x, cb[k], ctx));
  }

  // ---- JSX ---------------------------------------------------------------
  const tagOf = (sf, n) => (ts.isJsxFragment(n) ? "<>" : (ts.isJsxElement(n) ? n.openingElement : n).tagName.getText(sf));
  const attrsOf = (n) => (ts.isJsxFragment(n) ? [] : (ts.isJsxElement(n) ? n.openingElement : n).attributes.properties);
  const kidsOf = (n) => (ts.isJsxSelfClosingElement(n) ? [] : n.children);
  const attrName = (sf, p) => (ts.isJsxSpreadAttribute(p) ? `...${p.expression.getText(sf)}` : p.name.getText(sf));
  const isClassAttr = (name) => name === "className" || name === "classNames";

  function compareJsx(a, b, ctx) {
    const ta = tagOf(A, a);
    const tb = tagOf(B, b);
    if (ta !== tb) {
      if (nextLinkNames.has(ta) && linkTargets.has(tb)) hunk("H-LINK", a, b, `${ta} -> ${tb}`);
      else {
        const kids = kidsOf(b).filter((k) => isJsx(k));
        const wrapped = kids.length === 1 && tagOf(B, kids[0]) === ta;
        return hunk("REF-HUNK-STRUCTURE", a, b, wrapped ? `<${ta}> wrapped in <${tb}>` : `<${ta}> replaced by <${tb}>`);
      }
    }
    compareAttrs(a, b, ctx);
    compareChildren(a, b);
  }

  function compareAttrs(a, b, ctx) {
    const ma = new Map(attrsOf(a).map((p) => [attrName(A, p), p]));
    const mb = new Map(attrsOf(b).map((p) => [attrName(B, p), p]));
    for (const name of new Set([...ma.keys(), ...mb.keys()])) {
      const x = ma.get(name);
      const y = mb.get(name);
      if (x && y) {
        if (ts.isJsxSpreadAttribute(x)) continue;
        compareAttrValue(name, x, y);
        continue;
      }
      if (y && !x) {
        if (name === "key" && ctx.mapTemplate) continue;
        if (NON_VISUAL.test(name)) hunk("H-PROPS", a, y, `non-visual attribute ${name} added`);
        else if (name.startsWith("...")) hunk("H-PROPS", a, y, `props spread ${name} added`);
        else if (isClassAttr(name) || name === "style") hunk("REF-HUNK-CLASS", a, y, `${name} added`);
        else if (/^on[A-Z]/.test(name)) hunk("REF-HUNK-LOGIC", a, y, `handler ${name} added`);
        else hunk("REF-HUNK-STRUCTURE", a, y, `attribute ${name} added`);
      } else if (x && !y) {
        if (isClassAttr(name) || name === "style") hunk("REF-HUNK-CLASS", x, b, `${name} removed`);
        else hunk("REF-HUNK-STRUCTURE", x, b, `attribute ${name} removed`);
      }
    }
  }

  function compareAttrValue(name, x, y) {
    const va = x.initializer;
    const vb = y.initializer;
    const exprOf = (v) => (v && ts.isJsxExpression(v) ? v.expression : v);
    const ea = unwrap(exprOf(va));
    const eb = unwrap(exprOf(vb));
    if (!ea || !eb) {
      if (ea || eb) hunk("REF-HUNK-STRUCTURE", x, y, `attribute ${name} value changed`);
      return;
    }
    if (isClassAttr(name)) {
      if (isStringish(ea) && ts.isCallExpression(eb) && ts.isIdentifier(eb.expression) && eb.expression.text === "cn") {
        const args = eb.arguments;
        const last = args[args.length - 1];
        if (args.length === 2 && ts.isIdentifier(last) && last.text === "className") {
          hunk("H-PROPS", x, y, "className passthrough added");
          return compareNode(ea, args[0], { cls: true });
        }
      }
      return compareNode(ea, eb, { cls: true });
    }
    if (isStringish(ea) && isStringish(eb)) {
      if (ea.text !== eb.text) hunk("REF-HUNK-TEXT", x, y, `${name}=${JSON.stringify(ea.text)} -> ${JSON.stringify(eb.text)}`);
      return;
    }
    if (isLiteral(ea) && !isLiteral(eb) && !isJsx(eb)) return hunk("H-DATA", x, y, `${name} literal replaced by a prop or copy expression`);
    compareNode(ea, eb, { data: true });
  }

  /** React's JSX text semantics: lines trimmed, blank lines dropped, joined by a space. */
  function jsxText(raw) {
    const lines = raw.split(/\r\n|\n|\r/);
    const parts = [];
    lines.forEach((line, k) => {
      let l = line;
      if (k > 0) l = l.replace(/^[ \t]+/, "");
      if (k < lines.length - 1) l = l.replace(/[ \t]+$/, "");
      if (l) parts.push(l);
    });
    return parts.join(" ");
  }

  function semanticKids(sf, list) {
    const out = [];
    const pushText = (value, node) => {
      const last = out[out.length - 1];
      if (last && last.kind === "text") {
        last.value += value;
        return;
      }
      out.push({ kind: "text", value, node });
    };
    for (const k of list) {
      if (ts.isJsxText(k)) {
        const v = jsxText(k.text);
        if (v) pushText(v, k);
      } else if (ts.isJsxExpression(k)) {
        if (!k.expression) continue;
        const e = unwrap(k.expression);
        if (isStringish(e)) pushText(e.text, k);
        else out.push({ kind: "expr", node: k, expr: e });
      } else out.push({ kind: "jsx", node: k });
    }
    for (const item of out) if (item.kind === "text") item.value = item.value.replace(/\s+/g, " ").trim();
    return out.filter((item) => item.kind !== "text" || item.value !== "");
  }

  function mapTemplate(item) {
    if (item.kind !== "expr") return undefined;
    const e = item.expr;
    if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || e.expression.name.text !== "map") return undefined;
    const cb = unwrap(e.arguments[0]);
    if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) return undefined;
    if (ts.isBlock(cb.body)) {
      const stmts = cb.body.statements;
      const ret = stmts[stmts.length - 1];
      if (stmts.length !== 1 || !ts.isReturnStatement(ret) || !isJsx(unwrap(ret.expression))) return undefined;
      return unwrap(ret.expression);
    }
    const body = unwrap(cb.body);
    return isJsx(body) ? body : undefined;
  }

  function compareChildren(a, b) {
    const ka = semanticKids(A, kidsOf(a));
    const kb = semanticKids(B, kidsOf(b));
    let i = 0;
    let j = 0;
    const tagKey = (sf, item) => (item.kind === "jsx" ? tagOf(sf, item.node) : item.kind);
    while (i < ka.length && j < kb.length) {
      const x = ka[i];
      const y = kb[j];
      const template = mapTemplate(y);
      if (template && x.kind === "jsx" && tagOf(A, x.node) === tagOf(B, template)) {
        let run = 1;
        while (i + run < ka.length && ka[i + run].kind === "jsx" && tagOf(A, ka[i + run].node) === tagOf(A, x.node)) run++;
        hunk("H-DATA", x.node, y.node, `${run} sibling <${tagOf(A, x.node)}> collapsed into one .map()`);
        compareJsx(x.node, template, { mapTemplate: true });
        i += run;
        j++;
        continue;
      }
      if (tagKey(A, x) !== tagKey(B, y)) {
        // Resync on one inserted or removed child.
        if (j + 1 < kb.length && tagKey(A, x) === tagKey(B, kb[j + 1]) && !(i + 1 < ka.length && tagKey(A, ka[i + 1]) === tagKey(B, y))) {
          hunk(y.kind === "text" ? "REF-HUNK-TEXT" : "REF-HUNK-STRUCTURE", a, y.node, `child ${y.kind === "jsx" ? `<${tagKey(B, y)}>` : y.kind} added`);
          j++;
          continue;
        }
        if (i + 1 < ka.length && tagKey(A, ka[i + 1]) === tagKey(B, y)) {
          hunk(x.kind === "text" ? "REF-HUNK-TEXT" : "REF-HUNK-STRUCTURE", x.node, b, `child ${x.kind === "jsx" ? `<${tagKey(A, x)}>` : x.kind} removed`);
          i++;
          continue;
        }
      }
      compareChild(x, y);
      i++;
      j++;
    }
    for (; i < ka.length; i++) hunk(ka[i].kind === "text" ? "REF-HUNK-TEXT" : "REF-HUNK-STRUCTURE", ka[i].node, b, "child removed");
    for (; j < kb.length; j++) hunk(kb[j].kind === "text" ? "REF-HUNK-TEXT" : "REF-HUNK-STRUCTURE", a, kb[j].node, "child added");
  }

  function compareChild(x, y) {
    if (x.kind === "text" && y.kind === "text") {
      if (x.value !== y.value) hunk("REF-HUNK-TEXT", x.node, y.node, `text ${JSON.stringify(x.value)} -> ${JSON.stringify(y.value)}`);
      return;
    }
    if (x.kind === "text" && y.kind === "expr") return hunk("H-DATA", x.node, y.node, "text replaced by a prop or copy expression");
    if (x.kind === "jsx" && y.kind === "jsx") return compareJsx(x.node, y.node, {});
    if (x.kind === "expr" && y.kind === "expr") return compareNode(x.expr, y.expr, { data: true });
    if (x.kind === "expr" && y.kind === "text") return hunk("REF-HUNK-TEXT", x.node, y.node, "expression replaced by literal text");
    return hunk("REF-HUNK-STRUCTURE", x.node, y.node, `${x.kind} child replaced by ${y.kind}`);
  }

  for (const [a, b] of pairs) {
    if (modifiersText(A, a.st) !== modifiersText(B, b.st)) hunk("H-PROPS", a.st, b.st, "export modifiers changed");
    compareTop(a.st, b.st);
  }
  hunks.sort((x, y) => (x.file?.start.line ?? 0) - (y.file?.start.line ?? 0) || (x.ref?.start.line ?? 0) - (y.ref?.start.line ?? 0));
  return { hunks };
}
