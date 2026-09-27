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

function analyzeRenderedLocals(body: ts.ConciseBody, documentedDefaults: Set<string>): Map<string, number> {
  const literalLocals = new Map<string, number>();

  function registerLocal(name: string, initializer: ts.Expression, line: number): void {
    if (documentedDefaults.has(name)) return;
    if (localInitializerIsShippedCopy(initializer)) {
      literalLocals.set(name, line);
    }
  }

  function scanNode(node: ts.Node): void {
    if (isDisplayNameAssignment(node)) return;
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          registerLocal(declaration.name.text, declaration.initializer, node.getStart());
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      !ts.isPropertyAccessExpression(node.parent)
    ) {
      registerLocal(node.left.text, node.right, node.getStart());
    }
    ts.forEachChild(node, scanNode);
  }

  if (ts.isBlock(body)) scanNode(body);
  return literalLocals;
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

  function noteCreateElementExpression(expression: ts.Expression, node: ts.Node): void {
    const literal = staticLiteral(expression);
    if (literal !== null && hasLetter(literal)) {
      violations.push({ file: fileName, line: lineOf(node), kind: "jsx-text", text: literal });
      return;
    }
    if (ts.isTemplateExpression(expression) && templateExpressionIsShippedCopy(expression)) {
      violations.push({ file: fileName, line: lineOf(node), kind: "jsx-text", text: expression.getText(source) });
      return;
    }
    if (ts.isIdentifier(expression)) {
      noteReference(expression.text, node);
    }
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
            noteCreateElementExpression(property.initializer, property);
          }
        } else {
          noteCreateElementExpression(argument, node);
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      noteReference(node.expression.text, node);
    }
    if (ts.isJsxExpression(node) && node.expression !== undefined && ts.isIdentifier(node.expression)) {
      const parent = node.parent;
      if (parent === undefined || !ts.isJsxAttribute(parent)) {
        noteReference(node.expression.text, node);
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isJsxExpression(node.initializer)) {
      const attrName = jsxAttributeName(node);
      if (NON_COPY_JSX_ATTRS.has(attrName) || attrName === "id") return;
      const expression = node.initializer.expression;
      if (expression !== undefined && ts.isIdentifier(expression)) {
        noteReference(expression.text, node);
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
): Map<string, number> {
  const literalBindings = collectParameterLiteralDefaults(
    parameters,
    source,
    documentedDefaults,
    moduleBindings,
    moduleFunctions,
  );
  if (body !== undefined) {
    for (const [name, line] of analyzeRenderedLocals(body, documentedDefaults)) {
      literalBindings.set(name, line);
    }
  }
  return literalBindings;
}

function scriptKindForFileName(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function findShippedMessageViolations(fileName: string, sourceText: string): ShippedMessageViolation[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindForFileName(fileName));
  const violations: ShippedMessageViolation[] = [];
  const documentedDefaults = collectDocumentedDefaultProps(source);
  const moduleBindings = collectModuleLetteredBindings(source);
  const moduleFunctions = collectModuleShippedFunctions(source);

  function lineOf(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
      const literalLocals = analyzeFunctionLiteralBindings(
        node.parameters,
        node.body,
        source,
        documentedDefaults,
        moduleBindings,
        moduleFunctions,
      );
      if (node.body !== undefined) {
        checkRenderedLocalReferences(node.body, literalLocals, fileName, source, violations);
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

function scanShippedMessageTree(root: string): ShippedMessageViolation[] {
  const violations: ShippedMessageViolation[] = [];
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!/\.[jt]sx$/.test(entry.name) || isExcludedFile(entry.name)) continue;
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

  it("finds no shipped message literals under publisher src/web", () => {
    expect(scanShippedMessageTree(SRC_ROOT)).toEqual([]);
  });
});
