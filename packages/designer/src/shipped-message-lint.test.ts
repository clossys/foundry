import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Package lint for shipped copy in this tree (issue #1521).
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

export interface ShippedMessageViolation {
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

function expressionIsShippedCopy(expression: ts.Expression): boolean {
  if (localInitializerIsShippedCopy(expression)) return true;
  if (ts.isConditionalExpression(expression)) {
    return expressionIsShippedCopy(expression.whenTrue) || expressionIsShippedCopy(expression.whenFalse);
  }
  if (ts.isParenthesizedExpression(expression)) return expressionIsShippedCopy(expression.expression);
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
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined || statement.body === undefined) continue;
    if (functionBodyReturnsShippedCopy(statement)) {
      names.add(statement.name.text);
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

function localInitializerIsShippedCopy(node: ts.Expression): boolean {
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
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return localInitializerIsShippedCopy(node.right);
  }
  return false;
}

function collectChildLiterals(expression: ts.Expression | undefined, out: string[]): void {
  if (expression === undefined) return;
  const literal = staticLiteral(expression);
  if (literal !== null) {
    out.push(literal);
    return;
  }
  if (ts.isParenthesizedExpression(expression)) {
    collectChildLiterals(expression.expression, out);
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    collectChildLiterals(expression.whenTrue, out);
    collectChildLiterals(expression.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    collectChildLiterals(expression.right, out);
    return;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
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

function collectParameterLiteralDefaults(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  source: ts.SourceFile,
  documentedDefaults: Set<string>,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
): Map<string, number> {
  const literalParams = new Map<string, number>();

  for (const parameter of parameters) {
    if (!ts.isObjectBindingPattern(parameter.name)) continue;
    const line = source.getLineAndCharacterOfPosition(parameter.getStart(source)).line + 1;
    for (const element of parameter.name.elements) {
      if (element.initializer === undefined) continue;
      const propName = bindingElementPropertyName(element, source);
      const localName = bindingElementLocalName(element);
      if (propName === null || localName === null) continue;
      if (documentedDefaults.has(propName)) continue;
      if (!parameterDefaultIsShippedCopy(element.initializer, moduleBindings, moduleFunctions)) continue;
      literalParams.set(localName, line);
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
  for (const parameter of parameters) {
    if (!ts.isObjectBindingPattern(parameter.name)) continue;
    for (const element of parameter.name.elements) {
      const propName = bindingElementPropertyName(element, source);
      if (propName === null || element.initializer === undefined) continue;
      if (documentedDefaults.has(propName)) continue;
      if (parameterDefaultIsShippedCopy(element.initializer, moduleBindings, moduleFunctions)) {
        names.add(propName);
      }
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
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
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
  source: ts.SourceFile,
): Map<string, number> {
  const indirectMessageProps = new Map<string, number>();
  const setterToState = new Map<string, string>();

  function lineOf(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  function callCarriesShippedMessage(call: ts.CallExpression): boolean {
    return ts.isIdentifier(call.expression) && literalLocals.has(call.expression.text);
  }

  function memberIsUndocumentedShippedProp(memberName: string): boolean {
    return undocumentedPropNames.has(memberName) || fileUndocumentedPropNames.has(memberName);
  }

  function expressionCarriesShippedMessage(expression: ts.Expression): boolean {
    if (localInitializerIsShippedCopy(expression)) return true;
    if (ts.isPropertyAccessExpression(expression)) {
      return memberIsUndocumentedShippedProp(expression.name.text);
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
    if (ts.isParenthesizedExpression(expression)) return expressionCarriesShippedMessage(expression.expression);
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

  function notePropertyAccess(node: ts.PropertyAccessExpression, reportAt: ts.Node): void {
    const member = node.name.text;
    if (undocumentedPropNames.has(member)) {
      violations.push({ file: fileName, line: lineOf(reportAt), kind: "rendered-local", text: member });
      return;
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
    if (ts.isParenthesizedExpression(expression)) {
      noteRenderedMessageReference(expression.expression, node);
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      noteRenderedMessageReference(expression.whenTrue, node);
      noteRenderedMessageReference(expression.whenFalse, node);
      return;
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      noteRenderedMessageReference(expression.left, node);
      noteRenderedMessageReference(expression.right, node);
      return;
    }
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        notePropertyAccess(callee, node);
      } else if (ts.isIdentifier(callee)) {
        noteReference(callee.text, node);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      notePropertyAccess(expression, node);
      return;
    }
    if (ts.isElementAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      noteReference(expression.expression.text, node);
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
    if (ts.isElementAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
      noteReference(unwrapped.expression.text, node);
    }
  }

  function noteRenderedMessageExpression(
    expression: ts.Expression,
    node: ts.Node,
    literalBranches = false,
  ): void {
    if (ts.isParenthesizedExpression(expression)) {
      noteRenderedMessageExpression(expression.expression, node, literalBranches);
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
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
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
      }
      return;
    }
    const literal = staticLiteral(expression);
    if (literal !== null && hasLetter(literal)) {
      violations.push({ file: fileName, line: lineOf(node), kind: "jsx-text", text: literal });
      return;
    }
    if (ts.isTemplateExpression(expression) && templateExpressionIsShippedCopy(expression)) {
      violations.push({ file: fileName, line: lineOf(node), kind: "jsx-text", text: expression.getText(source) });
      return;
    }
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        notePropertyAccess(callee, node);
      } else if (ts.isIdentifier(callee)) {
        noteReference(callee.text, node);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      notePropertyAccess(expression, node);
      return;
    }
    if (ts.isElementAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      noteReference(expression.expression.text, node);
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
    if (ts.isElementAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
      noteReference(unwrapped.expression.text, node);
    }
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
        if (ts.isObjectLiteralExpression(argument)) {
          for (const property of argument.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const propertyName = property.name.getText(source);
            if (!isMessageCreateElementProperty(propertyName)) continue;
            noteRenderedMessageExpression(property.initializer, property, true);
          }
        } else {
          noteRenderedMessageExpression(argument, node, true);
        }
      }
    }
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const parent = node.parent;
      if (parent === undefined || !ts.isJsxAttribute(parent)) {
        noteRenderedMessageExpression(node.expression, node);
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isJsxExpression(node.initializer)) {
      const attrName = jsxAttributeName(node);
      if (NON_COPY_JSX_ATTRS.has(attrName) || attrName === "id") return;
      const expression = node.initializer.expression;
      if (expression !== undefined) {
        noteRenderedMessageExpression(expression, node);
      }
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
  const fileUndocumentedPropNames = collectFileUndocumentedShippedPropNames(
    source,
    documentedDefaults,
    moduleBindings,
    moduleFunctions,
  );

  function lineOf(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
      const { literalBindings, undocumentedPropNames, indirectMessageProps } = analyzeFunctionLiteralBindings(
        node.parameters,
        node.body,
        source,
        documentedDefaults,
        moduleBindings,
        moduleFunctions,
        fileUndocumentedPropNames,
      );
      const mergedUndocumentedPropNames = new Set([...fileUndocumentedPropNames, ...undocumentedPropNames]);
      if (node.body !== undefined) {
        checkRenderedLocalReferences(
          node.body,
          literalBindings,
          mergedUndocumentedPropNames,
          fileName,
          source,
          violations,
        );
      }
      for (const [propName, line] of indirectMessageProps) {
        violations.push({ file: fileName, line, kind: "rendered-local", text: propName });
      }
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
      if (ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
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
      } else if (
        !isStylingJsxAttribute(name) &&
        node.initializer !== undefined &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression !== undefined &&
        ts.isBinaryExpression(node.initializer.expression) &&
        node.initializer.expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
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
    const directory = mkdtempSync(path.join(tmpdir(), "designer-shipped-message-"));
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
    const directory = mkdtempSync(path.join(tmpdir(), "designer-shipped-message-ts-"));
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

  it("finds no shipped message literals under designer src", () => {
    expect(scanShippedMessageTree(SRC_ROOT)).toEqual([]);
  });
});
