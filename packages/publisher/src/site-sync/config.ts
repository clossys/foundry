import ts from "typescript";
import type { SecurityTxtOptions } from "../content-map/security.js";
import type { SiteSyncHost, SiteSyncOptions, SiteSyncPort } from "./contract.js";

type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal };
function invalid(): never { throw new TypeError("Site sync config must use literal data and an optional defineConfig import"); }
function object(value: Literal | undefined): { [key: string]: Literal } {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return invalid();
}
function string(value: Literal | undefined): string {
  if (typeof value === "string" && value.length) return value;
  return invalid();
}
function keys(value: { [key: string]: Literal }, expected: readonly string[]): void {
  if (Object.keys(value).some(key => !expected.includes(key))) invalid();
}
function literal(node: ts.Expression): Literal {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) { const value = Number(node.text); return Number.isFinite(value) ? value : invalid(); }
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operator)) {
    const value = Number(node.operand.text) * (node.operator === ts.SyntaxKind.MinusToken ? -1 : 1);
    return Number.isFinite(value) ? value : invalid();
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(element => ts.isExpression(element) ? literal(element) : invalid());
  if (ts.isObjectLiteralExpression(node)) {
    const entries: [string, Literal][] = [], seen = new Set<string>();
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) invalid();
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name) ? property.name.text : invalid();
      if (seen.has(name) || name === "__proto__") invalid();
      seen.add(name); entries.push([name, literal(property.initializer)]);
    }
    return Object.fromEntries(entries);
  }
  return invalid();
}
function port(value: Literal | undefined): SiteSyncPort {
  const data = object(value); keys(data, ["file", "export", "props"]);
  const file = string(data.file), name = string(data.export);
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || name === "default") invalid();
  return { file, export: name, ...(data.props === undefined ? {} : { props: object(data.props) }) };
}
function host(value: Literal | undefined): SiteSyncHost {
  const data = object(value); keys(data, ["locale", "frame", "consent", "notFound", "security", "formSubmit"]);
  const security = object(data.security); keys(security, ["contact", "expires", "policy", "preferredLanguages"]);
  const list = (value: Literal | undefined): string[] => Array.isArray(value) && value.every(item => typeof item === "string") ? value : invalid();
  const contact = typeof security.contact === "string" ? security.contact : list(security.contact);
  const options: SecurityTxtOptions = { contact, expires: string(security.expires),
    ...(security.policy === undefined ? {} : { policy: string(security.policy) }),
    ...(security.preferredLanguages === undefined ? {} : { preferredLanguages: list(security.preferredLanguages) }) };
  const locale = string(data.locale);
  if (Intl.getCanonicalLocales(locale).length !== 1) invalid();
  return { locale, frame: port(data.frame), consent: port(data.consent), notFound: port(data.notFound), security: options,
    ...(data.formSubmit === undefined ? {} : { formSubmit: string(data.formSubmit) }) };
}

/** Read the config syntax as data. Imports, helpers and expressions are never executed. */
export function parseSiteSyncConfig(source: string): Pick<SiteSyncOptions, "target" | "host"> {
  const parsed = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
  if (parsed.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) invalid();
  const file = ts.createSourceFile("clossys.config.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const helperNames = new Set<string>();
  let targetData: Literal | undefined, hostData: Literal | undefined;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!ts.isStringLiteral(statement.moduleSpecifier) || !/^@[^/]+\/producer\/config$/.test(statement.moduleSpecifier.text)
        || !bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== 1) invalid();
      const binding = bindings.elements[0]!;
      if ((binding.propertyName?.text ?? binding.name.text) !== "defineConfig" || binding.isTypeOnly) invalid();
      helperNames.add(binding.name.text); continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)) continue;
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && targetData === undefined) {
      const expression = statement.expression;
      if (ts.isCallExpression(expression)) {
        if (!ts.isIdentifier(expression.expression) || !helperNames.has(expression.expression.text) || expression.arguments.length !== 1) invalid();
        targetData = literal(expression.arguments[0]!);
      } else targetData = literal(expression);
      continue;
    }
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const
      && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
      && statement.declarationList.declarations.length === 1 && hostData === undefined) {
      const declaration = statement.declarationList.declarations[0]!;
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "siteSyncHost" || !declaration.initializer) invalid();
      hostData = literal(declaration.initializer); continue;
    }
    invalid();
  }
  const config = object(targetData); keys(config, ["targets"]);
  const targets = Object.values(object(config.targets)).map(value => {
    const data = object(value); keys(data, ["app", "format", "publication"]);
    return { app: string(data.app), format: string(data.format), publication: string(data.publication) };
  }).filter(target => target.format === "web.page.responsive" && target.app.startsWith("apps/"));
  if (targets.length !== 1) throw new TypeError("Site sync requires exactly one application web target");
  const selected = targets[0]!;
  if (selected.app.split("/").some(part => !part || part === "." || part === "..") || /[\\\u0000-\u001f]/.test(selected.app)) invalid();
  return { target: { app: selected.app, format: "web.page.responsive", publication: selected.publication }, host: host(hostData) };
}
