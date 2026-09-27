import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Package lint for shipped copy in `src/web` (issue #1521).
 *
 * A JSX text node fails when its text contains a letter. A string or
 * template literal used as a JSX child is the same kind of text. An aria
 * attribute set to a string literal fails when the attribute is an
 * accessible name, or when the literal is not an ARIA state token.
 * A message JSX attribute, a `??` fallback in JSX, a local initializer, a
 * lettered parameter default that is rendered, a lettered `createElement`
 * argument, or a function default whose body returns lettered text fails
 * the same way when the prop has no `@default`. A module binding or module
 * function referenced by that default fails under the same rule. A message
 * prop does not fail: the English is the parameter default documented with
 * `@default`, and the JSX, aria, or `createElement` site reads that prop.
 *
 * `*.test.*`, `*.spec.*`, and `*.check.*` are excluded. The `.check` files
 * in this tree are compile-time contract fixtures, not shipped components.
 */

const NAMING_ARIA = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "aria-errormessage",
  "aria-braillelabel",
  "aria-brailleroledescription",
]);

const ARIA_STATE_TOKENS = new Set([
  "true",
  "false",
  "mixed",
  "undefined",
  "polite",
  "assertive",
  "off",
  "page",
  "step",
  "location",
  "date",
  "time",
  "none",
  "inline",
  "list",
  "both",
  "add",
  "remove",
  "text",
  "all",
  "additions",
  "removals",
  "ascending",
  "descending",
  "other",
  "horizontal",
  "vertical",
  "grammar",
  "spelling",
  "dialog",
  "grid",
  "menu",
  "listbox",
  "tree",
]);

const MESSAGE_JSX_ATTRS = new Set(["label", "description", "title", "placeholder", "alt", "summary"]);

const NON_COPY_JSX_ATTRS = new Set([
  "className",
  "style",
  "key",
  "id",
  "type",
  "name",
  "htmlFor",
  "href",
  "src",
  "rel",
  "target",
  "method",
  "role",
  "variant",
  "size",
  "ground",
  "composition",
  "orientation",
  "slot",
  "as",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeLinecap",
  "strokeLinejoin",
  "tabIndex",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "viewBox",
  "xmlns",
  "preserveAspectRatio",
  "transform",
  "opacity",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "textAnchor",
  "dominantBaseline",
  "autoComplete",
  "inputMode",
  "pattern",
  "encType",
  "charSet",
  "httpEquiv",
  "decoding",
  "loading",
  "fetchPriority",
  "crossOrigin",
  "referrerPolicy",
  "colSpan",
  "rowSpan",
  "scope",
  "wrap",
  "cols",
  "rows",
  "max",
  "min",
  "step",
  "media",
  "suppressHydrationWarning",
  "exportparts",
  "part",
  "hidden",
  "inert",
  "nonce",
  "spellCheck",
  "translate",
  "content",
  "contextMenu",
  "draggable",
  "lang",
  "dir",
  "radioGroup",
  "accessKey",
  "autoFocus",
  "contentEditable",
  "enterKeyHint",
  "is",
  "itemID",
  "itemProp",
  "itemRef",
  "itemScope",
  "itemType",
  "results",
  "security",
  "unselectable",
]);

interface ShippedMessageViolation {
  file: string;
  line: number;
  kind: "jsx-text" | "aria-literal" | "jsx-attribute" | "nullish-fallback" | "rendered-local";
  text: string;
}

function hasLetter(value: string): boolean {
  return /\p{L}/u.test(value);
}

function staticLiteral(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => span.literal.text).join("");
  }
  return null;
}

function templateExpressionIsShippedCopy(node: ts.TemplateExpression): boolean {
  if (hasLetter(node.head.text)) return true;
  return node.templateSpans.some((span) => /\s/.test(span.literal.text) && hasLetter(span.literal.text));
}

function returnExpressionIsDirectStringShippedCopy(expression: ts.Expression): boolean {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    const literal = staticLiteral(expression);
    return literal !== null && hasLetter(literal);
  }
  if (ts.isTemplateExpression(expression)) {
    return templateExpressionIsShippedCopy(expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      returnExpressionIsDirectStringShippedCopy(expression.whenTrue) ||
      returnExpressionIsDirectStringShippedCopy(expression.whenFalse)
    );
  }
  if (ts.isParenthesizedExpression(expression)) {
    return returnExpressionIsDirectStringShippedCopy(expression.expression);
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return (
      returnExpressionIsDirectStringShippedCopy(expression.left) ||
      returnExpressionIsDirectStringShippedCopy(expression.right)
    );
  }
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return (
        returnExpressionIsDirectStringShippedCopy(expression.left) ||
        returnExpressionIsDirectStringShippedCopy(expression.right)
      );
    }
  }
  return false;
}

function functionBodyReturnsShippedCopy(fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration): boolean {
  const body = fn.body;
  if (body === undefined) return false;
  if (ts.isBlock(body)) {
    let found = false;
    function scanStatement(statement: ts.Node): void {
      if (ts.isReturnStatement(statement) && statement.expression !== undefined && expressionIsShippedCopy(statement.expression)) {
        found = true;
      }
      ts.forEachChild(statement, scanStatement);
    }
    for (const statement of body.statements) scanStatement(statement);
    return found;
  }
  return expressionIsShippedCopy(body);
}

function functionBodyReturnsDirectStringShippedCopy(
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
): boolean {
  const body = fn.body;
  if (body === undefined) return false;
  if (ts.isBlock(body)) {
    let found = false;
    function scanStatement(statement: ts.Node): void {
      if (
        ts.isReturnStatement(statement) &&
        statement.expression !== undefined &&
        returnExpressionIsDirectStringShippedCopy(statement.expression)
      ) {
        found = true;
      }
      ts.forEachChild(statement, scanStatement);
    }
    for (const statement of body.statements) scanStatement(statement);
    return found;
  }
  return returnExpressionIsDirectStringShippedCopy(body);
}

function expressionIsShippedCopy(expression: ts.Expression): boolean {
  expression = unwrapExpression(expression);
  if (localInitializerIsShippedCopy(expression)) return true;
  if (ts.isConditionalExpression(expression)) {
    return expressionIsShippedCopy(expression.whenTrue) || expressionIsShippedCopy(expression.whenFalse);
  }
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return expressionIsShippedCopy(expression.left) || expressionIsShippedCopy(expression.right);
    }
  }
  return false;
}

function collectModuleLetteredBindings(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      if (localInitializerIsShippedCopy(declaration.initializer)) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

function collectModuleShippedFunctions(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && statement.body !== undefined) {
      if (functionBodyReturnsShippedCopy(statement)) {
        names.add(statement.name.text);
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      if (
        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) &&
        functionBodyReturnsShippedCopy(declaration.initializer)
      ) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

function collectModuleDirectStringShippedFunctions(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && statement.body !== undefined) {
      if (functionBodyReturnsDirectStringShippedCopy(statement)) {
        names.add(statement.name.text);
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      if (
        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) &&
        functionBodyReturnsDirectStringShippedCopy(declaration.initializer)
      ) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

function parameterDefaultIsShippedCopy(
  initializer: ts.Expression,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
): boolean {
  const literal = staticLiteral(initializer);
  if (literal !== null && ARIA_STATE_TOKENS.has(literal)) return false;
  if (localInitializerIsShippedCopy(initializer)) return true;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return functionBodyReturnsShippedCopy(initializer);
  }
  return ts.isIdentifier(initializer) && (moduleBindings.has(initializer.text) || moduleFunctions.has(initializer.text));
}

function bindingElementPropertyName(element: ts.BindingElement, source: ts.SourceFile): string | null {
  if (element.propertyName !== undefined) return element.propertyName.getText(source);
  if (ts.isIdentifier(element.name)) return element.name.text;
  return null;
}

function bindingElementLocalName(element: ts.BindingElement): string | null {
  if (ts.isIdentifier(element.name)) return element.name.text;
  return null;
}

function collectDocumentedDefaultProps(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node)) {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || member.name === undefined) continue;
        const propName = member.name.getText(sourceFile);
        for (const tag of ts.getJSDocTags(member)) {
          if (tag.tagName.text === "default") names.add(propName);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function collectUndocumentedMessageInterfaceProps(
  sourceFile: ts.SourceFile,
  documentedDefaults: Set<string>,
): Set<string> {
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node)) {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || member.name === undefined) continue;
        const propName = member.name.getText(sourceFile);
        if (MESSAGE_JSX_ATTRS.has(propName) && !documentedDefaults.has(propName)) {
          names.add(propName);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function localInitializerIsShippedCopy(node: ts.Expression): boolean {
  node = unwrapExpression(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const literal = staticLiteral(node);
    return literal !== null && hasLetter(literal);
  }
  if (ts.isTemplateExpression(node)) {
    return templateExpressionIsShippedCopy(node);
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return functionBodyReturnsShippedCopy(node);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return localInitializerIsShippedCopy(node.left) || localInitializerIsShippedCopy(node.right);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some((element) => ts.isExpression(element) && localInitializerIsShippedCopy(element));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) return localInitializerIsShippedCopy(property.initializer);
      return false;
    });
  }
  if (ts.isConditionalExpression(node)) {
    return localInitializerIsShippedCopy(node.whenTrue) || localInitializerIsShippedCopy(node.whenFalse);
  }
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return localInitializerIsShippedCopy(node.left) || localInitializerIsShippedCopy(node.right);
    }
  }
  return false;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    break;
  }
  return current;
}

function collectChildLiterals(expression: ts.Expression | undefined, out: string[]): void {
  if (expression === undefined) return;
  expression = unwrapExpression(expression);
  const literal = staticLiteral(expression);
  if (literal !== null) {
    out.push(literal);
    return;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        collectChildLiterals(element.expression, out);
      } else if (ts.isExpression(element)) {
        collectChildLiterals(element, out);
      }
    }
    return;
  }
  if (ts.isSpreadElement(expression)) {
    collectChildLiterals(expression.expression, out);
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    collectChildLiterals(expression.whenTrue, out);
    collectChildLiterals(expression.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    collectChildLiterals(expression.left, out);
    collectChildLiterals(expression.right, out);
    return;
  }
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    collectChildLiterals(expression.left, out);
    collectChildLiterals(expression.right, out);
  }
}

function attributeLiteral(initializer: ts.JsxAttribute["initializer"]): string | null {
  if (initializer === undefined) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression !== undefined) return staticLiteral(initializer.expression);
  return null;
}

function jsxAttributeName(node: ts.JsxAttribute): string {
  return node.name.getText();
}

function isStylingJsxAttribute(name: string): boolean {
  return name === "className" || name === "style" || name.startsWith("data-");
}

function isDisplayNameAssignment(node: ts.Node): boolean {
  return (
    ts.isPropertyAssignment(node) &&
    ((ts.isIdentifier(node.name) && node.name.text === "displayName") ||
      (ts.isStringLiteral(node.name) && node.name.text === "displayName"))
  );
}

function isExcludedFile(fileName: string): boolean {
  return /\.(?:test|spec|check)\.[cm]?[jt]sx?$/.test(fileName);
}

function objectLiteralPropertyInitializer(
  object: ts.ObjectLiteralExpression,
  propName: string,
  source: ts.SourceFile,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const nameText = property.name.getText(source);
    if (nameText === propName) return property.initializer;
  }
  return undefined;
}

function collectParameterLiteralDefaults(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  source: ts.SourceFile,
  documentedDefaults: Set<string>,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
): Map<string, number> {
  const literalParams = new Map<string, number>();

  function noteBindingDefault(
    propName: string,
    localName: string,
    initializer: ts.Expression,
    line: number,
  ): void {
    if (documentedDefaults.has(propName)) return;
    if (!parameterDefaultIsShippedCopy(initializer, moduleBindings, moduleFunctions)) return;
    literalParams.set(localName, line);
  }

  function walkBindingPattern(pattern: ts.ObjectBindingPattern, line: number, defaultExpr?: ts.Expression): void {
    const defaultObject =
      defaultExpr !== undefined && ts.isObjectLiteralExpression(unwrapExpression(defaultExpr))
        ? (unwrapExpression(defaultExpr) as ts.ObjectLiteralExpression)
        : undefined;

    for (const element of pattern.elements) {
      if (ts.isObjectBindingPattern(element.name)) {
        const nestedDefault =
          element.initializer ??
          (defaultObject !== undefined && element.propertyName !== undefined
            ? objectLiteralPropertyInitializer(defaultObject, element.propertyName.getText(source), source)
            : undefined);
        if (nestedDefault !== undefined) {
          walkBindingPattern(element.name, line, nestedDefault);
        } else {
          walkBindingPattern(element.name, line);
        }
        continue;
      }
      if (ts.isArrayBindingPattern(element.name)) {
        walkArrayBindingPattern(element.name, line, defaultObject, element);
        continue;
      }
      const propName = bindingElementPropertyName(element, source);
      const localName = bindingElementLocalName(element);
      if (propName === null || localName === null) continue;
      const initializer =
        element.initializer ??
        (defaultObject !== undefined ? objectLiteralPropertyInitializer(defaultObject, propName, source) : undefined);
      if (initializer === undefined) continue;
      noteBindingDefault(propName, localName, initializer, line);
    }
  }

  function walkArrayBindingPattern(
    pattern: ts.ArrayBindingPattern,
    line: number,
    defaultObject?: ts.ObjectLiteralExpression,
    parentElement?: ts.BindingElement,
  ): void {
    for (const element of pattern.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (ts.isObjectBindingPattern(element.name)) {
        walkBindingPattern(element.name, line);
        continue;
      }
      if (ts.isArrayBindingPattern(element.name)) {
        walkArrayBindingPattern(element.name, line);
        continue;
      }
      const propName = bindingElementPropertyName(element, source);
      const localName = bindingElementLocalName(element);
      if (localName === null) continue;
      const resolvedPropName = propName ?? localName;
      let initializer = element.initializer;
      if (
        initializer === undefined &&
        defaultObject !== undefined &&
        parentElement !== undefined &&
        parentElement.propertyName !== undefined
      ) {
        const container = objectLiteralPropertyInitializer(
          defaultObject,
          parentElement.propertyName.getText(source),
          source,
        );
        if (container !== undefined && ts.isArrayLiteralExpression(unwrapExpression(container))) {
          const arrayLiteral = unwrapExpression(container) as ts.ArrayLiteralExpression;
          const index = pattern.elements.indexOf(element);
          const entry = arrayLiteral.elements[index];
          if (entry !== undefined && ts.isExpression(entry)) {
            initializer = entry;
          }
        }
      }
      if (initializer === undefined || !MESSAGE_JSX_ATTRS.has(resolvedPropName)) continue;
      noteBindingDefault(resolvedPropName, localName, initializer, line);
    }
  }

  for (const parameter of parameters) {
    const line = source.getLineAndCharacterOfPosition(parameter.getStart(source)).line + 1;
    if (ts.isObjectBindingPattern(parameter.name)) {
      walkBindingPattern(parameter.name, line);
      continue;
    }
    if (ts.isArrayBindingPattern(parameter.name)) {
      walkArrayBindingPattern(parameter.name, line);
      continue;
    }
    if (
      ts.isIdentifier(parameter.name) &&
      parameter.initializer !== undefined &&
      MESSAGE_JSX_ATTRS.has(parameter.name.text)
    ) {
      noteBindingDefault(parameter.name.text, parameter.name.text, parameter.initializer, line);
    }
  }

  return literalParams;
}

function collectUndocumentedShippedPropNames(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  source: ts.SourceFile,
  documentedDefaults: Set<string>,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
): Set<string> {
  const names = new Set<string>();

  function noteShippedProp(propName: string, initializer: ts.Expression): void {
    if (documentedDefaults.has(propName)) return;
    if (parameterDefaultIsShippedCopy(initializer, moduleBindings, moduleFunctions)) {
      names.add(propName);
    }
  }

  function walkBindingPattern(pattern: ts.ObjectBindingPattern, defaultExpr?: ts.Expression): void {
    const defaultObject =
      defaultExpr !== undefined && ts.isObjectLiteralExpression(unwrapExpression(defaultExpr))
        ? (unwrapExpression(defaultExpr) as ts.ObjectLiteralExpression)
        : undefined;

    for (const element of pattern.elements) {
      if (ts.isObjectBindingPattern(element.name)) {
        const nestedDefault =
          element.initializer ??
          (defaultObject !== undefined && element.propertyName !== undefined
            ? objectLiteralPropertyInitializer(defaultObject, element.propertyName.getText(source), source)
            : undefined);
        if (nestedDefault !== undefined) {
          walkBindingPattern(element.name, nestedDefault);
        } else {
          walkBindingPattern(element.name);
        }
        continue;
      }
      if (ts.isArrayBindingPattern(element.name)) {
        walkArrayBindingPattern(element.name, defaultObject, element);
        continue;
      }
      const propName = bindingElementPropertyName(element, source);
      if (propName === null) continue;
      const initializer =
        element.initializer ??
        (defaultObject !== undefined ? objectLiteralPropertyInitializer(defaultObject, propName, source) : undefined);
      if (initializer === undefined) continue;
      noteShippedProp(propName, initializer);
    }
  }

  function walkArrayBindingPattern(
    pattern: ts.ArrayBindingPattern,
    defaultObject?: ts.ObjectLiteralExpression,
    parentElement?: ts.BindingElement,
  ): void {
    for (const element of pattern.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (ts.isObjectBindingPattern(element.name)) {
        walkBindingPattern(element.name);
        continue;
      }
      if (ts.isArrayBindingPattern(element.name)) {
        walkArrayBindingPattern(element.name);
        continue;
      }
      const propName = bindingElementPropertyName(element, source);
      const localName = bindingElementLocalName(element);
      if (localName === null) continue;
      const resolvedPropName = propName ?? localName;
      let initializer = element.initializer;
      if (
        initializer === undefined &&
        defaultObject !== undefined &&
        parentElement !== undefined &&
        parentElement.propertyName !== undefined
      ) {
        const container = objectLiteralPropertyInitializer(
          defaultObject,
          parentElement.propertyName.getText(source),
          source,
        );
        if (container !== undefined && ts.isArrayLiteralExpression(unwrapExpression(container))) {
          const arrayLiteral = unwrapExpression(container) as ts.ArrayLiteralExpression;
          const index = pattern.elements.indexOf(element);
          const entry = arrayLiteral.elements[index];
          if (entry !== undefined && ts.isExpression(entry)) {
            initializer = entry;
          }
        }
      }
      if (initializer === undefined || !MESSAGE_JSX_ATTRS.has(resolvedPropName)) continue;
      noteShippedProp(resolvedPropName, initializer);
    }
  }

  for (const parameter of parameters) {
    if (ts.isObjectBindingPattern(parameter.name)) {
      walkBindingPattern(parameter.name);
      continue;
    }
    if (ts.isArrayBindingPattern(parameter.name)) {
      walkArrayBindingPattern(parameter.name);
      continue;
    }
    if (
      ts.isIdentifier(parameter.name) &&
      parameter.initializer !== undefined &&
      MESSAGE_JSX_ATTRS.has(parameter.name.text)
    ) {
      noteShippedProp(parameter.name.text, parameter.initializer);
    }
  }
  return names;
}

function collectFileUndocumentedShippedPropNames(
  sourceFile: ts.SourceFile,
  documentedDefaults: Set<string>,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
): Set<string> {
  const names = new Set<string>();
  function visitFunctionLike(node: ts.FunctionLikeDeclaration): void {
    for (const propName of collectUndocumentedShippedPropNames(
      node.parameters,
      sourceFile,
      documentedDefaults,
      moduleBindings,
      moduleFunctions,
    )) {
      names.add(propName);
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)
    ) {
      visitFunctionLike(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function analyzeRenderedLocals(
  body: ts.ConciseBody,
  documentedDefaults: Set<string>,
  undocumentedPropNames: Set<string>,
  fileUndocumentedPropNames: Set<string>,
  literalLocals: Map<string, number>,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  source: ts.SourceFile,
): Map<string, number> {
  const indirectMessageProps = new Map<string, number>();
  const setterToState = new Map<string, string>();

  function lineOf(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  function callCarriesShippedMessage(call: ts.CallExpression): boolean {
    if (!ts.isIdentifier(call.expression)) return false;
    return literalLocals.has(call.expression.text) || moduleDirectStringFunctions.has(call.expression.text);
  }

  function memberIsUndocumentedShippedProp(memberName: string): boolean {
    return undocumentedPropNames.has(memberName) || fileUndocumentedPropNames.has(memberName);
  }

  function expressionCarriesShippedMessage(expression: ts.Expression): boolean {
    if (localInitializerIsShippedCopy(expression)) return true;
    if (ts.isPropertyAccessExpression(expression)) {
      return memberIsUndocumentedShippedProp(expression.name.text);
    }
    if (ts.isElementAccessExpression(expression)) {
      const argument = expression.argumentExpression;
      if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
        return memberIsUndocumentedShippedProp(argument.text);
      }
    }
    if (ts.isCallExpression(expression)) {
      if (callCarriesShippedMessage(expression)) return true;
      if (ts.isPropertyAccessExpression(expression.expression)) {
        return memberIsUndocumentedShippedProp(expression.expression.name.text);
      }
    }
    if (ts.isConditionalExpression(expression)) {
      return (
        expressionCarriesShippedMessage(expression.whenTrue) || expressionCarriesShippedMessage(expression.whenFalse)
      );
    }
    if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      return (
        expressionCarriesShippedMessage(expression.left) || expressionCarriesShippedMessage(expression.right)
      );
    }
    if (ts.isParenthesizedExpression(expression)) return expressionCarriesShippedMessage(expression.expression);
    if (ts.isNonNullExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
      return expressionCarriesShippedMessage(expression.expression);
    }
    return false;
  }

  function registerLocal(name: string, initializer: ts.Expression, line: number): void {
    if (documentedDefaults.has(name)) return;
    if (expressionCarriesShippedMessage(initializer)) {
      literalLocals.set(name, line);
    }
  }

  function registerAlias(name: string, fromName: string, line: number): void {
    if (literalLocals.has(fromName)) {
      literalLocals.set(name, line);
    }
  }

  function registerFromExpression(name: string, initializer: ts.Expression, line: number): void {
    registerLocal(name, initializer, line);
    if (ts.isIdentifier(initializer)) {
      registerAlias(name, initializer.text, line);
    }
  }

  function registerDestructuredProp(localName: string, propName: string | null, line: number): void {
    if (propName !== null && memberIsUndocumentedShippedProp(propName)) {
      literalLocals.set(localName, line);
    }
  }

  function noteIndirectCallArguments(call: ts.CallExpression): void {
    if (!ts.isIdentifier(call.expression)) return;
    const line = lineOf(call);
    for (const argument of call.arguments) {
      if (!ts.isIdentifier(argument) || documentedDefaults.has(argument.text)) continue;
      if (undocumentedPropNames.has(argument.text) || fileUndocumentedPropNames.has(argument.text)) {
        indirectMessageProps.set(argument.text, line);
      }
    }
  }

  function scanNode(node: ts.Node): void {
    if (isDisplayNameAssignment(node)) return;
    if (ts.isVariableStatement(node)) {
      const line = node.getStart();
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          registerFromExpression(declaration.name.text, declaration.initializer, line);
        }
        if (
          ts.isArrayBindingPattern(declaration.name) &&
          declaration.initializer !== undefined &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          declaration.initializer.expression.text === "useState"
        ) {
          const elements = declaration.name.elements;
          if (elements.length >= 2) {
            const stateName = bindingElementLocalName(elements[0]);
            const setterName = bindingElementLocalName(elements[1]);
            if (stateName !== null && setterName !== null) {
              setterToState.set(setterName, stateName);
            }
          }
        }
        if (ts.isObjectBindingPattern(declaration.name)) {
          for (const element of declaration.name.elements) {
            const localName = bindingElementLocalName(element);
            if (localName === null) continue;
            registerDestructuredProp(localName, bindingElementPropertyName(element, source), line);
          }
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      !ts.isPropertyAccessExpression(node.parent)
    ) {
      registerFromExpression(node.left.text, node.right, node.getStart());
    }
    if (ts.isCallExpression(node)) {
      noteIndirectCallArguments(node);
      if (ts.isIdentifier(node.expression)) {
        const stateVar = setterToState.get(node.expression.text);
        if (stateVar !== undefined && node.arguments.length > 0) {
          const argument = node.arguments[0];
          if (argument !== undefined && ts.isExpression(argument)) {
            registerFromExpression(stateVar, argument, lineOf(node));
          }
        }
      }
    }
    ts.forEachChild(node, scanNode);
  }

  if (ts.isBlock(body)) scanNode(body);
  return indirectMessageProps;
}

function isCreateElementCall(node: ts.CallExpression): boolean {
  const { expression } = node;
  if (ts.isIdentifier(expression) && expression.text === "createElement") return true;
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "createElement";
}

function isNonCopyCreateElementProperty(name: string): boolean {
  return name === "className" || name === "style" || name === "key" || name.startsWith("data-");
}

function isMessageCreateElementProperty(name: string): boolean {
  if (isNonCopyCreateElementProperty(name) || NON_COPY_JSX_ATTRS.has(name)) return false;
  if (name.startsWith("aria-")) return NAMING_ARIA.has(name);
  return MESSAGE_JSX_ATTRS.has(name);
}

function checkRenderedLocalReferences(
  body: ts.ConciseBody,
  literalLocals: Map<string, number>,
  undocumentedPropNames: Set<string>,
  interfaceMessageProps: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  fileName: string,
  source: ts.SourceFile,
  violations: ShippedMessageViolation[],
): void {
  function lineOf(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  function noteReference(name: string, node: ts.Node): void {
    const declarationLine = literalLocals.get(name);
    if (declarationLine === undefined) return;
    violations.push({
      file: fileName,
      line: lineOf(node),
      kind: "rendered-local",
      text: name,
    });
  }

  function noteModuleDirectStringCall(callee: ts.Identifier, node: ts.Node): void {
    if (!moduleDirectStringFunctions.has(callee.text)) return;
    violations.push({
      file: fileName,
      line: lineOf(node),
      kind: "rendered-local",
      text: callee.text,
    });
  }

  function notePropertyAccess(node: ts.PropertyAccessExpression, reportAt: ts.Node): void {
    const member = node.name.text;
    if (undocumentedPropNames.has(member)) {
      violations.push({ file: fileName, line: lineOf(reportAt), kind: "rendered-local", text: member });
      return;
    }
    if (ts.isIdentifier(node.expression) && node.expression.text === "props" && interfaceMessageProps.has(member)) {
      violations.push({ file: fileName, line: lineOf(reportAt), kind: "rendered-local", text: member });
      return;
    }
    if (ts.isIdentifier(node.expression)) {
      noteReference(node.expression.text, reportAt);
    }
  }

  function noteElementAccess(node: ts.ElementAccessExpression, reportAt: ts.Node): void {
    const argument = node.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      const member = argument.text;
      if (undocumentedPropNames.has(member)) {
        violations.push({ file: fileName, line: lineOf(reportAt), kind: "rendered-local", text: member });
        return;
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "props" && interfaceMessageProps.has(member)) {
        violations.push({ file: fileName, line: lineOf(reportAt), kind: "rendered-local", text: member });
        return;
      }
    }
    if (ts.isIdentifier(node.expression)) {
      noteReference(node.expression.text, reportAt);
    }
  }

  function expressionWithoutOptionalChain(expression: ts.Expression): ts.Expression {
    let current: ts.Expression = expression;
    while (ts.isOptionalChain(current)) {
      current = current.expression;
    }
    return current;
  }

  function noteRenderedMessageReference(expression: ts.Expression, node: ts.Node): void {
    expression = unwrapExpression(expression);
    if (ts.isConditionalExpression(expression)) {
      noteRenderedMessageReference(expression.whenTrue, node);
      noteRenderedMessageReference(expression.whenFalse, node);
      return;
    }
    if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      noteRenderedMessageReference(expression.left, node);
      noteRenderedMessageReference(expression.right, node);
      return;
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      noteRenderedMessageReference(expression.left, node);
      noteRenderedMessageReference(expression.right, node);
      return;
    }
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        notePropertyAccess(callee, node);
      } else if (ts.isIdentifier(callee)) {
        noteModuleDirectStringCall(callee, node);
        noteReference(callee.text, node);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      notePropertyAccess(expression, node);
      return;
    }
    if (ts.isElementAccessExpression(expression)) {
      noteElementAccess(expression, node);
      return;
    }
    const unwrapped = expressionWithoutOptionalChain(expression);
    if (ts.isIdentifier(unwrapped)) {
      noteReference(unwrapped.text, node);
      return;
    }
    if (ts.isPropertyAccessExpression(unwrapped)) {
      notePropertyAccess(unwrapped, node);
      return;
    }
    if (ts.isElementAccessExpression(unwrapped)) {
      noteElementAccess(unwrapped, node);
    }
  }

  function walkRenderedChildExpression(expression: ts.Expression, node: ts.Node, literalBranches = false): void {
    expression = unwrapExpression(expression);
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        if (ts.isSpreadElement(element)) {
          walkRenderedChildExpression(element.expression, node, literalBranches);
        } else if (ts.isExpression(element)) {
          walkRenderedChildExpression(element, node, literalBranches);
        }
      }
      return;
    }
    if (ts.isSpreadElement(expression)) {
      walkRenderedChildExpression(expression.expression, node, literalBranches);
      return;
    }
    noteRenderedMessageExpression(expression, node, literalBranches);
  }

  function walkMessagePropsInExpression(expression: ts.Expression, reportNode: ts.Node): void {
    expression = unwrapExpression(expression);
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isSpreadAssignment(property)) {
          walkMessagePropsInExpression(property.expression, reportNode);
          continue;
        }
        if (!ts.isPropertyAssignment(property)) continue;
        const propertyName = property.name.getText(source);
        if (!isMessageCreateElementProperty(propertyName)) continue;
        noteRenderedMessageExpression(property.initializer, property, true);
      }
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      walkMessagePropsInExpression(expression.whenTrue, reportNode);
      walkMessagePropsInExpression(expression.whenFalse, reportNode);
      return;
    }
    if (ts.isBinaryExpression(expression)) {
      const kind = expression.operatorToken.kind;
      if (
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        walkMessagePropsInExpression(expression.left, reportNode);
        walkMessagePropsInExpression(expression.right, reportNode);
      }
    }
  }

  function noteRenderedMessageExpression(
    expression: ts.Expression,
    node: ts.Node,
    literalBranches = false,
  ): void {
    expression = unwrapExpression(expression);
    if (literalBranches && ts.isObjectLiteralExpression(expression)) {
      walkMessagePropsInExpression(expression, node);
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      if (literalBranches) {
        noteRenderedMessageExpression(expression.whenTrue, node, literalBranches);
        noteRenderedMessageExpression(expression.whenFalse, node, literalBranches);
      } else {
        noteRenderedMessageReference(expression.whenTrue, node);
        noteRenderedMessageReference(expression.whenFalse, node);
      }
      return;
    }
    if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      if (literalBranches) {
        noteRenderedMessageExpression(expression.left, node, literalBranches);
        noteRenderedMessageExpression(expression.right, node, literalBranches);
      } else {
        noteRenderedMessageReference(expression.left, node);
        noteRenderedMessageReference(expression.right, node);
      }
      return;
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (literalBranches) {
        noteRenderedMessageExpression(expression.left, node, literalBranches);
        noteRenderedMessageExpression(expression.right, node, literalBranches);
      } else {
        noteRenderedMessageReference(expression.left, node);
        noteRenderedMessageReference(expression.right, node);
      }
      return;
    }
    const literal = staticLiteral(expression);
    if (literal !== null && hasLetter(literal)) {
      violations.push({ file: fileName, line: lineOf(node), kind: "jsx-text", text: literal });
      return;
    }
    if (ts.isTemplateExpression(expression)) {
      if (templateExpressionIsShippedCopy(expression)) {
        violations.push({ file: fileName, line: lineOf(node), kind: "jsx-text", text: expression.getText(source) });
        return;
      }
      for (const span of expression.templateSpans) {
        noteRenderedMessageExpression(span.expression, node, true);
      }
      return;
    }
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        notePropertyAccess(callee, node);
      } else if (ts.isIdentifier(callee)) {
        noteModuleDirectStringCall(callee, node);
        noteReference(callee.text, node);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      notePropertyAccess(expression, node);
      return;
    }
    if (ts.isElementAccessExpression(expression)) {
      noteElementAccess(expression, node);
      return;
    }
    const unwrapped = expressionWithoutOptionalChain(expression);
    if (ts.isIdentifier(unwrapped)) {
      noteReference(unwrapped.text, node);
      return;
    }
    if (ts.isPropertyAccessExpression(unwrapped)) {
      notePropertyAccess(unwrapped, node);
      return;
    }
    if (ts.isElementAccessExpression(unwrapped)) {
      noteElementAccess(unwrapped, node);
    }
  }

  function walkCreateElementChild(argument: ts.Expression, reportNode: ts.Node): void {
    walkRenderedChildExpression(argument, reportNode, true);
  }

  function isDirectRenderedExpression(node: ts.Node): boolean {
    const parent = node.parent;
    if (parent === undefined) return false;
    if (ts.isJsxExpression(parent) && parent.expression === node) return true;
    if (
      ts.isJsxAttribute(parent) &&
      parent.initializer !== undefined &&
      ts.isJsxExpression(parent.initializer) &&
      parent.initializer.expression === node
    ) {
      return true;
    }
    if (ts.isCallExpression(parent) && parent.expression === node) return true;
    if (ts.isPropertyAssignment(parent) && parent.initializer === node) return true;
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isCreateElementCall(node)) {
      for (let index = 1; index < node.arguments.length; index++) {
        const argument = node.arguments[index];
        if (ts.isSpreadElement(argument)) {
          walkCreateElementChild(argument.expression, node);
          continue;
        }
        if (ts.isObjectLiteralExpression(argument)) {
          for (const property of argument.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const propertyName = property.name.getText(source);
            if (!isMessageCreateElementProperty(propertyName)) continue;
            noteRenderedMessageExpression(property.initializer, property, true);
          }
        } else {
          walkCreateElementChild(argument, node);
        }
      }
    }
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const parent = node.parent;
      if (parent === undefined || !ts.isJsxAttribute(parent)) {
        walkRenderedChildExpression(node.expression, node);
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isJsxExpression(node.initializer)) {
      const attrName = jsxAttributeName(node);
      if (NON_COPY_JSX_ATTRS.has(attrName) || attrName === "id") return;
      const expression = node.initializer.expression;
      if (expression !== undefined) {
        const literalBranches = MESSAGE_JSX_ATTRS.has(attrName) || NAMING_ARIA.has(attrName);
        noteRenderedMessageExpression(expression, node, literalBranches);
      }
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (declaration.initializer === undefined || !ts.isExpression(declaration.initializer)) continue;
        const initializer = declaration.initializer;
        if (
          ts.isBinaryExpression(initializer) &&
          (initializer.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
            initializer.operatorToken.kind === ts.SyntaxKind.BarBarToken)
        ) {
          noteRenderedMessageExpression(initializer, declaration, true);
        }
      }
    }
    if (ts.isJsxSpreadAttribute(node)) {
      walkMessagePropsInExpression(node.expression, node);
    }
    ts.forEachChild(node, visit);
  }

  if (ts.isBlock(body)) visit(body);
  else visit(body);
}

function analyzeFunctionLiteralBindings(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  body: ts.ConciseBody | undefined,
  source: ts.SourceFile,
  documentedDefaults: Set<string>,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  fileUndocumentedPropNames: Set<string>,
): {
  literalBindings: Map<string, number>;
  undocumentedPropNames: Set<string>;
  indirectMessageProps: Map<string, number>;
} {
  const literalBindings = collectParameterLiteralDefaults(
    parameters,
    source,
    documentedDefaults,
    moduleBindings,
    moduleFunctions,
  );
  const undocumentedPropNames = collectUndocumentedShippedPropNames(
    parameters,
    source,
    documentedDefaults,
    moduleBindings,
    moduleFunctions,
  );
  let indirectMessageProps = new Map<string, number>();
  if (body !== undefined) {
    indirectMessageProps = analyzeRenderedLocals(
      body,
      documentedDefaults,
      undocumentedPropNames,
      fileUndocumentedPropNames,
      literalBindings,
      moduleFunctions,
      moduleDirectStringFunctions,
      source,
    );
  }
  return { literalBindings, undocumentedPropNames, indirectMessageProps };
}

function scriptKindForFileName(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function findShippedMessageViolations(fileName: string, sourceText: string): ShippedMessageViolation[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindForFileName(fileName));
  const violations: ShippedMessageViolation[] = [];
  const documentedDefaults = collectDocumentedDefaultProps(source);
  const moduleBindings = collectModuleLetteredBindings(source);
  const moduleFunctions = collectModuleShippedFunctions(source);
  const moduleDirectStringFunctions = collectModuleDirectStringShippedFunctions(source);
  const fileUndocumentedPropNames = collectFileUndocumentedShippedPropNames(
    source,
    documentedDefaults,
    moduleBindings,
    moduleFunctions,
  );
  const interfaceMessageProps = collectUndocumentedMessageInterfaceProps(source, documentedDefaults);

  function lineOf(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  function analyzeAndCheckRenderedLocals(
    parameters: ts.NodeArray<ts.ParameterDeclaration>,
    body: ts.ConciseBody | undefined,
  ): void {
    const { literalBindings, undocumentedPropNames, indirectMessageProps } = analyzeFunctionLiteralBindings(
      parameters,
      body,
      source,
      documentedDefaults,
      moduleBindings,
      moduleFunctions,
      moduleDirectStringFunctions,
      fileUndocumentedPropNames,
    );
    const mergedUndocumentedPropNames = new Set([...fileUndocumentedPropNames, ...undocumentedPropNames]);
    if (body !== undefined) {
      checkRenderedLocalReferences(
        body,
        literalBindings,
        mergedUndocumentedPropNames,
        interfaceMessageProps,
        moduleDirectStringFunctions,
        fileName,
        source,
        violations,
      );
    }
    for (const [propName, line] of indirectMessageProps) {
      violations.push({ file: fileName, line, kind: "rendered-local", text: propName });
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      analyzeAndCheckRenderedLocals(node.parameters, node.body);
    }
    if (ts.isMethodDeclaration(node) && node.body !== undefined) {
      analyzeAndCheckRenderedLocals(node.parameters, node.body);
    }

    if (ts.isJsxText(node) && hasLetter(node.text)) {
      violations.push({ file: fileName, line: lineOf(node), kind: "jsx-text", text: node.text.trim() });
    }
    if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      node.parent !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const literals: string[] = [];
      collectChildLiterals(node.expression, literals);
      for (const literal of literals) {
        if (hasLetter(literal)) {
          violations.push({ file: fileName, line: lineOf(node), kind: "jsx-text", text: literal });
        }
      }
      if (
        ts.isBinaryExpression(node.expression) &&
        (node.expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          node.expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        const fallback = staticLiteral(node.expression.right);
        if (fallback !== null && hasLetter(fallback)) {
          violations.push({ file: fileName, line: lineOf(node), kind: "nullish-fallback", text: fallback });
        }
      }
    }
    if (ts.isJsxAttribute(node)) {
      const name = jsxAttributeName(node);
      if (name.startsWith("aria-")) {
        const literal = attributeLiteral(node.initializer);
        if (literal !== null && literal.trim().length > 0) {
          const naming = NAMING_ARIA.has(name);
          const token = ARIA_STATE_TOKENS.has(literal);
          if (naming || !token) {
            violations.push({ file: fileName, line: lineOf(node), kind: "aria-literal", text: `${name}="${literal}"` });
          }
        }
      } else if (!NON_COPY_JSX_ATTRS.has(name) && !isStylingJsxAttribute(name) && MESSAGE_JSX_ATTRS.has(name)) {
        const literal = attributeLiteral(node.initializer);
        if (literal !== null && hasLetter(literal)) {
          violations.push({ file: fileName, line: lineOf(node), kind: "jsx-attribute", text: `${name}="${literal}"` });
        }
      }
      if (
        !isStylingJsxAttribute(name) &&
        node.initializer !== undefined &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression !== undefined &&
        ts.isBinaryExpression(node.initializer.expression) &&
        (node.initializer.expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          node.initializer.expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        const fallback = staticLiteral(node.initializer.expression.right);
        if (fallback !== null && hasLetter(fallback)) {
          violations.push({ file: fileName, line: lineOf(node), kind: "nullish-fallback", text: fallback });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

export function scanShippedMessageTree(root: string): ShippedMessageViolation[] {
  const violations: ShippedMessageViolation[] = [];
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name) || isExcludedFile(entry.name)) continue;
      const text = readFileSync(fullPath, "utf8");
      violations.push(...findShippedMessageViolations(fullPath, text));
    }
  }
  walk(root);
  return violations;
}

const SRC_ROOT = path.dirname(fileURLToPath(import.meta.url));

describe("shipped message lint", () => {
  it("fails a JSX text node and an aria attribute set to a string literal", () => {
    const source = `export function Example() {\n  return <section aria-label="Capture form">There is 1 error</section>;\n}\n`;
    const violations = findShippedMessageViolations("Example.tsx", source);
    expect(violations.map((violation) => violation.kind).sort()).toEqual(["aria-literal", "jsx-text"]);
  });

  it("fails a string or template literal used as a JSX child", () => {
    const source = "export function Example({ n }: { n: number }) {\n  return <h2>{n === 1 ? \"There is 1 error\" : `There are ${n} errors`}</h2>;\n}\n";
    const violations = findShippedMessageViolations("Example.tsx", source);
    expect(violations).toHaveLength(2);
    expect(violations.every((violation) => violation.kind === "jsx-text")).toBe(true);
  });

  it("fails a message JSX attribute, a nullish fallback, and a rendered local", () => {
    const source = [
      "export function Example() {",
      "  let rangeSummary = \"No results\";",
      "  return (",
      "    <nav>",
      "      <p>{rangeSummary}</p>",
      "      <Select label=\"Rows per page\" options={[]} />",
      "      <span>{placeholder ?? \"Select an option\"}</span>",
      "    </nav>",
      "  );",
      "}",
      "",
    ].join("\n");
    const kinds = findShippedMessageViolations("Example.tsx", source).map((violation) => violation.kind).sort();
    expect(kinds).toEqual(["jsx-attribute", "jsx-text", "nullish-fallback", "rendered-local"]);
  });

  it("fails a rendered parameter default without a documented @default", () => {
    const source = [
      "interface ExampleProps {",
      "  saveLabel?: string;",
      "}",
      "export function Example({ saveLabel = \"Save changes\" }: ExampleProps) {",
      "  return <button>{saveLabel}</button>;",
      "}",
      "",
    ].join("\n");
    const violations = findShippedMessageViolations("Example.tsx", source);
    expect(violations).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
    ]);
  });

  it("does not fail a rendered parameter default documented with @default", () => {
    const source = [
      "interface ExampleProps {",
      "  /** @default \"Save changes\" */",
      "  saveLabel?: string;",
      "}",
      "export function Example({ saveLabel = \"Save changes\" }: ExampleProps) {",
      "  return <button>{saveLabel}</button>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", source)).toEqual([]);
  });

  it("fails a rendered parameter default that references a module binding without @default", () => {
    const source = [
      "const DEFAULT_SAVE = \"Save changes\";",
      "interface ExampleProps {",
      "  saveLabel?: string;",
      "}",
      "export function Example({ saveLabel = DEFAULT_SAVE }: ExampleProps) {",
      "  return <button>{saveLabel}</button>;",
      "}",
      "",
    ].join("\n");
    const violations = findShippedMessageViolations("Example.tsx", source);
    expect(violations).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
    ]);
  });

  it("scanShippedMessageTree fails saveLabel without @default and passes once documented", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "publisher-shipped-message-"));
    const fixturePath = path.join(directory, "Fixture.tsx");
    try {
      writeFileSync(
        fixturePath,
        [
          "interface ExampleProps {",
          "  saveLabel?: string;",
          "}",
          "export function Example({ saveLabel = \"Save changes\" }: ExampleProps) {",
          "  return <button>{saveLabel}</button>;",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      expect(scanShippedMessageTree(directory)).toEqual([
        expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
      ]);

      writeFileSync(
        fixturePath,
        [
          "interface ExampleProps {",
          "  /** @default \"Save changes\" */",
          "  saveLabel?: string;",
          "}",
          "export function Example({ saveLabel = \"Save changes\" }: ExampleProps) {",
          "  return <button>{saveLabel}</button>;",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      expect(scanShippedMessageTree(directory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails a lettered string passed to createElement in a .ts file", () => {
    const source = [
      "import { createElement } from \"react\";",
      "export function Example() {",
      "  return createElement(\"span\", { className: \"sr-only\" }, \"Widget\");",
      "}",
      "",
    ].join("\n");
    const violations = findShippedMessageViolations("Example.ts", source);
    expect(violations).toEqual([expect.objectContaining({ kind: "jsx-text", text: "Widget" })]);
  });

  it("scanShippedMessageTree fails createElement copy in a .ts fixture", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "publisher-shipped-message-ts-"));
    try {
      writeFileSync(
        path.join(directory, "Fixture.ts"),
        [
          "import { createElement } from \"react\";",
          "export function Example() {",
          "  return createElement(\"span\", { className: \"sr-only\" }, \"Widget\");",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      expect(scanShippedMessageTree(directory)).toEqual([
        expect.objectContaining({ kind: "jsx-text", text: "Widget" }),
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails lettered copy inside createElement conditional, nullish, and logical-and children", () => {
    const conditional = [
      "import { createElement } from \"react\";",
      "export function Example(block: { title?: string }) {",
      "  return createElement(\"span\", { className: \"sr-only\" }, block.title === undefined ? \"Widget\" : block.title);",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", conditional)).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Widget" }),
    ]);

    const nullish = [
      "import { createElement } from \"react\";",
      "export function Example(props: { title?: string }) {",
      "  return createElement(\"span\", null, props.title ?? \"Widget\");",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", nullish)).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Widget" }),
    ]);

    const logicalAndLiteral = [
      "import { createElement } from \"react\";",
      "export function Example({ show }: { show?: boolean }) {",
      "  return createElement(\"span\", null, show && \"Save changes\");",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", logicalAndLiteral)).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
    ]);

    const logicalAndProp = [
      "import { createElement } from \"react\";",
      "interface ExampleProps { saveLabel?: string; show?: boolean; }",
      "export function Example({ show, saveLabel = \"Save changes\" }: ExampleProps) {",
      "  return createElement(\"span\", null, show && saveLabel);",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", logicalAndProp)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
    ]);
  });

  it("fails each expression form that renders an undocumented message prop", () => {
    const memberRead = [
      "interface ExampleProps { nodeChapterFallbackTitle?: string; }",
      "export function Example({ nodeChapterFallbackTitle = \"Widget\" }: ExampleProps, messages: { nodeChapterFallbackTitle: string }) {",
      "  return <span>{messages.nodeChapterFallbackTitle}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", memberRead)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "nodeChapterFallbackTitle" }),
    ]);

    const methodCall = [
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "interface ExampleProps { statGridLabel?: (index: number) => string; }",
      "export function Example({ statGridLabel = defaultStatGridLabel }: ExampleProps, messages: { statGridLabel: (index: number) => string }) {",
      "  return <span>{messages.statGridLabel(1)}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", methodCall)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "statGridLabel" }),
    ]);

    const elementAccess = [
      "const DEFAULT_TREND_LABELS = { up: \"Increase\", down: \"Decrease\", neutral: \"No change\" };",
      "interface ExampleProps { trendLabels?: typeof DEFAULT_TREND_LABELS; trend?: \"up\"; }",
      "export function Example({ trendLabels = DEFAULT_TREND_LABELS, trend = \"up\" }: ExampleProps) {",
      "  return <span className=\"sr-only\">{trendLabels[trend]}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", elementAccess)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "trendLabels" }),
    ]);

    const identifierAlias = [
      "interface ExampleProps { noResultsLabel?: string; }",
      "export function Example({ noResultsLabel = \"No results\" }: ExampleProps) {",
      "  let rangeSummary = noResultsLabel;",
      "  return <p>{rangeSummary}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", identifierAlias)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "rangeSummary" }),
    ]);

    const optionalChaining = [
      "interface ExampleProps { nodeChapterFallbackTitle?: string; }",
      "export function Example({ nodeChapterFallbackTitle = \"Widget\" }: ExampleProps, messages?: { nodeChapterFallbackTitle: string }) {",
      "  return <span>{messages?.nodeChapterFallbackTitle}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", optionalChaining)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "nodeChapterFallbackTitle" }),
    ]);

    const destructure = [
      "interface ExampleProps { nodeChapterFallbackTitle?: string; }",
      "export function Example({ nodeChapterFallbackTitle = \"Widget\" }: ExampleProps, messages: { nodeChapterFallbackTitle: string }) {",
      "  const { nodeChapterFallbackTitle: title } = messages;",
      "  return <span>{title}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", destructure)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);
  });

  it("fails a rendered function default that references a module helper without @default", () => {
    const source = [
      "function defaultErrorSummaryMessage(count: number): string {",
      "  return count === 1 ? \"There is 1 error\" : \"There are \" + String(count) + \" errors\";",
      "}",
      "interface ExampleProps {",
      "  errorSummaryMessage?: (count: number) => string;",
      "}",
      "export function Example({ errorSummaryMessage = defaultErrorSummaryMessage }: ExampleProps) {",
      "  return <h2>{errorSummaryMessage(1)}</h2>;",
      "}",
      "",
    ].join("\n");
    const violations = findShippedMessageViolations("Example.tsx", source);
    expect(violations).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "errorSummaryMessage" }),
    ]);
  });

  it("fails a template expression used as a parameter default without @default", () => {
    const source = [
      "interface ExampleProps {",
      "  pageSummaryMessage?: string;",
      "}",
      "export function Example({ pageSummaryMessage = `Page ${1} of ${2}` }: ExampleProps) {",
      "  return <p>{pageSummaryMessage}</p>;",
      "}",
      "",
    ].join("\n");
    const violations = findShippedMessageViolations("Example.tsx", source);
    expect(violations).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "pageSummaryMessage" }),
    ]);
  });

  it("does not fail a message prop", () => {
    const source = [
      "interface ExampleProps {",
      "  /** @default \"Capture form\" */",
      "  formLabel?: string;",
      "  /** @default \"Select an option\" */",
      "  placeholder?: string;",
      "  /** @default \"There is 1 error\" / \"There are N errors\" */",
      "  errorSummaryMessage?: (count: number) => string;",
      "}",
      "export function Example({",
      "  formLabel = \"Capture form\",",
      "  placeholder = \"Select an option\",",
      "  errorSummaryMessage = (count: number) => count === 1 ? \"There is 1 error\" : `There are ${count} errors`,",
      "}: ExampleProps) {",
      "  return <section aria-label={formLabel}>{errorSummaryMessage(1)}</section>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", source)).toEqual([]);
  });

  it("does not fail a glyph text node or an ARIA state token", () => {
    const source = `export function Example() {\n  return <span aria-hidden="true" aria-live="polite">×</span>;\n}\n`;
    expect(findShippedMessageViolations("Example.tsx", source)).toEqual([]);
  });

  it("does not fail SVG path data or displayName", () => {
    const source = [
      "export function Example() {",
      "  return <path d=\"M0,0 L1,1\" />;",
      "}",
      "Example.displayName = \"Example\";",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", source)).toEqual([]);
  });

  it("fails when a message call result is stored in a local and rendered", () => {
    const rangeSummaryMessageCall = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps { rangeSummaryMessage?: (start: number, end: number, total: number) => string; }",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = rangeSummaryMessage(1, 10, 100);",
      "  return <p>{rangeSummary}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", rangeSummaryMessageCall)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "rangeSummary" }),
    ]);

    const pageSummaryMessageCall = [
      "function defaultPageSummaryMessage(page: number, pageCount: number): string { return `Page ${page} of ${pageCount}`; }",
      "interface ExampleProps { pageSummaryMessage?: (page: number, pageCount: number) => string; }",
      "export function Example({ pageSummaryMessage = defaultPageSummaryMessage }: ExampleProps) {",
      "  let rangeSummary = pageSummaryMessage(1, 5);",
      "  return <p>{rangeSummary}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", pageSummaryMessageCall)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "rangeSummary" }),
    ]);

    const toggleLabelNullish = [
      "function defaultToggleLabel(): string { return \"Theme\"; }",
      "interface ExampleProps { toggleLabel?: () => string; \"aria-label\"?: string; }",
      "export function Example({ toggleLabel = defaultToggleLabel, \"aria-label\": ariaLabel }: ExampleProps) {",
      "  const label = toggleLabel();",
      "  return <button aria-label={ariaLabel ?? label} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("ThemeToggle.tsx", toggleLabelNullish)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "label" }),
    ]);

    const preferenceAnnouncementState = [
      "function defaultPreferenceAnnouncement(): string { return \"Theme set\"; }",
      "interface ExampleProps { preferenceAnnouncement?: () => string; }",
      "export function Example({ preferenceAnnouncement = defaultPreferenceAnnouncement }: ExampleProps) {",
      "  const [announcement, setAnnouncement] = useState(\"\");",
      "  setAnnouncement(preferenceAnnouncement());",
      "  return <span>{announcement}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("ThemeToggle.tsx", preferenceAnnouncementState)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "announcement" }),
    ]);

    const preferenceLabelsArgumentOnly = [
      "const DEFAULT_PREFERENCE_LABELS = { system: \"System\", light: \"Light\", dark: \"Dark\" };",
      "function defaultToggleLabel(_c: string, _n: string, labels: typeof DEFAULT_PREFERENCE_LABELS): string { return `Theme: ${labels.system}`; }",
      "interface ExampleProps { preferenceLabels?: typeof DEFAULT_PREFERENCE_LABELS; toggleLabel?: typeof defaultToggleLabel; }",
      "export function Example({ preferenceLabels = DEFAULT_PREFERENCE_LABELS, toggleLabel = defaultToggleLabel }: ExampleProps) {",
      "  toggleLabel(\"system\", \"light\", preferenceLabels);",
      "  return <button />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("ThemeToggle.tsx", preferenceLabelsArgumentOnly)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "preferenceLabels" }),
    ]);
  });

  it("passes message call locals when the prop default is documented with @default", () => {
    const source = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = rangeSummaryMessage(1, 10, 100);",
      "  return <p>{rangeSummary}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", source)).toEqual([]);
  });

  it("fails message props copied into locals in a function that does not own the defaults", () => {
    const source = [
      "import { createElement } from \"react\";",
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "function renderBlock(messages: { nodeChapterFallbackTitle: string; statGridLabel: (index: number) => string }) {",
      "  const title = messages.nodeChapterFallbackTitle;",
      "  const { statGridLabel: labelFor } = messages;",
      "  const label = labelFor(1);",
      "  return createElement(\"span\", { className: \"sr-only\" }, title, label);",
      "}",
      "export function compileConsumerTemplateBlocks({",
      "  nodeChapterFallbackTitle = \"Widget\",",
      "  statGridLabel = defaultStatGridLabel,",
      "}: { nodeChapterFallbackTitle?: string; statGridLabel?: (index: number) => string }) {",
      "  const messages = { nodeChapterFallbackTitle, statGridLabel };",
      "  return () => renderBlock(messages);",
      "}",
      "",
    ].join("\n");
    const violations = findShippedMessageViolations("compileConsumerTemplateBlocks.ts", source);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "title" }),
        expect.objectContaining({ kind: "rendered-local", text: "label" }),
      ]),
    );
  });

  it("fails logical-or fallback and member reads the same way as nullish coalescing", () => {
    const createElementOr = [
      "import { createElement } from \"react\";",
      "interface ExampleProps { title?: string; }",
      "export function Example(props: ExampleProps) {",
      "  return createElement(\"span\", null, props.title || \"Widget\");",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", createElementOr)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Widget" }),
        expect.objectContaining({ kind: "rendered-local", text: "title" }),
      ]),
    );

    const jsxOr = [
      "interface ExampleProps { title?: string; }",
      "export function Example(props: ExampleProps) {",
      "  return <span>{props.title || \"Widget\"}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", jsxOr)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Widget" }),
        expect.objectContaining({ kind: "nullish-fallback", text: "Widget" }),
        expect.objectContaining({ kind: "rendered-local", text: "title" }),
      ]),
    );

    const localOrCreateElement = [
      "import { createElement } from \"react\";",
      "function renderBlock(messages: { nodeChapterFallbackTitle: string }) {",
      "  const title = messages.nodeChapterFallbackTitle || \"Widget\";",
      "  return createElement(\"span\", { className: \"sr-only\" }, title);",
      "}",
      "export function compileConsumerTemplateBlocks({",
      "  nodeChapterFallbackTitle = \"Widget\",",
      "}: { nodeChapterFallbackTitle?: string }) {",
      "  const messages = { nodeChapterFallbackTitle };",
      "  return () => renderBlock(messages);",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", localOrCreateElement)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Widget" }),
        expect.objectContaining({ kind: "rendered-local", text: "title" }),
        expect.objectContaining({ kind: "rendered-local", text: "nodeChapterFallbackTitle" }),
      ]),
    );
  });

  it("fails JSX logical-and branches that reference locals, members, and calls", () => {
    const localAnd = [
      "interface ExampleProps { saveLabel?: string; show?: boolean; }",
      "export function Example({ show, saveLabel = \"Save changes\" }: ExampleProps) {",
      "  return <span>{show && saveLabel}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", localAnd)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
    ]);

    const memberAnd = [
      "interface ExampleProps { nodeChapterFallbackTitle?: string; show?: boolean; }",
      "export function Example({ show, nodeChapterFallbackTitle = \"Widget\" }: ExampleProps, messages: { nodeChapterFallbackTitle: string }) {",
      "  return <span>{show && messages.nodeChapterFallbackTitle}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", memberAnd)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "nodeChapterFallbackTitle" }),
    ]);

    const callAnd = [
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "interface ExampleProps { statGridLabel?: (index: number) => string; show?: boolean; }",
      "export function Example({ show, statGridLabel = defaultStatGridLabel }: ExampleProps, messages: { statGridLabel: (index: number) => string }) {",
      "  return <span>{show && messages.statGridLabel(1)}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", callAnd)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "statGridLabel" }),
    ]);

    const createElementAndLocal = [
      "import { createElement } from \"react\";",
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "function renderBlock(messages: { statGridLabel: (index: number) => string }, show: boolean) {",
      "  const { statGridLabel: labelFor } = messages;",
      "  const label = show && labelFor(1);",
      "  return createElement(\"span\", null, label);",
      "}",
      "export function compileConsumerTemplateBlocks({",
      "  statGridLabel = defaultStatGridLabel,",
      "}: { statGridLabel?: (index: number) => string }) {",
      "  const messages = { statGridLabel };",
      "  return (show: boolean) => renderBlock(messages, show);",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", createElementAndLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "label" }),
    ]);
  });

  it("fails a template expression that renders a shipped message local", () => {
    const source = [
      "import { createElement } from \"react\";",
      "function renderBlock(messages: { nodeChapterFallbackTitle: string }) {",
      "  const title = messages.nodeChapterFallbackTitle;",
      "  return createElement(\"span\", null, `${title}`);",
      "}",
      "export function compileConsumerTemplateBlocks({",
      "  nodeChapterFallbackTitle = \"Widget\",",
      "}: { nodeChapterFallbackTitle?: string }) {",
      "  const messages = { nodeChapterFallbackTitle };",
      "  return () => renderBlock(messages);",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", source)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);
  });

  it("fails message props whose defaults are declared in another function", () => {
    const source = [
      "import { createElement } from \"react\";",
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "function renderBlock(messages: { nodeChapterFallbackTitle: string; statGridLabel: (index: number) => string }) {",
      "  return createElement(\"span\", { className: \"sr-only\" }, messages.nodeChapterFallbackTitle, messages.statGridLabel(1));",
      "}",
      "export function compileConsumerTemplateBlocks({",
      "  nodeChapterFallbackTitle = \"Widget\",",
      "  statGridLabel = defaultStatGridLabel,",
      "}: { nodeChapterFallbackTitle?: string; statGridLabel?: (index: number) => string }) {",
      "  const messages = { nodeChapterFallbackTitle, statGridLabel };",
      "  return () => renderBlock(messages);",
      "}",
      "",
    ].join("\n");
    const violations = findShippedMessageViolations("compileConsumerTemplateBlocks.ts", source);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "nodeChapterFallbackTitle" }),
        expect.objectContaining({ kind: "rendered-local", text: "statGridLabel" }),
      ]),
    );
  });

  it("notes message-attribute branches, logical-and, templates, and arrays", () => {
    const attributeBranches = [
      "interface ExampleProps { saveLabel?: string; compact?: boolean; name?: string; show?: boolean; }",
      "export function Example({ saveLabel = \"Save\", compact, name, show }: ExampleProps) {",
      "  return (",
      "    <>",
      "      <Select label={saveLabel || \"Rows per page\"} options={[]} />",
      "      <Select label={compact ? \"Rows\" : \"Rows per page\"} options={[]} />",
      "      <img alt={name ?? \"Diagram\"} />",
      "      <Select label={show && \"Save changes\"} options={[]} />",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", attributeBranches)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
        expect.objectContaining({ kind: "jsx-text", text: "Rows per page" }),
        expect.objectContaining({ kind: "jsx-text", text: "Rows" }),
        expect.objectContaining({ kind: "jsx-text", text: "Diagram" }),
        expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
      ]),
    );

    const logicalAndTemplates = [
      "interface ExampleProps { saveLabel?: string; show?: boolean; ready?: boolean; mode?: string; }",
      "export function Example({ saveLabel = \"Save changes\", show, ready, mode }: ExampleProps) {",
      "  return (",
      "    <>",
      "      <span>{mode === \"edit\" ? (show && saveLabel) : null}</span>",
      "      <span>{ready || (show && saveLabel)}</span>",
      "      <span>{ready ?? (show && saveLabel)}</span>",
      "      <span>{`${show && saveLabel}`}</span>",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", logicalAndTemplates)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
      ]),
    );

    const createElementTemplate = [
      "import { createElement } from \"react\";",
      "interface ExampleProps { saveLabel?: string; show?: boolean; }",
      "export function Example({ saveLabel = \"Save changes\", show }: ExampleProps) {",
      "  return createElement(\"span\", null, `${show && saveLabel}`);",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", createElementTemplate)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "saveLabel" })]),
    );
  });

  it("notes string-key access, nested defaults, function forms, assertions, arrays, and module calls", () => {
    const stringKey = [
      "interface ExampleProps { nodeChapterFallbackTitle?: string; }",
      "export function Example({ nodeChapterFallbackTitle = \"Widget\" }: ExampleProps, messages: { nodeChapterFallbackTitle: string }) {",
      "  return <span>{messages[\"nodeChapterFallbackTitle\"]}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", stringKey)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "nodeChapterFallbackTitle" }),
    ]);

    const nestedDefault = [
      "export function Example({ messages: { saveLabel = \"Save changes\" } }: { messages: { saveLabel?: string } }) {",
      "  return <button>{saveLabel}</button>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nestedDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
    ]);

    const functionExpression = [
      "interface ExampleProps { saveLabel?: string; }",
      "export const Example = function ({ saveLabel = \"Save changes\" }: ExampleProps) {",
      "  return <button>{saveLabel}</button>;",
      "};",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", functionExpression)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
    ]);

    const methodDefault = [
      "interface ExampleProps { saveLabel?: string; }",
      "export class Example {",
      "  render({ saveLabel = \"Save changes\" }: ExampleProps) {",
      "    return <button>{saveLabel}</button>;",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", methodDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
    ]);

    const assertions = [
      "interface ExampleProps { saveLabel?: string; }",
      "export function Example({ saveLabel = \"Save changes\" }: ExampleProps) {",
      "  return (",
      "    <>",
      "      <button>{saveLabel!}</button>",
      "      <span>{\"Save changes\" as string}</span>",
      "      <span>{\"Save changes\" satisfies string}</span>",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", assertions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "saveLabel" }),
        expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
      ]),
    );

    const arrayChildren = [
      "import { createElement } from \"react\";",
      "export function Example() {",
      "  return (",
      "    <>",
      "      <span>{[\"Save changes\"]}</span>",
      "      {createElement(\"span\", null, [\"Save changes\"])}",
      "      {createElement(\"span\", null, ...[\"Save changes\"])}",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", arrayChildren)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "jsx-text", text: "Save changes" })]),
    );

    const moduleCall = [
      "function helper() { return \"Save changes\"; }",
      "export function Example() {",
      "  const text = helper();",
      "  return <button>{text}</button>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", moduleCall)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "text" }),
    ]);

    const leftLiteral = [
      "export function Example({ value }: { value?: string }) {",
      "  return (",
      "    <>",
      "      <span>{\"Save changes\" || value}</span>",
      "      <input placeholder={\"Search\" || value} />",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", leftLiteral)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
        expect.objectContaining({ kind: "jsx-text", text: "Search" }),
      ]),
    );
  });

  it("notes default unwrapping, binding forms, aria branches, spreads, and module helpers", () => {
    const asConstDefault = [
      "interface ExampleProps { placeholder?: string; }",
      "export function Example({ placeholder = \"Search\" as const }: ExampleProps) {",
      "  return <input placeholder={placeholder} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", asConstDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "placeholder" }),
    ]);

    const nullishDefault = [
      "interface ExampleProps { placeholder?: string; other?: string; }",
      "export function Example({ placeholder = \"Search\" ?? other }: ExampleProps) {",
      "  return <input placeholder={placeholder} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nullishDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "placeholder" }),
    ]);

    const moduleOrDefault = [
      "const DEFAULT_LABEL = \"Search\" || \"Fallback\";",
      "interface ExampleProps { label?: string; }",
      "export function Example({ label = DEFAULT_LABEL }: ExampleProps) {",
      "  return <span>{label}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", moduleOrDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "label" }),
    ]);

    const nestedObjectDefault = [
      "export function Example({ field: { placeholder } = { placeholder: \"Search\" } }: { field: { placeholder?: string } }) {",
      "  return <input placeholder={placeholder} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nestedObjectDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "placeholder" }),
    ]);

    const identifierDefault = [
      "export function Example(placeholder = \"Search\") {",
      "  return <input placeholder={placeholder} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", identifierDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "placeholder" }),
    ]);

    const arrayDefault = [
      "export function Example({ items: [placeholder = \"Search\"] }: { items: [string?] }) {",
      "  return <input placeholder={placeholder} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", arrayDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "placeholder" }),
    ]);

    const ariaConditional = [
      "export function Example({ ready }: { ready?: boolean }) {",
      "  return <section aria-label={ready ? \"Capture form\" : \"Done\"} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", ariaConditional)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Capture form" }),
        expect.objectContaining({ kind: "jsx-text", text: "Done" }),
      ]),
    );

    const ariaOr = [
      "export function Example({ name }: { name?: string }) {",
      "  return <section aria-label={\"Capture form\" || name} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", ariaOr)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "jsx-text", text: "Capture form" })]),
    );

    const jsxSpread = [
      "export function Example() {",
      "  return <img {...{ alt: \"Diagram\" }} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", jsxSpread)).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Diagram" }),
    ]);

    const createElementConditional = [
      "import { createElement } from \"react\";",
      "export function Example({ ready }: { ready?: boolean }) {",
      "  return createElement(\"img\", ready ? { alt: \"Diagram\" } : { alt: \"Chart\" });",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", createElementConditional)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Diagram" }),
        expect.objectContaining({ kind: "jsx-text", text: "Chart" }),
      ]),
    );

    const moduleArrowHelper = [
      "const helper = () => \"Save changes\";",
      "export function Example() {",
      "  const text = helper();",
      "  return <button>{text}</button>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", moduleArrowHelper)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "text" }),
    ]);

    const moduleFunctionRender = [
      "function helper(){ return \"Save changes\"; }",
      "export function Example() {",
      "  return <button>{helper()}</button>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", moduleFunctionRender)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "helper" }),
    ]);

    const logicalAndLocal = [
      "export function Example({ show }: { show?: boolean }) {",
      "  const text = show && \"Save changes\";",
      "  return <button>{text}</button>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", logicalAndLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "text" }),
    ]);
  });

  it("finds no shipped message literals under publisher src/web", () => {
    expect(scanShippedMessageTree(SRC_ROOT)).toEqual([]);
  });
});
