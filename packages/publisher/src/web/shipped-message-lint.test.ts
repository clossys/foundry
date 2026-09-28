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
  "glyph",
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
  expression = unwrapExpression(expression);
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
      kind === ts.SyntaxKind.PlusToken ||
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

function moduleBindingInitializerIsRenderedCopy(initializer: ts.Expression): boolean {
  if (!localInitializerIsShippedCopy(initializer)) return false;
  const init = unwrapExpression(initializer);
  if (ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init)) return false;
  return true;
}

function collectModuleRenderedStringBindings(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      if (moduleBindingInitializerIsRenderedCopy(declaration.initializer)) {
        names.add(declaration.name.text);
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        if (names.has(declaration.name.text)) continue;
        const init = unwrapExpression(declaration.initializer);
        if (ts.isIdentifier(init) && names.has(init.text)) {
          names.add(declaration.name.text);
          changed = true;
        }
      }
    }
  }
  return names;
}

function collectModuleMessageObjectInitializers(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const initializers = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const init = unwrapExpression(declaration.initializer);
      if (ts.isObjectLiteralExpression(init) && localInitializerIsShippedCopy(declaration.initializer)) {
        initializers.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return initializers;
}

function collectModuleMessageArrayInitializers(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const initializers = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const init = unwrapExpression(declaration.initializer);
      if (ts.isArrayLiteralExpression(init) && localInitializerIsShippedCopy(declaration.initializer)) {
        initializers.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return initializers;
}

function resolveModulePatternDefault(
  expr: ts.Expression,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): ts.Expression {
  const unwrapped = unwrapExpression(expr);
  if (ts.isIdentifier(unwrapped)) {
    const fromObject = moduleMessageObjectInitializers.get(unwrapped.text);
    if (fromObject !== undefined) return fromObject;
    const fromArray = moduleMessageArrayInitializers.get(unwrapped.text);
    if (fromArray !== undefined) return fromArray;
  }
  return expr;
}

function arrayDefaultEntryAtIndex(
  parameterDefault: ts.Expression | undefined,
  index: number,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): ts.Expression | undefined {
  const slices = collectArrayIndexSlicesFromDefault(
    parameterDefault ?? undefined,
    index,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
  );
  return slices !== null && slices.length === 1 ? slices[0] : undefined;
}

function collectArrayIndexSlicesFromDefault(
  parameterDefault: ts.Expression | undefined,
  index: number,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
  sourceFile?: ts.SourceFile,
): ts.Expression[] | null {
  if (parameterDefault === undefined) return null;
  const resolved = resolveModulePatternDefault(
    parameterDefault,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
  );
  const unwrapped = unwrapExpression(resolved);
  if (ts.isArrayLiteralExpression(unwrapped)) {
    const entry = unwrapped.elements[index];
    return entry !== undefined && ts.isExpression(entry) ? [entry] : null;
  }
  if (ts.isConditionalExpression(unwrapped)) {
    const whenTrue = collectArrayIndexSlicesFromDefault(
      unwrapped.whenTrue,
      index,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
      sourceFile,
    );
    const whenFalse = collectArrayIndexSlicesFromDefault(
      unwrapped.whenFalse,
      index,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
      sourceFile,
    );
    const slices: ts.Expression[] = [];
    if (whenTrue !== null) slices.push(...whenTrue);
    if (whenFalse !== null) slices.push(...whenFalse);
    return slices.length === 0 ? null : slices;
  }
  if (ts.isBinaryExpression(unwrapped)) {
    const kind = unwrapped.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const left = collectArrayIndexSlicesFromDefault(
        unwrapped.left,
        index,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        sourceFile,
      );
      const right = collectArrayIndexSlicesFromDefault(
        unwrapped.right,
        index,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        sourceFile,
      );
      const slices: ts.Expression[] = [];
      if (left !== null) slices.push(...left);
      if (right !== null) slices.push(...right);
      return slices.length === 0 ? null : slices;
    }
  }
  if (sourceFile !== undefined && ts.isCallExpression(unwrapped)) {
    const entry = callableReturnArrayElementInitializer(unwrapped, index, sourceFile);
    return entry !== undefined ? [entry] : null;
  }
  return null;
}

function elementAccessIndexFromArgument(argument: ts.Expression): number | null {
  const unwrapped = unwrapExpression(argument);
  if (ts.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.text);
  }
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    const text = unwrapped.text;
    if (/^(?:0|[1-9]\d*)$/.test(text)) {
      return Number(text);
    }
  }
  return null;
}

function collectObjectMemberSlicesFromDefault(
  expr: ts.Expression,
  memberKey: string,
  source: ts.SourceFile,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
  parameters: ts.ParameterDeclaration[] = [],
): ts.Expression[] | null {
  const resolved = unwrapExpression(
    resolveModulePatternDefault(expr, moduleMessageObjectInitializers, moduleMessageArrayInitializers),
  );
  if (ts.isCallExpression(resolved)) {
    const memberInit = callableReturnObjectMemberInitializer(resolved, memberKey, source);
    return memberInit !== undefined ? [memberInit] : null;
  }
  if (ts.isObjectLiteralExpression(resolved)) {
    const slice =
      objectLiteralMemberInitializer(
        resolved,
        memberKey,
        source,
        parameters,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      ) ?? objectLiteralPropertyInitializer(resolved, memberKey, source);
    if (slice !== undefined) return [slice];
    for (const property of resolved.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spreadSlices = collectObjectMemberSlicesFromDefault(
          property.expression,
          memberKey,
          source,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
          parameters,
        );
        if (spreadSlices !== null && spreadSlices.length > 0) return spreadSlices;
      }
    }
    return null;
  }
  if (ts.isConditionalExpression(resolved)) {
    const whenTrue = collectObjectMemberSlicesFromDefault(
      resolved.whenTrue,
      memberKey,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
      parameters,
    );
    const whenFalse = collectObjectMemberSlicesFromDefault(
      resolved.whenFalse,
      memberKey,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
      parameters,
    );
    const slices: ts.Expression[] = [];
    if (whenTrue !== null) slices.push(...whenTrue);
    if (whenFalse !== null) slices.push(...whenFalse);
    return slices.length === 0 ? null : slices;
  }
  if (ts.isBinaryExpression(resolved)) {
    const kind = resolved.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const left = collectObjectMemberSlicesFromDefault(
        resolved.left,
        memberKey,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        parameters,
      );
      const right = collectObjectMemberSlicesFromDefault(
        resolved.right,
        memberKey,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        parameters,
      );
      const slices: ts.Expression[] = [];
      if (left !== null) slices.push(...left);
      if (right !== null) slices.push(...right);
      return slices.length === 0 ? null : slices;
    }
  }
  return null;
}

function collectObjectMemberPathSlicesFromDefault(
  expr: ts.Expression,
  memberKeys: readonly string[],
  source: ts.SourceFile,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
  parameters: ts.ParameterDeclaration[] = [],
): ts.Expression[] | null {
  if (memberKeys.length === 0) return null;
  const [first, ...rest] = memberKeys;
  const slices = collectObjectMemberSlicesFromDefault(
    expr,
    first,
    source,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
    parameters,
  );
  if (slices === null) return null;
  if (rest.length === 0) return slices;
  const nested: ts.Expression[] = [];
  for (const slice of slices) {
    const inner = collectObjectMemberPathSlicesFromDefault(
      slice,
      rest,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
      parameters,
    );
    if (inner !== null) nested.push(...inner);
  }
  return nested.length === 0 ? null : nested;
}

function collectArrayAllElementSlicesFromDefault(
  parameterDefault: ts.Expression | undefined,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): ts.Expression[] | null {
  if (parameterDefault === undefined) return null;
  const resolved = resolveModulePatternDefault(
    parameterDefault,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
  );
  const unwrapped = unwrapExpression(resolved);
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.filter((entry): entry is ts.Expression => ts.isExpression(entry));
  }
  if (ts.isConditionalExpression(unwrapped)) {
    const whenTrue = collectArrayAllElementSlicesFromDefault(
      unwrapped.whenTrue,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
    const whenFalse = collectArrayAllElementSlicesFromDefault(
      unwrapped.whenFalse,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
    const slices: ts.Expression[] = [];
    if (whenTrue !== null) slices.push(...whenTrue);
    if (whenFalse !== null) slices.push(...whenFalse);
    return slices.length === 0 ? null : slices;
  }
  if (ts.isBinaryExpression(unwrapped)) {
    const kind = unwrapped.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const left = collectArrayAllElementSlicesFromDefault(
        unwrapped.left,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
      const right = collectArrayAllElementSlicesFromDefault(
        unwrapped.right,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
      const slices: ts.Expression[] = [];
      if (left !== null) slices.push(...left);
      if (right !== null) slices.push(...right);
      return slices.length === 0 ? null : slices;
    }
  }
  return null;
}

function renderedMemberChain(root: ts.Expression): { objectName: string; memberKeys: string[] } | null {
  const memberKeys: string[] = [];
  let current: ts.Expression = root;
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      memberKeys.unshift(current.name.text);
      current = current.expression;
      continue;
    }
    if (ts.isElementAccessExpression(current)) {
      const arg = current.argumentExpression;
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        if (NON_MESSAGE_PARAMETER_MEMBERS.has(arg.text)) return null;
        memberKeys.unshift(arg.text);
        current = current.expression;
        continue;
      }
      return null;
    }
    current = unwrapExpression(current);
    if (ts.isIdentifier(current)) {
      return { objectName: current.text, memberKeys };
    }
    return null;
  }
}

function propertyAccessMemberKeys(node: ts.PropertyAccessExpression): { objectName: string; memberKeys: string[] } | null {
  return renderedMemberChain(node);
}

function indirectHelperCallDefersRender(call: ts.CallExpression): boolean {
  const parent = call.parent;
  if (!ts.isArrowFunction(parent) || parent.body !== call) return false;
  const grand = parent.parent;
  return ts.isReturnStatement(grand) && grand.expression === parent;
}

function bindingPatternLocalNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    names.push(...bindingPatternLocalNames(element.name));
  }
  return names;
}

function isComponentIdentifier(name: string): boolean {
  const first = name.charAt(0);
  return first !== "" && first === first.toUpperCase() && first !== first.toLowerCase();
}

const NON_MESSAGE_PARAMETER_MEMBERS = new Set(["length", "toString", "valueOf"]);

const INDIRECT_CALL_BUILTIN_CALLEES = new Set([
  "Number",
  "String",
  "Boolean",
  "parseInt",
  "parseFloat",
  "BigInt",
]);

const EXEMPT_RENDERED_MEMBER_NAMES = new Set(["glyph", "displayName", "d", "aria-hidden", "aria-live"]);

function isExemptRenderedMember(memberName: string): boolean {
  return NON_MESSAGE_PARAMETER_MEMBERS.has(memberName) || EXEMPT_RENDERED_MEMBER_NAMES.has(memberName);
}

function parameterDefaultIsMessageCall(
  initializer: ts.Expression,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  moduleDirectStringAliases: Map<string, string>,
): boolean {
  const unwrapped = unwrapExpression(initializer);
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    return functionBodyReturnsShippedCopy(unwrapped);
  }
  return (
    ts.isIdentifier(unwrapped) &&
    (moduleFunctions.has(unwrapped.text) ||
      moduleDirectStringFunctions.has(unwrapped.text) ||
      moduleDirectStringAliases.has(unwrapped.text))
  );
}

function renderSliceExpressionIsShipped(
  expression: ts.Expression,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  moduleDirectStringAliases: Map<string, string>,
  parameterDefaultSearchParameters: ts.ParameterDeclaration[],
  source: ts.SourceFile,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
  messageCallParameters: Set<string> = new Set(),
  literalLocalInitializers: Map<string, ts.Expression> = new Map(),
): boolean {
  expression = unwrapExpression(expression);
  if (
    parameterDefaultIsShippedCopy(
      expression,
      moduleBindings,
      moduleFunctions,
      moduleDirectStringFunctions,
      moduleDirectStringAliases,
    )
  ) {
    return true;
  }
  if (ts.isCallExpression(expression)) {
    const callee = unwrapExpression(expression.expression);
    if (ts.isIdentifier(callee)) {
      if (messageCallParameters.has(callee.text)) return true;
      if (moduleDirectStringFunctions.has(callee.text) || moduleDirectStringAliases.has(callee.text)) return true;
      const paramDefault = parameterDefaultExpressionForName(
        callee.text,
        parameterDefaultSearchParameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
      if (
        paramDefault !== undefined &&
        parameterDefaultIsMessageCall(
          paramDefault,
          moduleFunctions,
          moduleDirectStringFunctions,
          moduleDirectStringAliases,
        )
      ) {
        return true;
      }
    }
    return false;
  }
  if (ts.isIdentifier(expression)) {
    const localInit = literalLocalInitializers.get(expression.text);
    if (localInit !== undefined) {
      return renderSliceExpressionIsShipped(
        localInit,
        moduleBindings,
        moduleFunctions,
        moduleDirectStringFunctions,
        moduleDirectStringAliases,
        parameterDefaultSearchParameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        messageCallParameters,
        literalLocalInitializers,
      );
    }
    const paramDefault = parameterDefaultExpressionForName(
      expression.text,
      parameterDefaultSearchParameters,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
    if (paramDefault !== undefined) {
      return renderSliceExpressionIsShipped(
        paramDefault,
        moduleBindings,
        moduleFunctions,
        moduleDirectStringFunctions,
        moduleDirectStringAliases,
        parameterDefaultSearchParameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        messageCallParameters,
        literalLocalInitializers,
      );
    }
  }
  return false;
}

function expressionReferencesParameterInRenderContext(expression: ts.Expression, paramName: string): boolean {
  expression = unwrapExpression(expression);
  if (ts.isIdentifier(expression) && expression.text === paramName) return true;
  if (ts.isPropertyAccessExpression(expression)) {
    if (ts.isIdentifier(expression.expression) && expression.expression.text === paramName) {
      return !NON_MESSAGE_PARAMETER_MEMBERS.has(expression.name.text);
    }
  }
  if (ts.isElementAccessExpression(expression)) {
    if (ts.isIdentifier(expression.expression) && expression.expression.text === paramName) {
      return false;
    }
  }
  if (ts.isTemplateExpression(expression)) {
    return expression.templateSpans.some((span) =>
      expressionReferencesParameterInRenderContext(span.expression, paramName),
    );
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      expressionReferencesParameterInRenderContext(expression.whenTrue, paramName) ||
      expressionReferencesParameterInRenderContext(expression.whenFalse, paramName)
    );
  }
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.PlusToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return (
        expressionReferencesParameterInRenderContext(expression.left, paramName) ||
        expressionReferencesParameterInRenderContext(expression.right, paramName)
      );
    }
  }
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isAsExpression(expression)) {
    return expressionReferencesParameterInRenderContext(expression.expression, paramName);
  }
  if (ts.isSatisfiesExpression(expression)) {
    return expressionReferencesParameterInRenderContext(expression.expression, paramName);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        if (expressionReferencesParameterInRenderContext(element.expression, paramName)) return true;
      } else if (ts.isExpression(element) && expressionReferencesParameterInRenderContext(element, paramName)) {
        return true;
      }
    }
  }
  return false;
}

type RenderedParameterBinding = { paramName: string; bindingPath: ArgumentBindingPath };

function collectRenderedParameterBindingPaths(fn: ts.FunctionLikeDeclaration): RenderedParameterBinding[] {
  const paramNames = new Set<string>();
  for (const parameter of fn.parameters) {
    for (const name of bindingPatternLocalNames(parameter.name)) {
      paramNames.add(name);
    }
  }
  const rendered: RenderedParameterBinding[] = [];
  const seen = new Set<string>();
  const body = fn.body;
  if (body === undefined) return rendered;
  const sourceFile = fn.getSourceFile();

  function noteBindingPath(paramName: string, bindingPath: ArgumentBindingPath): void {
    const key = `${paramName}\0${bindingPath.map((segment) => `${segment.kind}:${"key" in segment ? segment.key : segment.index}`).join("\0")}`;
    if (seen.has(key)) return;
    seen.add(key);
    rendered.push({ paramName, bindingPath });
  }

  const renderedLocalSources = new Map<string, { paramName: string; bindingPath: ArgumentBindingPath }>();

  function renderedBindingForExpression(
    expression: ts.Expression,
  ): { paramName: string; bindingPath: ArgumentBindingPath } | null {
    expression = unwrapExpression(expression);
    for (const paramName of paramNames) {
      if (ts.isIdentifier(expression) && expression.text === paramName) {
        return { paramName, bindingPath: [] };
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const chain = propertyAccessMemberKeys(expression);
        if (chain !== null && chain.objectName === paramName) {
          if (chain.memberKeys.some((member) => NON_MESSAGE_PARAMETER_MEMBERS.has(member))) return null;
          return {
            paramName,
            bindingPath: chain.memberKeys.map((key) => ({ kind: "property" as const, key })),
          };
        }
      }
      if (ts.isCallExpression(expression)) {
        const callee = expression.expression;
        if (ts.isPropertyAccessExpression(callee)) {
          const chain = propertyAccessMemberKeys(callee);
          if (chain !== null && chain.objectName === paramName) {
            if (chain.memberKeys.some((member) => NON_MESSAGE_PARAMETER_MEMBERS.has(member))) return null;
            return {
              paramName,
              bindingPath: chain.memberKeys.map((key) => ({ kind: "property" as const, key })),
            };
          }
        }
      }
      const elementAccessChain = ts.isElementAccessExpression(expression) ? renderedMemberChain(expression) : null;
      if (elementAccessChain !== null && elementAccessChain.objectName === paramName) {
        if (elementAccessChain.memberKeys.some((member) => NON_MESSAGE_PARAMETER_MEMBERS.has(member))) return null;
        return {
          paramName,
          bindingPath: elementAccessChain.memberKeys.map((key) => ({ kind: "property" as const, key })),
        };
      }
    }
    return null;
  }

  function noteInExpression(expression: ts.Expression): void {
    expression = unwrapExpression(expression);
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        if (ts.isSpreadElement(element)) {
          noteInExpression(element.expression);
        } else if (ts.isExpression(element)) {
          noteInExpression(element);
        }
      }
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      noteInExpression(expression.whenTrue);
      noteInExpression(expression.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(expression)) {
      const kind = expression.operatorToken.kind;
      if (
        kind === ts.SyntaxKind.PlusToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        noteInExpression(expression.left);
        noteInExpression(expression.right);
        return;
      }
    }
    if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isAsExpression(expression)) {
      noteInExpression(expression.expression);
      return;
    }
    if (ts.isSatisfiesExpression(expression)) {
      noteInExpression(expression.expression);
      return;
    }
    if (ts.isTemplateExpression(expression)) {
      for (const span of expression.templateSpans) {
        noteInExpression(span.expression);
      }
      return;
    }
    for (const paramName of paramNames) {
      if (ts.isIdentifier(expression) && expression.text === paramName) {
        noteBindingPath(paramName, []);
        continue;
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const chain = propertyAccessMemberKeys(expression);
        if (chain !== null && chain.objectName === paramName) {
          if (!chain.memberKeys.some((member) => NON_MESSAGE_PARAMETER_MEMBERS.has(member))) {
            noteBindingPath(
              paramName,
              chain.memberKeys.map((key) => ({ kind: "property" as const, key })),
            );
          }
        }
        continue;
      }
      if (ts.isCallExpression(expression)) {
        if (ts.isIdentifier(expression.expression) && expression.arguments.length > 0) {
          const firstArg = expression.arguments[0];
          if (ts.isIdentifier(firstArg) && firstArg.text === paramName) {
            const nestedCallee = resolveCallableFunctionLike(expression.expression.text, sourceFile);
            if (nestedCallee !== undefined) {
              const nestedParamName = parameterLocalNameAt(nestedCallee.parameters, 0);
              if (nestedParamName !== null) {
                for (const nested of collectRenderedParameterBindingPaths(nestedCallee)) {
                  if (nested.paramName === nestedParamName) {
                    noteBindingPath(paramName, nested.bindingPath);
                  }
                }
              }
            }
          }
        }
        const callee = expression.expression;
        if (ts.isPropertyAccessExpression(callee)) {
          const chain = propertyAccessMemberKeys(callee);
          if (chain !== null && chain.objectName === paramName) {
            if (!chain.memberKeys.some((member) => NON_MESSAGE_PARAMETER_MEMBERS.has(member))) {
              noteBindingPath(
                paramName,
                chain.memberKeys.map((key) => ({ kind: "property" as const, key })),
              );
            }
          }
        }
        continue;
      }
      if (ts.isElementAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === paramName) {
        const index = elementAccessIndexFromArgument(expression.argumentExpression);
        if (index !== null) {
          noteBindingPath(paramName, [{ kind: "index", index }]);
          continue;
        }
        const argument = expression.argumentExpression;
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
          if (!NON_MESSAGE_PARAMETER_MEMBERS.has(argument.text)) {
            noteBindingPath(paramName, [{ kind: "property", key: argument.text }]);
          }
          continue;
        }
      }
      const elementAccessChain = ts.isElementAccessExpression(expression) ? renderedMemberChain(expression) : null;
      if (elementAccessChain !== null && elementAccessChain.objectName === paramName) {
        if (!elementAccessChain.memberKeys.some((member) => NON_MESSAGE_PARAMETER_MEMBERS.has(member))) {
          noteBindingPath(
            paramName,
            elementAccessChain.memberKeys.map((key) => ({ kind: "property" as const, key })),
          );
        }
        continue;
      }
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (declaration.initializer === undefined) continue;
        if (ts.isIdentifier(declaration.name)) {
          const source = renderedBindingForExpression(declaration.initializer);
          if (source !== null) {
            renderedLocalSources.set(declaration.name.text, source);
          }
          continue;
        }
        if (ts.isObjectBindingPattern(declaration.name) && ts.isIdentifier(declaration.initializer)) {
          const paramName = declaration.initializer.text;
          if (!paramNames.has(paramName)) continue;
          for (const element of declaration.name.elements) {
            const localName = bindingElementLocalName(element);
            const objectKey = bindingElementObjectKey(element, sourceFile);
            if (localName === null || objectKey === null) continue;
            renderedLocalSources.set(localName, {
              paramName,
              bindingPath: [{ kind: "property", key: objectKey }],
            });
          }
        }
      }
    }
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      const returned = unwrapExpression(node.expression);
      if (ts.isIdentifier(returned)) {
        const source = renderedLocalSources.get(returned.text);
        if (source !== null && source !== undefined) {
          noteBindingPath(source.paramName, source.bindingPath);
        }
      }
      noteInExpression(node.expression);
    }
    if (ts.isCallExpression(node) && isCreateElementCall(node)) {
      for (let index = 2; index < node.arguments.length; index++) {
        const argument = node.arguments[index];
        if (ts.isSpreadElement(argument)) {
          noteInExpression(argument.expression);
        } else if (ts.isExpression(argument)) {
          noteInExpression(argument);
        }
      }
      const propsArg = node.arguments[1];
      if (propsArg !== undefined && ts.isObjectLiteralExpression(propsArg)) {
        for (const property of propsArg.properties) {
          if (ts.isShorthandPropertyAssignment(property)) {
            if (isMessageCreateElementProperty(property.name.text)) {
              noteInExpression(property.name);
            }
            continue;
          }
          if (ts.isPropertyAssignment(property)) {
            const propertyName = objectLiteralElementName(property, sourceFile);
            if (propertyName !== null && isMessageCreateElementProperty(propertyName)) {
              noteInExpression(property.initializer);
            }
          }
        }
      }
    }
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const parent = node.parent;
      if (parent === undefined || !ts.isJsxAttribute(parent)) {
        noteInExpression(node.expression);
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isJsxExpression(node.initializer)) {
      const attrName = jsxAttributeName(node);
      if (!NON_COPY_JSX_ATTRS.has(attrName) && attrName !== "id" && node.initializer.expression !== undefined) {
        noteInExpression(node.initializer.expression);
      }
    }
    ts.forEachChild(node, visit);
  }

  if (ts.isBlock(body)) visit(body);
  else visit(body);
  return rendered;
}

function functionLikeDeclarationName(fn: ts.FunctionLikeDeclaration): string | null {
  if (ts.isFunctionDeclaration(fn) && fn.name !== undefined) return fn.name.text;
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) return fn.name.text;
  return null;
}

function localInitializerInScope(name: string, from: ts.Node): ts.Expression | undefined {
  let current: ts.Node | undefined = from;
  while (current !== undefined) {
    if (ts.isBlock(current) || ts.isSourceFile(current)) {
      for (const statement of current.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer !== undefined) {
            return declaration.initializer;
          }
        }
      }
    }
    current = current.parent;
  }
  return undefined;
}

function enclosingFunctionParameters(from: ts.Node): ts.ParameterDeclaration[] {
  const merged: ts.ParameterDeclaration[] = [];
  let current: ts.Node | undefined = from.parent;
  while (current !== undefined) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      (ts.isMethodDeclaration(current) && current.body !== undefined)
    ) {
      merged.push(...current.parameters);
    }
    current = current.parent;
  }
  return merged;
}

function collectCallSiteParameterInitializers(
  sourceFile: ts.SourceFile,
): { initializers: Map<string, Map<string, ts.Expression>>; parameterContexts: Map<string, ts.ParameterDeclaration[]> } {
  const initializers = new Map<string, Map<string, ts.Expression>>();
  const parameterContexts = new Map<string, ts.ParameterDeclaration[]>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const calleeExpr = unwrapExpression(node.expression);
      if (!ts.isIdentifier(calleeExpr)) {
        ts.forEachChild(node, visit);
        return;
      }
      const callee = resolveCallableFunctionLike(calleeExpr.text, sourceFile);
      if (callee !== undefined) {
        for (let index = 0; index < callee.parameters.length; index++) {
          const parameter = callee.parameters[index];
          const argument = node.arguments[index];
          if (argument === undefined || !ts.isExpression(argument)) continue;
          if (!ts.isIdentifier(parameter.name)) continue;
          const paramName = parameter.name.text;
          let argumentValue: ts.Expression | undefined;
          const unwrappedArgument = unwrapExpression(argument);
          if (ts.isArrayLiteralExpression(unwrappedArgument)) {
            argumentValue = argument;
          } else if (ts.isObjectLiteralExpression(unwrappedArgument)) {
            const seedsCallSite = unwrappedArgument.properties.some((property) => {
              if (ts.isShorthandPropertyAssignment(property)) return true;
              if (ts.isSpreadAssignment(property)) return true;
              return ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer);
            });
            if (!seedsCallSite) continue;
            argumentValue = argument;
          } else if (ts.isIdentifier(unwrappedArgument)) {
            const localInit = localInitializerInScope(unwrappedArgument.text, node);
            if (localInit === undefined) continue;
            const unwrappedInit = unwrapExpression(localInit);
            if (!ts.isObjectLiteralExpression(unwrappedInit) && !ts.isArrayLiteralExpression(unwrappedInit)) continue;
            argumentValue = localInit;
          } else {
            continue;
          }
          let fnMap = initializers.get(calleeExpr.text);
          if (fnMap === undefined) {
            fnMap = new Map<string, ts.Expression>();
            initializers.set(calleeExpr.text, fnMap);
          }
          fnMap.set(paramName, argumentValue);
          parameterContexts.set(calleeExpr.text, enclosingFunctionParameters(node));
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { initializers, parameterContexts };
}

function functionBodyReturnObjectLiteral(
  fn: ts.FunctionLikeDeclaration,
): ts.ObjectLiteralExpression | undefined {
  const body = fn.body;
  if (body === undefined) return undefined;
  if (!ts.isBlock(body)) {
    const unwrapped = unwrapExpression(body);
    return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
  }
  for (const statement of body.statements) {
    if (!ts.isReturnStatement(statement) || statement.expression === undefined) continue;
    const unwrapped = unwrapExpression(statement.expression);
    if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped;
  }
  return undefined;
}

function functionBodyReturnArrayLiteral(
  fn: ts.FunctionLikeDeclaration,
): ts.ArrayLiteralExpression | undefined {
  const body = fn.body;
  if (body === undefined) return undefined;
  if (!ts.isBlock(body)) {
    const unwrapped = unwrapExpression(body);
    return ts.isArrayLiteralExpression(unwrapped) ? unwrapped : undefined;
  }
  for (const statement of body.statements) {
    if (!ts.isReturnStatement(statement) || statement.expression === undefined) continue;
    const unwrapped = unwrapExpression(statement.expression);
    if (ts.isArrayLiteralExpression(unwrapped)) return unwrapped;
  }
  return undefined;
}

function callableReturnArrayElementInitializer(
  call: ts.CallExpression,
  index: number,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  const callee = unwrapExpression(call.expression);
  if (!ts.isIdentifier(callee)) return undefined;
  const fn = resolveCallableFunctionLike(callee.text, sourceFile);
  if (fn === undefined) return undefined;
  const array = functionBodyReturnArrayLiteral(fn);
  if (array === undefined) return undefined;
  const entry = array.elements[index];
  return entry !== undefined && ts.isExpression(entry) ? entry : undefined;
}

function callableReturnObjectMemberInitializer(
  call: ts.CallExpression,
  memberKey: string,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  const callee = unwrapExpression(call.expression);
  if (!ts.isIdentifier(callee)) return undefined;
  const fn = resolveCallableFunctionLike(callee.text, sourceFile);
  if (fn === undefined) return undefined;
  const object = functionBodyReturnObjectLiteral(fn);
  if (object === undefined) return undefined;
  return objectLiteralPropertyInitializer(object, memberKey, sourceFile);
}

function resolveCallableFunctionLike(
  calleeName: string,
  sourceFile: ts.SourceFile,
  visited: Set<string> = new Set(),
): ts.FunctionLikeDeclaration | undefined {
  if (visited.has(calleeName)) return undefined;
  visited.add(calleeName);
  let found: ts.FunctionLikeDeclaration | undefined;
  function visit(node: ts.Node): void {
    if (found !== undefined) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === calleeName && node.body !== undefined) {
      found = node;
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== calleeName) continue;
        if (declaration.initializer === undefined) continue;
        const init = declaration.initializer;
        if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body !== undefined) {
          found = init;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (found === undefined) {
    let aliasInit: ts.Expression | undefined;
    function visitAlias(node: ts.Node): void {
      if (aliasInit !== undefined) return;
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== calleeName) continue;
          if (declaration.initializer === undefined) continue;
          aliasInit = declaration.initializer;
          return;
        }
      }
      ts.forEachChild(node, visitAlias);
    }
    visitAlias(sourceFile);
    if (aliasInit !== undefined) {
      const unwrappedAlias = unwrapExpression(aliasInit);
      if (ts.isIdentifier(unwrappedAlias)) {
        found = resolveCallableFunctionLike(unwrappedAlias.text, sourceFile, visited);
      } else if (
        (ts.isArrowFunction(unwrappedAlias) || ts.isFunctionExpression(unwrappedAlias)) &&
        unwrappedAlias.body !== undefined
      ) {
        found = unwrappedAlias;
      }
    }
  }
  return found;
}

function resolveCallableParameters(calleeName: string, sourceFile: ts.SourceFile): ts.ParameterDeclaration[] | undefined {
  return resolveCallableFunctionLike(calleeName, sourceFile)?.parameters;
}

function parameterLocalNameAt(parameters: ts.ParameterDeclaration[], index: number): string | null {
  const param = parameters[index];
  if (param === undefined) return null;
  if (ts.isIdentifier(param.name)) return param.name.text;
  const names = bindingPatternLocalNames(param.name);
  return names[0] ?? null;
}

function parameterDefaultInitializerForLocalName(
  localName: string,
  parameters: ts.ParameterDeclaration[],
): ts.Expression | undefined {
  for (const paramDecl of parameters) {
    if (ts.isIdentifier(paramDecl.name)) {
      if (paramDecl.name.text === localName) return paramDecl.initializer;
      continue;
    }
    if (ts.isObjectBindingPattern(paramDecl.name)) {
      for (const element of paramDecl.name.elements) {
        if (bindingElementLocalName(element) === localName) return element.initializer;
      }
    }
  }
  return undefined;
}

function directArgumentRenderSlices(expression: ts.Expression): ts.Expression[] {
  expression = unwrapExpression(expression);
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return [
        ...directArgumentRenderSlices(expression.left),
        ...directArgumentRenderSlices(expression.right),
      ];
    }
  }
  return [expression];
}

function indirectCallRendersArgument(
  call: ts.CallExpression,
  argIndex: number,
  argument: ts.Expression,
  sourceFile: ts.SourceFile,
  currentParameters: ts.ParameterDeclaration[] | undefined,
  parameterSearchParameters: ts.ParameterDeclaration[],
  literalLocalInitializers: Map<string, ts.Expression>,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  moduleDirectStringAliases: Map<string, string>,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): boolean {
  if (isCreateElementCall(call)) return argIndex >= 2;
  const calleeExpr = unwrapExpression(call.expression);
  if (!ts.isIdentifier(calleeExpr)) return false;
  const calleeName = calleeExpr.text;
  if (INDIRECT_CALL_BUILTIN_CALLEES.has(calleeName)) return false;
  if (isComponentIdentifier(calleeName)) return true;
  let resolvedCalleeName = calleeName;
  if (currentParameters !== undefined) {
    const defaultInit = parameterDefaultInitializerForLocalName(calleeName, currentParameters);
    if (defaultInit !== undefined) {
      const init = unwrapExpression(defaultInit);
      if (ts.isIdentifier(init)) {
        resolvedCalleeName = init.text;
      }
    }
  }
  const callee = resolveCallableFunctionLike(resolvedCalleeName, sourceFile);
  if (callee === undefined) return false;
  const param = callee.parameters[argIndex];
  if (param === undefined) return false;
  const boundLocals = bindingPatternLocalNames(param.name);
  if (boundLocals.length === 0) return false;
  const renderedBindings = collectRenderedParameterBindingPaths(callee);
  let argumentValue = argument;
  const unwrappedArgument = unwrapExpression(argument);
  if (ts.isIdentifier(unwrappedArgument)) {
    const localInit = literalLocalInitializers.get(unwrappedArgument.text);
    if (localInit !== undefined) {
      argumentValue = localInit;
    } else if (currentParameters !== undefined) {
      const defaultInit = parameterDefaultExpressionForName(
        unwrappedArgument.text,
        currentParameters,
        sourceFile,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
      if (defaultInit !== undefined) {
        argumentValue = defaultInit;
      }
    }
  }
  for (const { paramName, bindingPath: renderedPath } of renderedBindings) {
    if (!boundLocals.includes(paramName)) continue;
    const paramBindingPath = findArgumentBindingPath(param.name, paramName, sourceFile);
    if (paramBindingPath === null) continue;
    const slicePath = renderedPath.length > 0 ? [...paramBindingPath, ...renderedPath] : paramBindingPath;
    const slices =
      slicePath.length === 0
        ? directArgumentRenderSlices(argumentValue)
        : expressionSlicesAtArgumentBindingPath(
            argumentValue,
            slicePath,
            sourceFile,
            parameterSearchParameters,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
          );
    if (
      slices.some((slice) =>
        parameterDefaultIsShippedCopy(
          slice,
          moduleBindings,
          moduleFunctions,
          moduleDirectStringFunctions,
          moduleDirectStringAliases,
        ) ||
        (ts.isIdentifier(unwrapExpression(slice)) &&
          parameterDefaultExpressionForName(
            unwrapExpression(slice).text,
            parameterSearchParameters,
            sourceFile,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
          ) !== undefined &&
          parameterDefaultIsShippedCopy(
            parameterDefaultExpressionForName(
              unwrapExpression(slice).text,
              parameterSearchParameters,
              sourceFile,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
            )!,
            moduleBindings,
            moduleFunctions,
            moduleDirectStringFunctions,
            moduleDirectStringAliases,
          )),
      )
    ) {
      return true;
    }
  }
  return false;
}

function collectModuleDirectStringFunctionAliases(sourceFile: ts.SourceFile): Map<string, string> {
  const moduleDirectStringFunctions = collectModuleDirectStringShippedFunctions(sourceFile);
  const aliases = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const init = unwrapExpression(declaration.initializer);
      if (ts.isIdentifier(init) && moduleDirectStringFunctions.has(init.text)) {
        aliases.set(declaration.name.text, init.text);
      }
    }
  }
  return aliases;
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

function moduleInitializerIsDirectStringHelper(initializer: ts.Expression): boolean {
  initializer = unwrapExpression(initializer);
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return functionBodyReturnsDirectStringShippedCopy(initializer);
  }
  if (ts.isCallExpression(initializer) && initializer.arguments.length === 0) {
    const callee = unwrapExpression(initializer.expression);
    if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
      return functionBodyReturnsDirectStringShippedCopy(callee);
    }
  }
  return false;
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
      if (moduleInitializerIsDirectStringHelper(declaration.initializer)) {
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
  moduleDirectStringFunctions: Set<string>,
  moduleDirectStringAliases: Map<string, string>,
): boolean {
  const literal = staticLiteral(initializer);
  if (literal !== null && ARIA_STATE_TOKENS.has(literal)) return false;
  if (localInitializerIsShippedCopy(initializer)) return true;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return functionBodyReturnsShippedCopy(initializer);
  }
  const unwrapped = unwrapExpression(initializer);
  return (
    ts.isIdentifier(unwrapped) &&
    (moduleBindings.has(unwrapped.text) ||
      moduleFunctions.has(unwrapped.text) ||
      moduleDirectStringFunctions.has(unwrapped.text) ||
      moduleDirectStringAliases.has(unwrapped.text))
  );
}

function bindingElementPropertyName(element: ts.BindingElement, source: ts.SourceFile): string | null {
  if (element.propertyName !== undefined) return element.propertyName.getText(source);
  if (ts.isIdentifier(element.name)) return element.name.text;
  return null;
}

function bindingElementObjectKey(element: ts.BindingElement, source: ts.SourceFile): string | null {
  if (element.propertyName === undefined) {
    return ts.isIdentifier(element.name) ? element.name.text : null;
  }
  if (ts.isIdentifier(element.propertyName)) return element.propertyName.text;
  if (ts.isStringLiteral(element.propertyName) || ts.isNoSubstitutionTemplateLiteral(element.propertyName)) {
    return element.propertyName.text;
  }
  if (ts.isComputedPropertyName(element.propertyName)) {
    const literal = staticLiteral(unwrapExpression(element.propertyName.expression));
    if (literal !== null) return literal;
  }
  return element.propertyName.getText(source);
}

function bindingElementLocalName(element: ts.BindingElement): string | null {
  if (ts.isIdentifier(element.name)) return element.name.text;
  return null;
}

type ArgumentBindingPath = Array<{ kind: "property"; key: string } | { kind: "index"; index: number }>;

function findArgumentBindingPath(
  pattern: ts.BindingName,
  localName: string,
  source: ts.SourceFile,
  path: ArgumentBindingPath = [],
): ArgumentBindingPath | null {
  if (ts.isIdentifier(pattern)) {
    return pattern.text === localName ? path : null;
  }
  if (ts.isObjectBindingPattern(pattern)) {
    for (const element of pattern.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const key = bindingElementObjectKey(element, source);
      if (key === null) continue;
      const found = findArgumentBindingPath(element.name, localName, source, [
        ...path,
        { kind: "property", key },
      ]);
      if (found !== null) return found;
    }
    return null;
  }
  if (ts.isArrayBindingPattern(pattern)) {
    let index = 0;
    for (const element of pattern.elements) {
      if (ts.isOmittedExpression(element)) {
        index++;
        continue;
      }
      const found = findArgumentBindingPath(element.name, localName, source, [
        ...path,
        { kind: "index", index },
      ]);
      if (found !== null) return found;
      index++;
    }
    return null;
  }
  return null;
}

function expressionSlicesAtArgumentBindingPath(
  expression: ts.Expression,
  bindingPath: ArgumentBindingPath,
  source: ts.SourceFile,
  parameters: ts.ParameterDeclaration[],
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): ts.Expression[] {
  expression = unwrapExpression(
    resolveModulePatternDefault(expression, moduleMessageObjectInitializers, moduleMessageArrayInitializers),
  );
  if (ts.isIdentifier(expression)) {
    const fromParam = parameterDefaultExpressionForName(
      expression.text,
      parameters,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
    if (fromParam !== undefined) {
      return expressionSlicesAtArgumentBindingPath(
        fromParam,
        bindingPath,
        source,
        parameters,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
    }
    return [];
  }
  if (bindingPath.length === 0) {
    return [expression];
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...expressionSlicesAtArgumentBindingPath(
        expression.whenTrue,
        bindingPath,
        source,
        parameters,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      ),
      ...expressionSlicesAtArgumentBindingPath(
        expression.whenFalse,
        bindingPath,
        source,
        parameters,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      ),
    ];
  }
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return [
        ...expressionSlicesAtArgumentBindingPath(
          expression.left,
          bindingPath,
          source,
          parameters,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
        ),
        ...expressionSlicesAtArgumentBindingPath(
          expression.right,
          bindingPath,
          source,
          parameters,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
        ),
      ];
    }
  }
  const [segment, ...rest] = bindingPath;
  if (segment.kind === "property") {
    if (ts.isIdentifier(expression)) {
      const fromParam = parameterDefaultExpressionForName(
        expression.text,
        parameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
      if (fromParam === undefined) return [];
      return expressionSlicesAtArgumentBindingPath(
        fromParam,
        bindingPath,
        source,
        parameters,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
    }
    if (!ts.isObjectLiteralExpression(expression)) return [];
    const next = objectLiteralMemberInitializer(
      expression,
      segment.key,
      source,
      parameters,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
    if (next === undefined) return [];
    return expressionSlicesAtArgumentBindingPath(
      next,
      rest,
      source,
      parameters,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
  }
  if (!ts.isArrayLiteralExpression(expression)) return [];
  const entry = expression.elements[segment.index];
  if (entry === undefined || !ts.isExpression(entry)) return [];
  return expressionSlicesAtArgumentBindingPath(
    entry,
    rest,
    source,
    parameters,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
  );
}

function parameterDefaultExpressionForName(
  name: string,
  parameters: ts.ParameterDeclaration[],
  source: ts.SourceFile,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): ts.Expression | undefined {
  for (const param of parameters) {
    if (ts.isIdentifier(param.name)) {
      if (param.name.text === name) return param.initializer;
      continue;
    }
    if (!bindingPatternLocalNames(param.name).includes(name)) continue;
    if (ts.isObjectBindingPattern(param.name)) {
      const resolvedParamDefault =
        param.initializer !== undefined
          ? resolveModulePatternDefault(
              param.initializer,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
            )
          : undefined;
      const defaultObject =
        resolvedParamDefault !== undefined && ts.isObjectLiteralExpression(unwrapExpression(resolvedParamDefault))
          ? (unwrapExpression(resolvedParamDefault) as ts.ObjectLiteralExpression)
          : undefined;
      for (const element of param.name.elements) {
        const localName = bindingElementLocalName(element);
        if (localName !== name) continue;
        if (element.initializer !== undefined) return element.initializer;
        const objectKey = bindingElementObjectKey(element, source);
        if (defaultObject !== undefined && objectKey !== null) {
          return objectLiteralPropertyInitializer(defaultObject, objectKey, source);
        }
      }
    }
    return param.initializer;
  }
  return undefined;
}

function leadingTriviaHasDefaultTag(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const fullStart = node.getFullStart();
  const start = node.getStart(sourceFile, false);
  if (fullStart >= start) return false;
  return /@default\b/u.test(sourceFile.text.slice(fullStart, start));
}

function hasDefaultJSDocTag(node: ts.Node): boolean {
  return (
    ts.getJSDocTags(node).some((tag) => tag.tagName.text === "default") ||
    leadingTriviaHasDefaultTag(node, node.getSourceFile())
  );
}

function parameterTypeInterfaceName(parameter: ts.ParameterDeclaration): string | null {
  if (parameter.type === undefined || !ts.isTypeReferenceNode(parameter.type)) return null;
  const typeName = parameter.type.typeName;
  return ts.isIdentifier(typeName) ? typeName.text : null;
}

function findInterfaceDeclaration(
  sourceFile: ts.SourceFile,
  interfaceName: string,
): ts.InterfaceDeclaration | undefined {
  let found: ts.InterfaceDeclaration | undefined;
  function visit(node: ts.Node): void {
    if (found !== undefined) return;
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function interfacePropertyKey(member: ts.PropertySignature, source: ts.SourceFile): string | null {
  if (member.name === undefined) return null;
  if (ts.isIdentifier(member.name)) return member.name.text;
  if (ts.isStringLiteral(member.name) || ts.isNoSubstitutionTemplateLiteral(member.name)) {
    return member.name.text;
  }
  if (ts.isComputedPropertyName(member.name)) {
    const literal = staticLiteral(unwrapExpression(member.name.expression));
    if (literal !== null) return literal;
  }
  return member.name.getText(source);
}

function interfacePropertyHasDefaultTag(
  sourceFile: ts.SourceFile,
  interfaceName: string,
  propertyName: string,
): boolean {
  const iface = findInterfaceDeclaration(sourceFile, interfaceName);
  if (iface === undefined) return false;
  for (const member of iface.members) {
    if (!ts.isPropertySignature(member)) continue;
    const memberKey = interfacePropertyKey(member, sourceFile);
    if (memberKey === null || memberKey !== propertyName) continue;
    return hasDefaultJSDocTag(member);
  }
  return false;
}

function collectReferencedInterfaceNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)
    ) {
      for (const parameter of node.parameters) {
        const interfaceName = parameterTypeInterfaceName(parameter);
        if (interfaceName !== null) names.add(interfaceName);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function bindingHasDocumentedDefault(
  parameter: ts.ParameterDeclaration,
  bindingElement: ts.BindingElement | undefined,
  source: ts.SourceFile,
): boolean {
  if (bindingElement !== undefined && hasDefaultJSDocTag(bindingElement)) return true;
  if (bindingElement === undefined && hasDefaultJSDocTag(parameter)) return true;
  if (
    bindingElement === undefined &&
    ts.isIdentifier(parameter.name) &&
    hasDefaultJSDocTag(parameter.name)
  ) {
    return true;
  }
  const objectKey =
    bindingElement !== undefined
      ? (bindingElementObjectKey(bindingElement, source) ?? bindingElementPropertyName(bindingElement, source))
      : ts.isIdentifier(parameter.name)
        ? parameter.name.text
        : null;
  const interfaceName = parameterTypeInterfaceName(parameter);
  if (interfaceName !== null && objectKey !== null) {
    return interfacePropertyHasDefaultTag(source, interfaceName, objectKey);
  }
  return false;
}

function identifierMatchesDocumentedParameter(
  name: string,
  parameters: ts.ParameterDeclaration[],
  source: ts.SourceFile,
): boolean {
  for (const parameter of parameters) {
    if (ts.isIdentifier(parameter.name) && parameter.name.text === name) {
      return bindingHasDocumentedDefault(parameter, undefined, source);
    }
  }
  return false;
}

function collectUndocumentedMessageInterfaceProps(sourceFile: ts.SourceFile): Set<string> {
  const referencedInterfaces = collectReferencedInterfaceNames(sourceFile);
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node)) {
      if (!referencedInterfaces.has(node.name.text)) return;
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const propName = interfacePropertyKey(member, sourceFile);
        if (propName === null) continue;
        if (
          MESSAGE_JSX_ATTRS.has(propName) &&
          !interfacePropertyHasDefaultTag(sourceFile, node.name.text, propName)
        ) {
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
      if (ts.isSpreadAssignment(property)) return localInitializerIsShippedCopy(property.expression);
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

function memberAccessFromCallCallee(expression: ts.Expression): ts.PropertyAccessExpression | ts.ElementAccessExpression | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return unwrapped;
  }
  return null;
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
    return;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    if (returnExpressionIsDirectStringShippedCopy(expression)) {
      const left = staticLiteral(unwrapExpression(expression.left));
      const right = staticLiteral(unwrapExpression(expression.right));
      if (left !== null && right !== null) {
        out.push(left + right);
      }
    }
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

function objectLiteralElementName(element: ts.ObjectLiteralElementLike, source: ts.SourceFile): string | null {
  if (ts.isSpreadAssignment(element)) return null;
  const { name } = element;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const literal = staticLiteral(unwrapExpression(name.expression));
    if (literal !== null) return literal;
  }
  return name.getText(source);
}

function objectLiteralPropertyInitializer(
  object: ts.ObjectLiteralExpression,
  propName: string,
  source: ts.SourceFile,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const nameText = objectLiteralElementName(property, source);
    if (nameText === propName) return property.initializer;
  }
  return undefined;
}

function objectLiteralMemberInitializer(
  object: ts.ObjectLiteralExpression,
  propName: string,
  source: ts.SourceFile,
  parameters: ts.ParameterDeclaration[],
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === propName) {
      return parameterDefaultExpressionForName(
        property.name.text,
        parameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
    }
  }
  return objectLiteralPropertyInitializer(object, propName, source);
}

function collectParameterLiteralDefaults(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  source: ts.SourceFile,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  moduleDirectStringAliases: Map<string, string>,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): Map<string, number> {
  const literalParams = new Map<string, number>();

  function noteBindingDefault(
    parameter: ts.ParameterDeclaration,
    bindingElement: ts.BindingElement | undefined,
    propName: string,
    localName: string,
    initializer: ts.Expression,
    line: number,
  ): void {
    if (bindingHasDocumentedDefault(parameter, bindingElement, source)) return;
    if (
      !parameterDefaultIsShippedCopy(
        initializer,
        moduleBindings,
        moduleFunctions,
        moduleDirectStringFunctions,
        moduleDirectStringAliases,
      )
    ) {
      return;
    }
    literalParams.set(localName, line);
  }

  function walkBindingPattern(
    parameter: ts.ParameterDeclaration,
    pattern: ts.ObjectBindingPattern,
    line: number,
    defaultExpr?: ts.Expression,
  ): void {
    if (defaultExpr !== undefined) {
      defaultExpr = resolveModulePatternDefault(
        defaultExpr,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
    }
    const defaultObject =
      defaultExpr !== undefined && ts.isObjectLiteralExpression(unwrapExpression(defaultExpr))
        ? (unwrapExpression(defaultExpr) as ts.ObjectLiteralExpression)
        : undefined;

    for (const element of pattern.elements) {
      if (ts.isObjectBindingPattern(element.name)) {
        const nestedObjectKey =
          element.propertyName !== undefined ? bindingElementObjectKey(element, source) : null;
        const nestedDefault =
          element.initializer ??
          (defaultObject !== undefined && nestedObjectKey !== null
            ? objectLiteralPropertyInitializer(defaultObject, nestedObjectKey, source)
            : undefined);
        if (nestedDefault !== undefined) {
          walkBindingPattern(parameter, element.name, line, nestedDefault);
        } else {
          walkBindingPattern(parameter, element.name, line);
        }
        continue;
      }
      if (ts.isArrayBindingPattern(element.name)) {
        const propNameForNested =
          element.propertyName !== undefined ? bindingElementObjectKey(element, source) : null;
        const nestedDefault =
          element.initializer ??
          (defaultObject !== undefined && propNameForNested !== null
            ? objectLiteralPropertyInitializer(defaultObject, propNameForNested, source)
            : undefined);
        walkArrayBindingPattern(parameter, element.name, line, defaultObject, element, nestedDefault);
        continue;
      }
      const propName = bindingElementPropertyName(element, source);
      const objectKey = bindingElementObjectKey(element, source);
      const localName = bindingElementLocalName(element);
      if (propName === null || localName === null || objectKey === null) continue;
      const initializer =
        element.initializer ??
        (defaultObject !== undefined ? objectLiteralPropertyInitializer(defaultObject, objectKey, source) : undefined);
      if (initializer === undefined) continue;
      noteBindingDefault(parameter, element, propName, localName, initializer, line);
    }
  }

  function walkArrayBindingPattern(
    parameter: ts.ParameterDeclaration,
    pattern: ts.ArrayBindingPattern,
    line: number,
    defaultObject?: ts.ObjectLiteralExpression,
    parentElement?: ts.BindingElement,
    parameterDefault?: ts.Expression,
  ): void {
    for (const element of pattern.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (ts.isObjectBindingPattern(element.name)) {
        const index = pattern.elements.indexOf(element);
        let nestedDefault = element.initializer;
        if (nestedDefault === undefined) {
          nestedDefault = arrayDefaultEntryAtIndex(
            parameterDefault,
            index,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
          );
        }
        if (nestedDefault !== undefined) {
          walkBindingPattern(parameter, element.name, line, nestedDefault);
        } else {
          walkBindingPattern(parameter, element.name, line);
        }
        continue;
      }
      if (ts.isArrayBindingPattern(element.name)) {
        const index = pattern.elements.indexOf(element);
        let childDefault = element.initializer;
        if (childDefault === undefined) {
          childDefault = arrayDefaultEntryAtIndex(
            parameterDefault,
            index,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
          );
        }
        walkArrayBindingPattern(parameter, element.name, line, defaultObject, element, childDefault);
        continue;
      }
      const propName = bindingElementPropertyName(element, source);
      const localName = bindingElementLocalName(element);
      if (localName === null) continue;
      const resolvedPropName = propName ?? localName;
      let initializer = element.initializer;
      if (initializer === undefined && parentElement?.initializer !== undefined) {
        const parentArray = unwrapExpression(parentElement.initializer);
        if (ts.isArrayLiteralExpression(parentArray)) {
          const index = pattern.elements.indexOf(element);
          const entry = parentArray.elements[index];
          if (entry !== undefined && ts.isExpression(entry)) {
            initializer = entry;
          }
        }
      }
      if (initializer === undefined && parameterDefault !== undefined) {
        const index = pattern.elements.indexOf(element);
        const entry = arrayDefaultEntryAtIndex(
          parameterDefault,
          index,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
        );
        if (entry !== undefined) {
          initializer = entry;
        }
      }
      if (
        initializer === undefined &&
        defaultObject !== undefined &&
        parentElement !== undefined &&
        parentElement.propertyName !== undefined
      ) {
        const parentObjectKey = bindingElementObjectKey(parentElement, source);
        const container =
          parentObjectKey !== null
            ? objectLiteralPropertyInitializer(defaultObject, parentObjectKey, source)
            : undefined;
        if (container !== undefined && ts.isArrayLiteralExpression(unwrapExpression(container))) {
          const arrayLiteral = unwrapExpression(container) as ts.ArrayLiteralExpression;
          const index = pattern.elements.indexOf(element);
          const entry = arrayLiteral.elements[index];
          if (entry !== undefined && ts.isExpression(entry)) {
            initializer = entry;
          }
        }
      }
      if (initializer === undefined) continue;
      noteBindingDefault(parameter, element, resolvedPropName, localName, initializer, line);
    }
  }

  for (const parameter of parameters) {
    const line = source.getLineAndCharacterOfPosition(parameter.getStart(source)).line + 1;
    if (ts.isObjectBindingPattern(parameter.name)) {
      const resolvedInit =
        parameter.initializer !== undefined
          ? resolveModulePatternDefault(
              parameter.initializer,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
            )
          : undefined;
      walkBindingPattern(parameter, parameter.name, line, resolvedInit);
      continue;
    }
    if (ts.isArrayBindingPattern(parameter.name)) {
      const resolvedInit =
        parameter.initializer !== undefined
          ? resolveModulePatternDefault(
              parameter.initializer,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
            )
          : undefined;
      walkArrayBindingPattern(parameter, parameter.name, line, undefined, undefined, resolvedInit);
      continue;
    }
    if (ts.isIdentifier(parameter.name) && parameter.initializer !== undefined) {
      noteBindingDefault(parameter, undefined, parameter.name.text, parameter.name.text, parameter.initializer, line);
    }
  }

  return literalParams;
}

function collectMessageCallParameterNames(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  source: ts.SourceFile,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  moduleDirectStringAliases: Map<string, string>,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): Set<string> {
  const names = new Set<string>();

  function noteMessageCallProp(propName: string, initializer: ts.Expression | undefined): void {
    if (initializer === undefined) return;
    if (
      parameterDefaultIsMessageCall(
        initializer,
        moduleFunctions,
        moduleDirectStringFunctions,
        moduleDirectStringAliases,
      )
    ) {
      names.add(propName);
    }
  }

  function walkBindingPattern(pattern: ts.ObjectBindingPattern, defaultExpr?: ts.Expression): void {
    if (defaultExpr !== undefined) {
      defaultExpr = resolveModulePatternDefault(
        defaultExpr,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
    }
    const defaultObject =
      defaultExpr !== undefined && ts.isObjectLiteralExpression(unwrapExpression(defaultExpr))
        ? (unwrapExpression(defaultExpr) as ts.ObjectLiteralExpression)
        : undefined;

    for (const element of pattern.elements) {
      if (ts.isObjectBindingPattern(element.name)) {
        const propNameForNested =
          element.propertyName !== undefined ? bindingElementPropertyName(element, source) : null;
        const nestedDefault =
          element.initializer ??
          (defaultObject !== undefined && propNameForNested !== null
            ? objectLiteralPropertyInitializer(defaultObject, propNameForNested, source)
            : undefined);
        walkBindingPattern(element.name, nestedDefault);
        continue;
      }
      const propName = bindingElementPropertyName(element, source);
      const objectKey = bindingElementObjectKey(element, source);
      if (propName === null || objectKey === null) continue;
      const initializer =
        element.initializer ??
        (defaultObject !== undefined ? objectLiteralPropertyInitializer(defaultObject, objectKey, source) : undefined);
      noteMessageCallProp(propName, initializer);
    }
  }

  for (const parameter of parameters) {
    if (ts.isObjectBindingPattern(parameter.name)) {
      const resolvedInit =
        parameter.initializer !== undefined
          ? resolveModulePatternDefault(
              parameter.initializer,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
            )
          : undefined;
      walkBindingPattern(parameter.name, resolvedInit);
      continue;
    }
    if (ts.isIdentifier(parameter.name) && parameter.initializer !== undefined) {
      noteMessageCallProp(parameter.name.text, parameter.initializer);
    }
  }

  return names;
}

function collectUndocumentedShippedPropNames(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  source: ts.SourceFile,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  moduleDirectStringAliases: Map<string, string>,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): Set<string> {
  const names = new Set<string>();

  function noteShippedProp(
    parameter: ts.ParameterDeclaration,
    bindingElement: ts.BindingElement | undefined,
    propName: string,
    initializer: ts.Expression,
  ): void {
    if (bindingHasDocumentedDefault(parameter, bindingElement, source)) return;
    if (
      parameterDefaultIsShippedCopy(
        initializer,
        moduleBindings,
        moduleFunctions,
        moduleDirectStringFunctions,
        moduleDirectStringAliases,
      )
    ) {
      names.add(propName);
    }
  }

  function walkBindingPattern(
    parameter: ts.ParameterDeclaration,
    pattern: ts.ObjectBindingPattern,
    defaultExpr?: ts.Expression,
  ): void {
    if (defaultExpr !== undefined) {
      defaultExpr = resolveModulePatternDefault(
        defaultExpr,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
    }
    const defaultObject =
      defaultExpr !== undefined && ts.isObjectLiteralExpression(unwrapExpression(defaultExpr))
        ? (unwrapExpression(defaultExpr) as ts.ObjectLiteralExpression)
        : undefined;

    for (const element of pattern.elements) {
      if (ts.isObjectBindingPattern(element.name)) {
        const propNameForNested =
          element.propertyName !== undefined ? bindingElementPropertyName(element, source) : null;
        const nestedDefault =
          element.initializer ??
          (defaultObject !== undefined && propNameForNested !== null
            ? objectLiteralPropertyInitializer(defaultObject, propNameForNested, source)
            : undefined);
        if (nestedDefault !== undefined) {
          walkBindingPattern(parameter, element.name, nestedDefault);
        } else {
          walkBindingPattern(parameter, element.name);
        }
        continue;
      }
      if (ts.isArrayBindingPattern(element.name)) {
        const propNameForNested =
          element.propertyName !== undefined ? bindingElementObjectKey(element, source) : null;
        const nestedDefault =
          element.initializer ??
          (defaultObject !== undefined && propNameForNested !== null
            ? objectLiteralPropertyInitializer(defaultObject, propNameForNested, source)
            : undefined);
        walkArrayBindingPattern(parameter, element.name, defaultObject, element, nestedDefault);
        continue;
      }
      const propName = bindingElementPropertyName(element, source);
      const objectKey = bindingElementObjectKey(element, source);
      if (propName === null || objectKey === null) continue;
      const initializer =
        element.initializer ??
        (defaultObject !== undefined ? objectLiteralPropertyInitializer(defaultObject, objectKey, source) : undefined);
      if (initializer === undefined) continue;
      noteShippedProp(parameter, element, propName, initializer);
    }
  }

  function walkArrayBindingPattern(
    parameter: ts.ParameterDeclaration,
    pattern: ts.ArrayBindingPattern,
    defaultObject?: ts.ObjectLiteralExpression,
    parentElement?: ts.BindingElement,
    parameterDefault?: ts.Expression,
  ): void {
    for (const element of pattern.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (ts.isObjectBindingPattern(element.name)) {
        const index = pattern.elements.indexOf(element);
        let nestedDefault = element.initializer;
        if (nestedDefault === undefined) {
          nestedDefault = arrayDefaultEntryAtIndex(
            parameterDefault,
            index,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
          );
        }
        if (nestedDefault !== undefined) {
          walkBindingPattern(parameter, element.name, nestedDefault);
        } else {
          walkBindingPattern(parameter, element.name);
        }
        continue;
      }
      if (ts.isArrayBindingPattern(element.name)) {
        const index = pattern.elements.indexOf(element);
        let childDefault = element.initializer;
        if (childDefault === undefined) {
          childDefault = arrayDefaultEntryAtIndex(
            parameterDefault,
            index,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
          );
        }
        walkArrayBindingPattern(parameter, element.name, defaultObject, element, childDefault);
        continue;
      }
      const propName = bindingElementPropertyName(element, source);
      const localName = bindingElementLocalName(element);
      if (localName === null) continue;
      const resolvedPropName = propName ?? localName;
      let initializer = element.initializer;
      if (initializer === undefined && parentElement?.initializer !== undefined) {
        const parentArray = unwrapExpression(parentElement.initializer);
        if (ts.isArrayLiteralExpression(parentArray)) {
          const index = pattern.elements.indexOf(element);
          const entry = parentArray.elements[index];
          if (entry !== undefined && ts.isExpression(entry)) {
            initializer = entry;
          }
        }
      }
      if (initializer === undefined && parameterDefault !== undefined) {
        const index = pattern.elements.indexOf(element);
        const entry = arrayDefaultEntryAtIndex(
          parameterDefault,
          index,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
        );
        if (entry !== undefined) {
          initializer = entry;
        }
      }
      if (
        initializer === undefined &&
        defaultObject !== undefined &&
        parentElement !== undefined &&
        parentElement.propertyName !== undefined
      ) {
        const parentObjectKey = bindingElementObjectKey(parentElement, source);
        const container =
          parentObjectKey !== null
            ? objectLiteralPropertyInitializer(defaultObject, parentObjectKey, source)
            : undefined;
        if (container !== undefined && ts.isArrayLiteralExpression(unwrapExpression(container))) {
          const arrayLiteral = unwrapExpression(container) as ts.ArrayLiteralExpression;
          const index = pattern.elements.indexOf(element);
          const entry = arrayLiteral.elements[index];
          if (entry !== undefined && ts.isExpression(entry)) {
            initializer = entry;
          }
        }
      }
      if (initializer === undefined) continue;
      noteShippedProp(parameter, element, resolvedPropName, initializer);
    }
  }

  for (const parameter of parameters) {
    if (ts.isObjectBindingPattern(parameter.name)) {
      const resolvedInit =
        parameter.initializer !== undefined
          ? resolveModulePatternDefault(
              parameter.initializer,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
            )
          : undefined;
      walkBindingPattern(parameter, parameter.name, resolvedInit);
      continue;
    }
    if (ts.isArrayBindingPattern(parameter.name)) {
      const resolvedInit =
        parameter.initializer !== undefined
          ? resolveModulePatternDefault(
              parameter.initializer,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
            )
          : undefined;
      walkArrayBindingPattern(parameter, parameter.name, undefined, undefined, resolvedInit);
      continue;
    }
    if (ts.isIdentifier(parameter.name) && parameter.initializer !== undefined) {
      noteShippedProp(parameter, undefined, parameter.name.text, parameter.initializer);
    }
  }
  return names;
}

function collectFileUndocumentedShippedPropNames(
  sourceFile: ts.SourceFile,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
): Set<string> {
  const names = new Set<string>();
  function visitFunctionLike(node: ts.FunctionLikeDeclaration): void {
    for (const propName of collectUndocumentedShippedPropNames(
      node.parameters,
      sourceFile,
      moduleBindings,
      moduleFunctions,
      new Set<string>(),
      new Map<string, string>(),
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
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
  undocumentedPropNames: Set<string>,
  fileUndocumentedPropNames: Set<string>,
  literalLocals: Map<string, number>,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  fileModuleDirectStringAliases: Map<string, string>,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
  source: ts.SourceFile,
  currentParameters: ts.ParameterDeclaration[],
  outerLiteralLocals: Map<string, number>,
  outerLiteralLocalInitializers: Map<string, ts.Expression>,
  enclosingParameters: ts.ParameterDeclaration[],
  functionName: string | null,
  callSiteParameterInitializers: Map<string, Map<string, ts.Expression>>,
  callSiteParameterContexts: Map<string, ts.ParameterDeclaration[]>,
): {
  indirectMessageProps: Map<string, number>;
  indirectArgumentViolations: Array<{ line: number; kind: ShippedMessageViolation["kind"]; text: string }>;
  moduleDirectStringAliases: Map<string, string>;
  literalLocalInitializers: Map<string, ts.Expression>;
  scopedLiteralLocals: Map<string, number>;
} {
  const indirectMessageProps = new Map<string, number>();
  const indirectArgumentViolations: Array<{ line: number; kind: ShippedMessageViolation["kind"]; text: string }> = [];
  const moduleDirectStringAliases = new Map<string, string>();
  const literalLocalInitializers = new Map<string, ts.Expression>();
  const setterToState = new Map<string, string>();
  const helperCallSiteParameters =
    functionName !== null ? (callSiteParameterContexts.get(functionName) ?? []) : [];
  const parameterDefaultSearchParameters = [...helperCallSiteParameters, ...currentParameters];
  const messageCallParameters = collectMessageCallParameterNames(
    currentParameters,
    source,
    moduleFunctions,
    moduleDirectStringFunctions,
    fileModuleDirectStringAliases,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
  );

  if (functionName !== null) {
    const seeded = callSiteParameterInitializers.get(functionName);
    if (seeded !== undefined) {
      for (const [paramName, initializer] of seeded) {
        literalLocalInitializers.set(paramName, initializer);
      }
    }
  }

  function lineOf(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  function callCarriesShippedMessage(call: ts.CallExpression): boolean {
    const callee = unwrapExpression(call.expression);
    if (!ts.isIdentifier(callee)) return false;
    return (
      literalLocals.has(callee.text) ||
      moduleDirectStringFunctions.has(callee.text) ||
      moduleDirectStringAliases.has(callee.text)
    );
  }

  function memberIsUndocumentedShippedProp(memberName: string): boolean {
    return undocumentedPropNames.has(memberName);
  }

  function siblingParameterDefaultMatchesMember(memberName: string): boolean {
    for (const param of currentParameters) {
      if (ts.isIdentifier(param.name) && param.name.text === memberName && param.initializer !== undefined) {
        return true;
      }
    }
    return false;
  }

  function memberAccessCarriesShippedMessage(expression: ts.PropertyAccessExpression): boolean {
    const chain = propertyAccessMemberKeys(expression);
    if (chain === null) return false;
    if (chain.memberKeys.some((member) => isExemptRenderedMember(member))) return false;
    const slices = objectMemberPathSlicesFromDefault(chain.objectName, chain.memberKeys);
    if (slices !== null) {
      return slices.some((slice) =>
        renderSliceExpressionIsShipped(
          slice,
          moduleBindings,
          moduleFunctions,
          moduleDirectStringFunctions,
          fileModuleDirectStringAliases,
          parameterDefaultSearchParameters,
          source,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
          messageCallParameters,
          literalLocalInitializers,
        ),
      );
    }
    const memberKey = chain.memberKeys.at(-1) ?? "";
    if (siblingParameterDefaultMatchesMember(memberKey) && chain.objectName !== memberKey) {
      return false;
    }
    return memberIsUndocumentedShippedProp(memberKey);
  }

  function memberSliceFromIdentifierDefault(objectName: string, memberKey: string): ts.Expression[] | null {
    const localInit = literalLocalInitializers.get(objectName);
    if (localInit !== undefined) {
    return collectObjectMemberSlicesFromDefault(
      localInit,
      memberKey,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
      parameterDefaultSearchParameters,
    );
    }
    const defaultExpr = parameterDefaultExpressionForName(
      objectName,
      parameterDefaultSearchParameters,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
    if (defaultExpr === undefined) return null;
    return collectObjectMemberSlicesFromDefault(
      defaultExpr,
      memberKey,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
  }

  function objectMemberPathSlicesFromDefault(objectName: string, memberKeys: readonly string[]): ts.Expression[] | null {
    let defaultExpr = literalLocalInitializers.get(objectName);
    if (defaultExpr === undefined) {
      defaultExpr = parameterDefaultExpressionForName(
        objectName,
        parameterDefaultSearchParameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
    }
    if (defaultExpr === undefined) return null;
    return collectObjectMemberPathSlicesFromDefault(
      defaultExpr,
      memberKeys,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
      parameterDefaultSearchParameters,
    );
  }

  function expressionCarriesShippedMessage(expression: ts.Expression): boolean {
    expression = unwrapExpression(expression);
    if (localInitializerIsShippedCopy(expression)) return true;
    if (ts.isIdentifier(expression) && moduleDirectStringFunctions.has(expression.text)) return true;
    if (ts.isPropertyAccessExpression(expression)) {
      return memberAccessCarriesShippedMessage(expression);
    }
    if (ts.isElementAccessExpression(expression)) {
      const argument = expression.argumentExpression;
      const numericIndex = elementAccessIndexFromArgument(argument);
      const objectExpr = unwrapExpression(expression.expression);
      if (numericIndex !== null && ts.isIdentifier(objectExpr)) {
        const objectName = objectExpr.text;
        let defaultExpr = literalLocalInitializers.get(objectName);
        if (defaultExpr === undefined) {
          defaultExpr = parameterDefaultExpressionForName(
            objectName,
            parameterDefaultSearchParameters,
            source,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
          );
        }
        if (defaultExpr !== undefined) {
          const slices = collectArrayIndexSlicesFromDefault(
            defaultExpr,
            numericIndex,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
            source,
          );
          if (slices !== null) {
            return slices.some((slice) =>
              renderSliceExpressionIsShipped(
                slice,
                moduleBindings,
                moduleFunctions,
                moduleDirectStringFunctions,
                fileModuleDirectStringAliases,
                parameterDefaultSearchParameters,
                source,
                moduleMessageObjectInitializers,
                moduleMessageArrayInitializers,
                messageCallParameters,
                literalLocalInitializers,
              ),
            );
          }
          return false;
        }
        if (ts.isCallExpression(objectExpr)) {
          const entry = callableReturnArrayElementInitializer(objectExpr, numericIndex, source);
          if (entry !== undefined) {
            return renderSliceExpressionIsShipped(
              entry,
              moduleBindings,
              moduleFunctions,
              moduleDirectStringFunctions,
              fileModuleDirectStringAliases,
              parameterDefaultSearchParameters,
              source,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
              messageCallParameters,
              literalLocalInitializers,
            );
          }
        }
        if (literalLocals.has(objectName)) {
          return true;
        }
        return false;
      }
      if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
        const member = argument.text;
        if (isExemptRenderedMember(member)) return false;
        if (ts.isIdentifier(expression.expression)) {
          const slices = memberSliceFromIdentifierDefault(expression.expression.text, member);
          if (slices !== null) {
            return slices.some((slice) =>
              renderSliceExpressionIsShipped(
                slice,
                moduleBindings,
                moduleFunctions,
                moduleDirectStringFunctions,
                fileModuleDirectStringAliases,
                parameterDefaultSearchParameters,
                source,
                moduleMessageObjectInitializers,
                moduleMessageArrayInitializers,
                messageCallParameters,
                literalLocalInitializers,
              ),
            );
          }
        }
        if (siblingParameterDefaultMatchesMember(member) && ts.isIdentifier(expression.expression)) {
          return false;
        }
        return memberIsUndocumentedShippedProp(member);
      }
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return expression.elements.some(
        (element) => ts.isExpression(element) && expressionCarriesShippedMessage(element),
      );
    }
    if (ts.isObjectLiteralExpression(expression)) {
      return expression.properties.some((property) => {
        if (ts.isSpreadAssignment(property)) return expressionCarriesShippedMessage(property.expression);
        if (ts.isShorthandPropertyAssignment(property)) {
          return (
            literalLocals.has(property.name.text) ||
            expressionCarriesShippedMessage(property.name)
          );
        }
        if (ts.isPropertyAssignment(property)) {
          if (ts.isIdentifier(property.initializer) && literalLocals.has(property.initializer.text)) {
            return true;
          }
          return expressionCarriesShippedMessage(property.initializer);
        }
        return false;
      });
    }
    if (ts.isIdentifier(expression) && literalLocals.has(expression.text)) {
      return true;
    }
    if (ts.isCallExpression(expression)) {
      if (callCarriesShippedMessage(expression)) return true;
      const memberCallee = memberAccessFromCallCallee(expression.expression);
      if (memberCallee !== null) {
        if (ts.isPropertyAccessExpression(memberCallee)) {
          return memberAccessCarriesShippedMessage(memberCallee);
        }
        return expressionCarriesShippedMessage(memberCallee);
      }
      const callee = unwrapExpression(expression.expression);
      if (ts.isIdentifier(callee)) {
        return renderSliceExpressionIsShipped(
          expression,
          moduleBindings,
          moduleFunctions,
          moduleDirectStringFunctions,
          fileModuleDirectStringAliases,
          parameterDefaultSearchParameters,
          source,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
          messageCallParameters,
          literalLocalInitializers,
        );
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
    if (expressionCarriesShippedMessage(initializer)) {
      literalLocals.set(name, line);
      literalLocalInitializers.set(name, initializer);
    }
  }

  function registerAlias(name: string, fromName: string, line: number): void {
    const fromInit =
      literalLocalInitializers.get(fromName) ??
      parameterDefaultExpressionForName(
        fromName,
        currentParameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
    const fromIsShipped =
      literalLocals.has(fromName) ||
      (fromInit !== undefined &&
        renderSliceExpressionIsShipped(
          fromInit,
          moduleBindings,
          moduleFunctions,
          moduleDirectStringFunctions,
          fileModuleDirectStringAliases,
          parameterDefaultSearchParameters,
          source,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
          messageCallParameters,
          literalLocalInitializers,
        ));
    if (!fromIsShipped) return;
    literalLocals.set(name, line);
    if (fromInit !== undefined) {
      literalLocalInitializers.set(name, fromInit);
    } else {
      literalLocalInitializers.set(name, ts.factory.createIdentifier(fromName));
    }
    if (moduleDirectStringFunctions.has(fromName)) {
      moduleDirectStringAliases.set(name, fromName);
    }
  }

  function registerFromExpression(name: string, initializer: ts.Expression, line: number): void {
    registerLocal(name, initializer, line);
    const unwrappedInitializer = unwrapExpression(initializer);
    if (ts.isCallExpression(unwrappedInitializer)) {
      const callCallee = unwrapExpression(unwrappedInitializer.expression);
      if (ts.isIdentifier(callCallee) && moduleFunctions.has(callCallee.text)) {
        literalLocalInitializers.set(name, initializer);
      }
    }
    if (ts.isIdentifier(unwrappedInitializer)) {
      registerAlias(name, unwrappedInitializer.text, line);
    }
    const objectLiteral = unwrapExpression(initializer);
    if (ts.isObjectLiteralExpression(objectLiteral)) {
      for (const property of objectLiteral.properties) {
        let shorthandName: string | null = null;
        if (ts.isShorthandPropertyAssignment(property)) {
          shorthandName = property.name.text;
        } else if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          ts.isIdentifier(property.initializer) &&
          property.name.text === property.initializer.text
        ) {
          shorthandName = property.name.text;
        }
        if (shorthandName === null) continue;
        if (literalLocals.has(shorthandName)) {
          literalLocals.set(name, line);
          literalLocalInitializers.set(name, initializer);
          break;
        }
        const paramDefault = parameterDefaultExpressionForName(
          shorthandName,
          currentParameters,
          source,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
        );
        if (
          paramDefault !== undefined &&
          parameterDefaultIsShippedCopy(
            paramDefault,
            moduleBindings,
            moduleFunctions,
            moduleDirectStringFunctions,
            fileModuleDirectStringAliases,
          )
        ) {
          literalLocals.set(name, line);
          literalLocalInitializers.set(name, initializer);
          break;
        }
      }
      for (const property of objectLiteral.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (ts.isIdentifier(property.initializer)) {
          if (literalLocals.has(property.initializer.text)) {
            literalLocals.set(name, line);
            literalLocalInitializers.set(name, initializer);
            break;
          }
          const paramDefault = parameterDefaultExpressionForName(
            property.initializer.text,
            currentParameters,
            source,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
          );
          if (
            paramDefault !== undefined &&
            (parameterDefaultIsMessageCall(
              paramDefault,
              moduleFunctions,
              moduleDirectStringFunctions,
              fileModuleDirectStringAliases,
            ) ||
              parameterDefaultIsShippedCopy(
                paramDefault,
                moduleBindings,
                moduleFunctions,
                moduleDirectStringFunctions,
                fileModuleDirectStringAliases,
              ))
          ) {
            literalLocals.set(name, line);
            literalLocalInitializers.set(name, initializer);
            break;
          }
        }
      }
    }
    if (ts.isArrayLiteralExpression(objectLiteral)) {
      for (const element of objectLiteral.elements) {
        if (!ts.isExpression(element)) continue;
        const unwrappedElement = unwrapExpression(element);
        if (ts.isIdentifier(unwrappedElement)) {
          if (literalLocals.has(unwrappedElement.text) || expressionCarriesShippedMessage(unwrappedElement)) {
            literalLocals.set(name, line);
            literalLocalInitializers.set(name, initializer);
            break;
          }
        }
        if (expressionCarriesShippedMessage(unwrappedElement)) {
          literalLocals.set(name, line);
          literalLocalInitializers.set(name, initializer);
          break;
        }
        if (!ts.isIdentifier(unwrappedElement)) continue;
        const paramDefault = parameterDefaultExpressionForName(
          unwrappedElement.text,
          currentParameters,
          source,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
        );
        if (
          paramDefault !== undefined &&
          parameterDefaultIsShippedCopy(
            paramDefault,
            moduleBindings,
            moduleFunctions,
            moduleDirectStringFunctions,
            fileModuleDirectStringAliases,
          )
        ) {
          literalLocals.set(name, line);
          literalLocalInitializers.set(name, initializer);
          break;
        }
      }
    }
  }

  function registerDestructuredProp(
    localName: string,
    propName: string | null,
    objectKey: string | null,
    sourceExpr: ts.Expression | undefined,
    line: number,
    memberPath: string[] | undefined = undefined,
  ): void {
    if (sourceExpr === undefined || objectKey === null) return;
    const unwrappedSourceExpr = unwrapExpression(sourceExpr);
    if (ts.isCallExpression(unwrappedSourceExpr)) {
      const memberInit = callableReturnObjectMemberInitializer(unwrappedSourceExpr, objectKey, source);
      if (memberInit !== undefined) {
        if (
          renderSliceExpressionIsShipped(
            memberInit,
            moduleBindings,
            moduleFunctions,
            moduleDirectStringFunctions,
            fileModuleDirectStringAliases,
            parameterDefaultSearchParameters,
            source,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
            messageCallParameters,
            literalLocalInitializers,
          )
        ) {
          literalLocals.set(localName, line);
        }
        return;
      }
    }
    let defaultExpr: ts.Expression = sourceExpr;
    if (ts.isIdentifier(sourceExpr)) {
      const localInit = literalLocalInitializers.get(sourceExpr.text);
      if (localInit !== undefined) {
        defaultExpr = localInit;
      } else {
        const paramDefault = parameterDefaultExpressionForName(
          sourceExpr.text,
          currentParameters,
          source,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
        );
        if (paramDefault !== undefined) {
          defaultExpr = paramDefault;
        }
      }
    }
    const path = memberPath ?? [objectKey];
    const slices =
      path.length === 1
        ? collectObjectMemberSlicesFromDefault(
            defaultExpr,
            path[0],
            source,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
            parameterDefaultSearchParameters,
          )
        : collectObjectMemberPathSlicesFromDefault(
            defaultExpr,
            path,
            source,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
            parameterDefaultSearchParameters,
          );
    if (slices !== null) {
      if (
        slices.some((slice) =>
          renderSliceExpressionIsShipped(
            slice,
            moduleBindings,
            moduleFunctions,
            moduleDirectStringFunctions,
            fileModuleDirectStringAliases,
            parameterDefaultSearchParameters,
            source,
            moduleMessageObjectInitializers,
            moduleMessageArrayInitializers,
            messageCallParameters,
            literalLocalInitializers,
          ),
        )
      ) {
        literalLocals.set(localName, line);
      }
      return;
    }
    const memberKey = objectKey ?? propName;
    if (
      memberKey !== null &&
      siblingParameterDefaultMatchesMember(memberKey) &&
      sourceExpr !== undefined &&
      ts.isIdentifier(sourceExpr)
    ) {
      return;
    }
    if (propName !== null && memberIsUndocumentedShippedProp(propName)) {
      literalLocals.set(localName, line);
    }
  }

  function registerDestructuredArrayIndex(
    localName: string,
    index: number,
    sourceExpr: ts.Expression | undefined,
    line: number,
  ): void {
    if (sourceExpr === undefined) return;
    let defaultExpr: ts.Expression = sourceExpr;
    if (ts.isIdentifier(sourceExpr)) {
      const localInit = literalLocalInitializers.get(sourceExpr.text);
      if (localInit !== undefined) {
        defaultExpr = localInit;
      } else {
        const paramDefault = parameterDefaultExpressionForName(
          sourceExpr.text,
          currentParameters,
          source,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
        );
        if (paramDefault !== undefined) {
          defaultExpr = paramDefault;
        }
      }
    }
    const slices = collectArrayIndexSlicesFromDefault(
      defaultExpr,
      index,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
    if (slices === null) return;
    if (
      slices.some((slice) =>
        renderSliceExpressionIsShipped(
          slice,
          moduleBindings,
          moduleFunctions,
          moduleDirectStringFunctions,
          fileModuleDirectStringAliases,
          parameterDefaultSearchParameters,
          source,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
          messageCallParameters,
          literalLocalInitializers,
        ),
      )
    ) {
      literalLocals.set(localName, line);
    }
  }

  function indirectCallArgumentIsTracked(identifierName: string): boolean {
    if (
      undocumentedPropNames.has(identifierName) ||
      fileUndocumentedPropNames.has(identifierName) ||
      literalLocals.has(identifierName) ||
      outerLiteralLocals.has(identifierName)
    ) {
      return true;
    }
    if (identifierMatchesDocumentedParameter(identifierName, currentParameters, source)) {
      const paramDefault = parameterDefaultExpressionForName(
        identifierName,
        currentParameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
      return (
        paramDefault !== undefined &&
        parameterDefaultIsShippedCopy(
          paramDefault,
          moduleBindings,
          moduleFunctions,
          moduleDirectStringFunctions,
          fileModuleDirectStringAliases,
        )
      );
    }
    return false;
  }

  function noteIndirectCallArguments(call: ts.CallExpression): void {
    const line = lineOf(call);
    const mergedLiteralLocalInitializers = new Map([
      ...outerLiteralLocalInitializers,
      ...literalLocalInitializers,
    ]);
    for (let argIndex = 0; argIndex < call.arguments.length; argIndex++) {
      const argument = call.arguments[argIndex];
      if (!ts.isExpression(argument)) continue;
      const unwrappedForTrack = unwrapExpression(argument);
      if (isCreateElementCall(call)) {
        if (!ts.isIdentifier(unwrappedForTrack) && !ts.isObjectLiteralExpression(unwrappedForTrack)) {
          continue;
        }
        if (ts.isIdentifier(unwrappedForTrack) && !indirectCallArgumentIsTracked(unwrappedForTrack.text)) {
          continue;
        }
      } else if (ts.isIdentifier(unwrappedForTrack) && !indirectCallArgumentIsTracked(unwrappedForTrack.text)) {
        continue;
      }
      if (
        indirectCallRendersArgument(
          call,
          argIndex,
          argument,
          source,
          currentParameters,
          parameterDefaultSearchParameters,
          mergedLiteralLocalInitializers,
          moduleBindings,
          moduleFunctions,
          moduleDirectStringFunctions,
          fileModuleDirectStringAliases,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
        )
      ) {
        const indirectArgumentName = ((): string | null => {
          const unwrapped = unwrapExpression(argument);
          if (ts.isIdentifier(unwrapped)) return unwrapped.text;
          if (ts.isConditionalExpression(unwrapped)) {
            if (ts.isIdentifier(unwrapped.whenTrue)) return unwrapped.whenTrue.text;
            if (ts.isIdentifier(unwrapped.whenFalse)) return unwrapped.whenFalse.text;
          }
          if (ts.isBinaryExpression(unwrapped)) {
            const kind = unwrapped.operatorToken.kind;
            if (
              kind === ts.SyntaxKind.QuestionQuestionToken ||
              kind === ts.SyntaxKind.BarBarToken ||
              kind === ts.SyntaxKind.AmpersandAmpersandToken
            ) {
              const left = unwrapExpression(unwrapped.left);
              const right = unwrapExpression(unwrapped.right);
              const candidates =
                kind === ts.SyntaxKind.AmpersandAmpersandToken ? [right, left] : [left, right];
              for (const candidate of candidates) {
                if (ts.isIdentifier(candidate) && indirectCallArgumentIsTracked(candidate.text)) {
                  return candidate.text;
                }
              }
              if (ts.isIdentifier(right)) return right.text;
              if (ts.isIdentifier(left)) return left.text;
            }
          }
          return null;
        })();
        if (indirectArgumentName !== null) {
          indirectMessageProps.set(indirectArgumentName, line);
        } else {
          const unwrappedArgument = unwrapExpression(argument);
          if (ts.isObjectLiteralExpression(unwrappedArgument)) {
            for (const property of unwrappedArgument.properties) {
              if (!ts.isPropertyAssignment(property)) continue;
              const literal = staticLiteral(unwrapExpression(property.initializer));
              if (literal !== null && hasLetter(literal)) {
                indirectArgumentViolations.push({ line, kind: "jsx-text", text: literal });
              }
            }
          }
        }
      }
    }
  }

  function registerObjectBindingPattern(
    pattern: ts.ObjectBindingPattern,
    sourceExpr: ts.Expression | undefined,
    line: number,
    pathPrefix: string[],
  ): void {
    for (const element of pattern.elements) {
      if (element.dotDotDotToken !== undefined) {
        const localName = bindingElementLocalName(element);
        if (localName !== null && sourceExpr !== undefined) {
          registerFromExpression(localName, sourceExpr, line);
        }
        continue;
      }
      const objectKey = bindingElementObjectKey(element, source);
      if (objectKey === null) continue;
      const memberPath = [...pathPrefix, objectKey];
      if (ts.isObjectBindingPattern(element.name)) {
        registerObjectBindingPattern(element.name, sourceExpr, line, memberPath);
        continue;
      }
      const localName = bindingElementLocalName(element);
      if (localName === null) continue;
      registerDestructuredProp(
        localName,
        bindingElementPropertyName(element, source),
        memberPath.at(-1) ?? null,
        sourceExpr,
        line,
        memberPath,
      );
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
          registerObjectBindingPattern(declaration.name, declaration.initializer, line, []);
        }
        if (ts.isArrayBindingPattern(declaration.name)) {
          let index = 0;
          for (const element of declaration.name.elements) {
            if (ts.isOmittedExpression(element)) {
              index++;
              continue;
            }
            const localName = bindingElementLocalName(element);
            if (localName !== null) {
              registerDestructuredArrayIndex(localName, index, declaration.initializer, line);
            }
            index++;
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
  else scanNode(body);
  const scopedLiteralLocals = new Map([...outerLiteralLocals, ...literalLocals]);
  return {
    indirectMessageProps,
    indirectArgumentViolations,
    moduleDirectStringAliases,
    literalLocalInitializers,
    scopedLiteralLocals,
    parameterDefaultSearchParameters,
  };
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
  if (name === "children") return true;
  if (name.startsWith("aria-")) return NAMING_ARIA.has(name);
  return MESSAGE_JSX_ATTRS.has(name);
}

function checkRenderedLocalReferences(
  body: ts.ConciseBody,
  literalLocals: Map<string, number>,
  undocumentedPropNames: Set<string>,
  interfaceMessageProps: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  moduleDirectStringAliases: Map<string, string>,
  moduleRenderedStringBindings: Set<string>,
  literalLocalInitializers: Map<string, ts.Expression>,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
  fileName: string,
  source: ts.SourceFile,
  violations: ShippedMessageViolation[],
  parameters?: ts.NodeArray<ts.ParameterDeclaration>,
  parameterDefaultSearchParameters: ts.ParameterDeclaration[] = [],
  messageCallParameters: Set<string> = new Set(),
): void {
  function lineOf(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  function noteReference(name: string, node: ts.Node): void {
    if (
      literalLocals.has(name) ||
      moduleRenderedStringBindings.has(name) ||
      literalLocalInitializers.has(name)
    ) {
      violations.push({
        file: fileName,
        line: lineOf(node),
        kind: "rendered-local",
        text: name,
      });
    }
  }

  function noteModuleDirectStringCall(callee: ts.Identifier, node: ts.Node): void {
    if (!moduleDirectStringFunctions.has(callee.text) && !moduleDirectStringAliases.has(callee.text)) return;
    violations.push({
      file: fileName,
      line: lineOf(node),
      kind: "rendered-local",
      text: callee.text,
    });
  }

  function localDefaultExpression(name: string): ts.Expression | undefined {
    const localInit = literalLocalInitializers.get(name);
    if (localInit !== undefined) return localInit;
    if (parameters === undefined) return undefined;
    return parameterDefaultExpressionForName(
      name,
      parameters,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
    );
  }

  function sliceExpressionsAreShipped(slices: readonly ts.Expression[]): boolean {
    return slices.some((slice) =>
      renderSliceExpressionIsShipped(
        slice,
        moduleBindings,
        moduleFunctions,
        moduleDirectStringFunctions,
        moduleDirectStringAliases,
        parameterDefaultSearchParameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        messageCallParameters,
        literalLocalInitializers,
      ),
    );
  }

  function objectMemberSliceFromLocalInitializer(
    initializer: ts.Expression,
    memberKey: string,
  ): ts.Expression[] | null {
    const object = unwrapExpression(initializer);
    if (!ts.isObjectLiteralExpression(object)) return null;
    for (const property of object.properties) {
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === memberKey) {
        const bound = literalLocalInitializers.get(property.name.text);
        if (bound !== undefined) return [bound];
        if (literalLocals.has(property.name.text)) {
          return [property.name];
        }
      }
      if (!ts.isPropertyAssignment(property)) continue;
      const nameText = objectLiteralElementName(property, source);
      if (nameText === memberKey) return [property.initializer];
    }
    return null;
  }

  function renderedMemberPathIsShippedCopy(objectName: string, memberKeys: readonly string[]): boolean {
    let defaultExpr = literalLocalInitializers.get(objectName) ?? localDefaultExpression(objectName);
    if (defaultExpr === undefined) return false;
    const slices = collectObjectMemberPathSlicesFromDefault(
      defaultExpr,
      memberKeys,
      source,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
      parameterDefaultSearchParameters,
    );
    if (slices === null || slices.length === 0) {
      if (memberKeys.length === 1) {
        const localSlices = objectMemberSliceFromLocalInitializer(defaultExpr, memberKeys[0] ?? "");
        if (localSlices !== null) return sliceExpressionsAreShipped(localSlices);
      }
      return false;
    }
    return sliceExpressionsAreShipped(slices);
  }

  function noteMessageCallReference(calleeName: string, node: ts.Node): void {
    if (!messageCallParameters.has(calleeName)) return;
    violations.push({
      file: fileName,
      line: lineOf(node),
      kind: "rendered-local",
      text: calleeName,
    });
  }

  function notePropertyAccess(node: ts.PropertyAccessExpression, reportAt: ts.Node): void {
    const chain = propertyAccessMemberKeys(node);
    if (chain === null) {
      const objectExpr = unwrapExpression(node.expression);
      if (ts.isCallExpression(objectExpr)) {
        const memberInit = callableReturnObjectMemberInitializer(objectExpr, node.name.text, source);
        if (memberInit !== undefined && sliceExpressionsAreShipped([memberInit])) {
          const callee = unwrapExpression(objectExpr.expression);
          if (ts.isIdentifier(callee)) {
            noteReference(callee.text, reportAt);
          }
        }
      }
      return;
    }
    if (chain.memberKeys.some((member) => isExemptRenderedMember(member))) return;
    if (chain.objectName === "props" && interfaceMessageProps.has(chain.memberKeys.at(-1) ?? "")) {
      violations.push({ file: fileName, line: lineOf(reportAt), kind: "rendered-local", text: chain.memberKeys.at(-1) ?? "" });
      return;
    }
    if (renderedMemberPathIsShippedCopy(chain.objectName, chain.memberKeys)) {
      noteReference(chain.objectName, reportAt);
    }
  }

  function noteElementAccess(node: ts.ElementAccessExpression, reportAt: ts.Node): void {
    const argument = node.argumentExpression;
    const index = elementAccessIndexFromArgument(argument);
    const objectExpr = unwrapExpression(node.expression);
    const objectName = ts.isIdentifier(objectExpr) ? objectExpr.text : null;
    if (index !== null && ts.isCallExpression(objectExpr)) {
      const entry = callableReturnArrayElementInitializer(objectExpr, index, source);
      if (entry !== undefined && sliceExpressionsAreShipped([entry])) {
        const callee = unwrapExpression(objectExpr.expression);
        if (ts.isIdentifier(callee)) {
          noteReference(callee.text, reportAt);
        }
      }
      return;
    }
    if (index !== null && objectName !== null) {
      const defaultExpr = localDefaultExpression(objectName);
      if (defaultExpr !== undefined) {
        const entries = collectArrayIndexSlicesFromDefault(
          defaultExpr,
          index,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
          source,
        );
        if (entries !== null) {
          if (sliceExpressionsAreShipped(entries)) {
            noteReference(objectName, reportAt);
          }
          return;
        }
      }
      return;
    }
    if (ts.isIdentifier(unwrapExpression(argument)) && index === null) {
      if (objectName !== null) {
        const defaultExpr = localDefaultExpression(objectName);
        if (defaultExpr !== undefined) {
          const resolved = unwrapExpression(
            resolveModulePatternDefault(
              defaultExpr,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
            ),
          );
          if (
            ts.isArrayLiteralExpression(resolved) ||
            collectArrayAllElementSlicesFromDefault(
              defaultExpr,
              moduleMessageObjectInitializers,
              moduleMessageArrayInitializers,
            ) !== null
          ) {
            return;
          }
        }
        if (
          literalLocals.has(objectName) ||
          (defaultExpr !== undefined &&
            parameterDefaultIsShippedCopy(
              defaultExpr,
              moduleBindings,
              moduleFunctions,
              moduleDirectStringFunctions,
              moduleDirectStringAliases,
            ))
        ) {
          noteReference(objectName, reportAt);
        }
      }
      return;
    }
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      const chain = renderedMemberChain(node);
      if (chain === null) return;
      const member = chain.memberKeys.at(-1) ?? "";
      if (isExemptRenderedMember(member)) return;
      if (chain.objectName === "props" && interfaceMessageProps.has(member)) {
        violations.push({ file: fileName, line: lineOf(reportAt), kind: "rendered-local", text: member });
        return;
      }
      if (renderedMemberPathIsShippedCopy(chain.objectName, chain.memberKeys)) {
        noteReference(chain.objectName, reportAt);
      }
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
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        if (ts.isSpreadElement(element)) {
          noteRenderedMessageReference(element.expression, node);
        } else if (ts.isExpression(element)) {
          noteRenderedMessageReference(element, node);
        }
      }
      return;
    }
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
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      noteRenderedMessageReference(expression.right, node);
      return;
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      noteRenderedMessageReference(expression.left, node);
      noteRenderedMessageReference(expression.right, node);
      return;
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      if (!returnExpressionIsDirectStringShippedCopy(expression)) {
        noteRenderedMessageReference(expression.left, node);
        noteRenderedMessageReference(expression.right, node);
      }
      return;
    }
    if (ts.isCallExpression(expression)) {
      const memberCallee = memberAccessFromCallCallee(expression.expression);
      if (memberCallee !== null) {
        if (ts.isPropertyAccessExpression(memberCallee)) {
          notePropertyAccess(memberCallee, node);
        } else {
          noteElementAccess(memberCallee, node);
        }
      } else {
        const callee = unwrapExpression(expression.expression);
        if (ts.isIdentifier(callee)) {
          noteModuleDirectStringCall(callee, node);
          noteMessageCallReference(callee.text, node);
          noteReference(callee.text, node);
        }
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
      noteRenderedLocalIdentifier(unwrapped.text, unwrapped);
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

  function isBareDocumentedParameterJsxRender(name: string, expressionNode: ts.Node): boolean {
    if (parameters === undefined || !identifierMatchesDocumentedParameter(name, parameters, source)) {
      return false;
    }
    if (!ts.isIdentifier(expressionNode) || expressionNode.text !== name) return false;
    let current: ts.Node | undefined = expressionNode.parent;
    while (current !== undefined) {
      if (ts.isJsxExpression(current)) {
        if (current.expression === undefined) return false;
        const rendered = unwrapExpression(current.expression);
        return ts.isIdentifier(rendered) && rendered.text === name;
      }
      if (
        ts.isJsxElement(current) ||
        ts.isJsxFragment(current) ||
        ts.isJsxSelfClosingElement(current) ||
        ts.isCallExpression(current) ||
        ts.isPropertyAssignment(current)
      ) {
        return false;
      }
      current = current.parent;
    }
    return false;
  }

  function noteRenderedLocalIdentifier(name: string, node: ts.Node): void {
    if (isBareDocumentedParameterJsxRender(name, node)) return;
    if (parameters !== undefined && identifierMatchesDocumentedParameter(name, parameters, source)) {
      const paramDefault = parameterDefaultExpressionForName(
        name,
        parameters,
        source,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
      );
      if (
        paramDefault !== undefined &&
        parameterDefaultIsShippedCopy(
          paramDefault,
          moduleBindings,
          moduleFunctions,
          moduleDirectStringFunctions,
          moduleDirectStringAliases,
        )
      ) {
        violations.push({
          file: fileName,
          line: lineOf(node),
          kind: "rendered-local",
          text: name,
        });
        return;
      }
    }
    const localInit = literalLocalInitializers.get(name);
    if (localInit !== undefined) {
      const unwrappedInit = unwrapExpression(localInit);
      if (
        ts.isBinaryExpression(unwrappedInit) &&
        (unwrappedInit.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          unwrappedInit.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        noteRenderedMessageExpression(localInit, node, true);
        noteReference(name, node);
        return;
      }
    }
    noteReference(name, node);
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
    if (ts.isIdentifier(expression)) {
      const initializer =
        literalLocalInitializers.get(expression.text) ??
        moduleMessageObjectInitializers.get(expression.text);
      if (initializer !== undefined) {
        walkMessagePropsInExpression(initializer, reportNode);
        return;
      }
      if (moduleRenderedStringBindings.has(expression.text)) {
        noteReference(expression.text, reportNode);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isSpreadAssignment(property)) {
          walkMessagePropsInExpression(property.expression, reportNode);
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          const propertyName = property.name.text;
          if (isMessageCreateElementProperty(propertyName)) {
            noteReference(property.name.text, property);
          }
          continue;
        }
        if (!ts.isPropertyAssignment(property)) continue;
        const propertyName = objectLiteralElementName(property, source);
        if (propertyName === null || !isMessageCreateElementProperty(propertyName)) continue;
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
    if (literalBranches && ts.isArrayLiteralExpression(expression)) {
      walkRenderedChildExpression(expression, node, literalBranches);
      return;
    }
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
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      noteRenderedMessageExpression(expression.right, node, literalBranches);
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
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      if (returnExpressionIsDirectStringShippedCopy(expression)) {
        violations.push({
          file: fileName,
          line: lineOf(node),
          kind: "jsx-text",
          text: expression.getText(source),
        });
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
      const memberCallee = memberAccessFromCallCallee(expression.expression);
      if (memberCallee !== null) {
        if (ts.isPropertyAccessExpression(memberCallee)) {
          notePropertyAccess(memberCallee, node);
        } else {
          noteElementAccess(memberCallee, node);
        }
      } else {
        const callee = unwrapExpression(expression.expression);
        if (ts.isIdentifier(callee)) {
          noteModuleDirectStringCall(callee, node);
          noteMessageCallReference(callee.text, node);
          noteReference(callee.text, node);
        }
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
      noteRenderedLocalIdentifier(unwrapped.text, unwrapped);
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
    if (ts.isCallExpression(parent) && isCreateElementCall(parent)) {
      return parent.arguments.some(
        (argument) =>
          argument === node || (ts.isSpreadElement(argument) && argument.expression === node),
      );
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isCreateElementCall(node)) {
      for (let index = 1; index < node.arguments.length; index++) {
        const argument = node.arguments[index];
        if (index === 1) {
          if (ts.isSpreadElement(argument)) {
            walkMessagePropsInExpression(argument.expression, node);
            continue;
          }
          if (ts.isObjectLiteralExpression(argument)) {
            for (const property of argument.properties) {
              if (ts.isSpreadAssignment(property)) {
                walkMessagePropsInExpression(property.expression, node);
                continue;
              }
              if (ts.isShorthandPropertyAssignment(property)) {
                const propertyName = property.name.text;
                if (isMessageCreateElementProperty(propertyName)) {
                  noteReference(property.name.text, property);
                }
                continue;
              }
              if (!ts.isPropertyAssignment(property)) continue;
              const propertyName = objectLiteralElementName(property, source);
              if (propertyName === null || !isMessageCreateElementProperty(propertyName)) continue;
              noteRenderedMessageExpression(property.initializer, property, true);
            }
          } else {
            walkMessagePropsInExpression(argument, node);
          }
          continue;
        }
        if (ts.isSpreadElement(argument)) {
          walkCreateElementChild(argument.expression, node);
          continue;
        }
        walkCreateElementChild(argument, node);
      }
    }
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const parent = node.parent;
      if (parent === undefined || !ts.isJsxAttribute(parent)) {
        walkRenderedChildExpression(node.expression, node, true);
      }
    }
    if (ts.isJsxAttribute(node)) {
      const attrName = jsxAttributeName(node);
      if (attrName === "children") {
        const literal = attributeLiteral(node.initializer);
        if (literal !== null && hasLetter(literal)) {
          violations.push({ file: fileName, line: lineOf(node), kind: "jsx-text", text: literal });
        }
      }
      if (node.initializer !== undefined && ts.isJsxExpression(node.initializer)) {
        if (NON_COPY_JSX_ATTRS.has(attrName) || attrName === "id") return;
        const expression = node.initializer.expression;
        if (expression !== undefined) {
          const literalBranches = MESSAGE_JSX_ATTRS.has(attrName) || NAMING_ARIA.has(attrName) || attrName === "children";
          noteRenderedMessageExpression(expression, node, literalBranches);
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
  moduleBindings: Set<string>,
  moduleFunctions: Set<string>,
  moduleDirectStringFunctions: Set<string>,
  fileModuleDirectStringAliases: Map<string, string>,
  fileUndocumentedPropNames: Set<string>,
  moduleMessageObjectInitializers: Map<string, ts.Expression>,
  moduleMessageArrayInitializers: Map<string, ts.Expression>,
  outerLiteralLocals: Map<string, number>,
  outerLiteralLocalInitializers: Map<string, ts.Expression>,
  enclosingParameters: ts.ParameterDeclaration[],
  functionName: string | null,
  callSiteParameterInitializers: Map<string, Map<string, ts.Expression>>,
  callSiteParameterContexts: Map<string, ts.ParameterDeclaration[]>,
): {
  literalBindings: Map<string, number>;
  undocumentedPropNames: Set<string>;
  messageCallParameters: Set<string>;
  indirectMessageProps: Map<string, number>;
  indirectArgumentViolations: Array<{ line: number; kind: ShippedMessageViolation["kind"]; text: string }>;
  moduleDirectStringAliases: Map<string, string>;
  literalLocalInitializers: Map<string, ts.Expression>;
  scopedLiteralLocals: Map<string, number>;
  parameterDefaultSearchParameters: ts.ParameterDeclaration[];
} {
  const literalBindings = collectParameterLiteralDefaults(
    parameters,
    source,
    moduleBindings,
    moduleFunctions,
    moduleDirectStringFunctions,
    fileModuleDirectStringAliases,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
  );
  const undocumentedPropNames = collectUndocumentedShippedPropNames(
    parameters,
    source,
    moduleBindings,
    moduleFunctions,
    moduleDirectStringFunctions,
    fileModuleDirectStringAliases,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
  );
  const messageCallParameters = collectMessageCallParameterNames(
    parameters,
    source,
    moduleFunctions,
    moduleDirectStringFunctions,
    fileModuleDirectStringAliases,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
  );
  let indirectMessageProps = new Map<string, number>();
  let indirectArgumentViolations: Array<{ line: number; kind: ShippedMessageViolation["kind"]; text: string }> = [];
  let moduleDirectStringAliases = new Map<string, string>();
  let literalLocalInitializers = new Map<string, ts.Expression>();
  let scopedLiteralLocals = new Map<string, number>(outerLiteralLocals);
  let parameterDefaultSearchParameters: ts.ParameterDeclaration[] = [...enclosingParameters, ...parameters];
  if (body !== undefined) {
    const analyzed = analyzeRenderedLocals(
      body,
      undocumentedPropNames,
      fileUndocumentedPropNames,
      literalBindings,
      moduleBindings,
      moduleFunctions,
      moduleDirectStringFunctions,
      fileModuleDirectStringAliases,
      moduleMessageObjectInitializers,
      moduleMessageArrayInitializers,
      source,
      parameters,
      outerLiteralLocals,
      outerLiteralLocalInitializers,
      enclosingParameters,
      functionName,
      callSiteParameterInitializers,
      callSiteParameterContexts,
    );
    indirectMessageProps = analyzed.indirectMessageProps;
    indirectArgumentViolations = analyzed.indirectArgumentViolations;
    moduleDirectStringAliases = analyzed.moduleDirectStringAliases;
    literalLocalInitializers = analyzed.literalLocalInitializers;
    scopedLiteralLocals = analyzed.scopedLiteralLocals;
    parameterDefaultSearchParameters = analyzed.parameterDefaultSearchParameters;
  }
  return {
    literalBindings,
    undocumentedPropNames,
    messageCallParameters,
    indirectMessageProps,
    indirectArgumentViolations,
    moduleDirectStringAliases,
    literalLocalInitializers,
    scopedLiteralLocals,
    parameterDefaultSearchParameters,
  };
}

function scriptKindForFileName(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function findShippedMessageViolations(fileName: string, sourceText: string): ShippedMessageViolation[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindForFileName(fileName));
  const violations: ShippedMessageViolation[] = [];
  const moduleBindings = collectModuleLetteredBindings(source);
  const moduleRenderedStringBindings = collectModuleRenderedStringBindings(source);
  const moduleFunctions = collectModuleShippedFunctions(source);
  const moduleDirectStringFunctions = collectModuleDirectStringShippedFunctions(source);
  const fileModuleDirectStringAliases = collectModuleDirectStringFunctionAliases(source);
  const moduleMessageObjectInitializers = collectModuleMessageObjectInitializers(source);
  const moduleMessageArrayInitializers = collectModuleMessageArrayInitializers(source);
  const fileUndocumentedPropNames = collectFileUndocumentedShippedPropNames(
    source,
    moduleBindings,
    moduleFunctions,
    moduleMessageObjectInitializers,
    moduleMessageArrayInitializers,
  );
  const { initializers: callSiteParameterInitializers, parameterContexts: callSiteParameterContexts } =
    collectCallSiteParameterInitializers(source);
  const interfaceMessageProps = collectUndocumentedMessageInterfaceProps(source);

  function lineOf(node: ts.Node): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }

  let functionLikeDepth = 0;
  const scopedLiteralLocalsStack: Map<string, number>[] = [new Map()];
  const scopedLiteralInitializersStack: Map<string, ts.Expression>[] = [new Map()];
  const scopedParametersStack: ts.ParameterDeclaration[][] = [[]];

  function mergedEnclosingParameters(): ts.ParameterDeclaration[] {
    return scopedParametersStack.flat();
  }

  function currentOuterLiteralLocals(): Map<string, number> {
    return scopedLiteralLocalsStack[scopedLiteralLocalsStack.length - 1] ?? new Map();
  }

  function currentOuterLiteralInitializers(): Map<string, ts.Expression> {
    return scopedLiteralInitializersStack[scopedLiteralInitializersStack.length - 1] ?? new Map();
  }

  function visit(node: ts.Node): void {
    const entersFunctionLike =
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      (ts.isMethodDeclaration(node) && node.body !== undefined);

    if (entersFunctionLike) {
      functionLikeDepth++;
      const body = "body" in node ? node.body : undefined;
      const {
        literalBindings,
        undocumentedPropNames,
        messageCallParameters,
        indirectMessageProps,
        indirectArgumentViolations,
        moduleDirectStringAliases,
        literalLocalInitializers,
        scopedLiteralLocals,
        parameterDefaultSearchParameters,
      } = analyzeFunctionLiteralBindings(
        node.parameters,
        body,
        source,
        moduleBindings,
        moduleFunctions,
        moduleDirectStringFunctions,
        fileModuleDirectStringAliases,
        fileUndocumentedPropNames,
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        currentOuterLiteralLocals(),
        currentOuterLiteralInitializers(),
        mergedEnclosingParameters(),
        functionLikeDeclarationName(node),
        callSiteParameterInitializers,
        callSiteParameterContexts,
      );
      const mergedUndocumentedPropNames = new Set([...fileUndocumentedPropNames, ...undocumentedPropNames]);
      const mergedDirectStringAliases = new Map([...fileModuleDirectStringAliases, ...moduleDirectStringAliases]);
      if (body !== undefined) {
        checkRenderedLocalReferences(
          body,
          scopedLiteralLocals,
          mergedUndocumentedPropNames,
          interfaceMessageProps,
          moduleDirectStringFunctions,
          mergedDirectStringAliases,
          moduleRenderedStringBindings,
          literalLocalInitializers,
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
          moduleBindings,
          moduleFunctions,
          fileName,
          source,
          violations,
          node.parameters,
          parameterDefaultSearchParameters,
          messageCallParameters,
        );
      }
      for (const [propName, line] of indirectMessageProps) {
        violations.push({ file: fileName, line, kind: "rendered-local", text: propName });
      }
      for (const violation of indirectArgumentViolations) {
        violations.push({ file: fileName, line: violation.line, kind: violation.kind, text: violation.text });
      }
      const nextLocals = new Map(scopedLiteralLocals);
      for (const [name, line] of literalBindings) {
        nextLocals.set(name, line);
      }
      for (const name of literalLocalInitializers.keys()) {
        if (nextLocals.has(name)) continue;
        nextLocals.set(name, 1);
      }
      const nextInitializers = new Map([
        ...currentOuterLiteralInitializers(),
        ...literalLocalInitializers,
      ]);
      scopedLiteralLocalsStack.push(nextLocals);
      scopedLiteralInitializersStack.push(nextInitializers);
      scopedParametersStack.push([...mergedEnclosingParameters(), ...node.parameters]);
    }

    if (functionLikeDepth === 0 && ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (declaration.initializer === undefined) continue;
        const init = unwrapExpression(declaration.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) continue;
        checkRenderedLocalReferences(
          declaration.initializer,
          new Map(),
          fileUndocumentedPropNames,
          interfaceMessageProps,
          moduleDirectStringFunctions,
          fileModuleDirectStringAliases,
          moduleRenderedStringBindings,
          new Map(),
          moduleMessageObjectInitializers,
          moduleMessageArrayInitializers,
          moduleBindings,
          moduleFunctions,
          fileName,
          source,
          violations,
        );
      }
    }

    if (functionLikeDepth === 0 && ts.isExpressionStatement(node)) {
      checkRenderedLocalReferences(
        node.expression,
        new Map(),
        fileUndocumentedPropNames,
        interfaceMessageProps,
        moduleDirectStringFunctions,
        fileModuleDirectStringAliases,
        moduleRenderedStringBindings,
        new Map(),
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        moduleBindings,
        moduleFunctions,
        fileName,
        source,
        violations,
      );
    }

    if (functionLikeDepth === 0 && ts.isExportAssignment(node) && !node.isExportEquals) {
      checkRenderedLocalReferences(
        node.expression,
        new Map(),
        fileUndocumentedPropNames,
        interfaceMessageProps,
        moduleDirectStringFunctions,
        fileModuleDirectStringAliases,
        moduleRenderedStringBindings,
        new Map(),
        moduleMessageObjectInitializers,
        moduleMessageArrayInitializers,
        moduleBindings,
        moduleFunctions,
        fileName,
        source,
        violations,
      );
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
      if (name.startsWith("aria-") && name !== "aria-hidden" && name !== "aria-live") {
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
    if (entersFunctionLike) {
      functionLikeDepth--;
      scopedLiteralLocalsStack.pop();
      scopedLiteralInitializersStack.pop();
      scopedParametersStack.pop();
    }
  }

  visit(source);
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.line}:${violation.kind}:${violation.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    expect(findShippedMessageViolations("Example.tsx", memberRead)).toEqual([]);

    const methodCall = [
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "interface ExampleProps { statGridLabel?: (index: number) => string; }",
      "export function Example({ statGridLabel = defaultStatGridLabel }: ExampleProps, messages: { statGridLabel: (index: number) => string }) {",
      "  return <span>{messages.statGridLabel(1)}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", methodCall)).toEqual([]);

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
    expect(findShippedMessageViolations("Example.tsx", optionalChaining)).toEqual([]);

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

  it("does not fail a documented message prop identifier without a call", () => {
    const source = [
      "interface ExampleProps {",
      "  /** @default \"Capture form\" */",
      "  formLabel?: string;",
      "}",
      "export function Example({ formLabel = \"Capture form\" }: ExampleProps) {",
      "  return <section aria-label={formLabel} />;",
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

  it("fails message call locals even when the prop default is documented with @default", () => {
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
    expect(findShippedMessageViolations("Pagination.tsx", source)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "rangeSummary" }),
    ]);
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
    expect(findShippedMessageViolations("Example.tsx", memberAnd)).toEqual([]);

    const callAnd = [
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "interface ExampleProps { statGridLabel?: (index: number) => string; show?: boolean; }",
      "export function Example({ show, statGridLabel = defaultStatGridLabel }: ExampleProps, messages: { statGridLabel: (index: number) => string }) {",
      "  return <span>{show && messages.statGridLabel(1)}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", callAnd)).toEqual([]);

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
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "messages" })]),
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
    expect(findShippedMessageViolations("Example.tsx", stringKey)).toEqual([]);

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

  it("notes fix round 10 binding, helper, property-name, and module-scope forms", () => {
    const wrappedModuleDefault = [
      "const DEFAULT_LABEL = \"Search\";",
      "interface ExampleProps { label?: string; }",
      "export function Example({ label = (DEFAULT_LABEL) }: ExampleProps) { return <span>{label}</span>; }",
      "export function ExampleNonNull({ label = DEFAULT_LABEL! }: ExampleProps) { return <span>{label}</span>; }",
      "export function ExampleAs({ label = DEFAULT_LABEL as string }: ExampleProps) { return <span>{label}</span>; }",
      "export function ExampleSatisfies({ label = DEFAULT_LABEL satisfies string }: ExampleProps) { return <span>{label}</span>; }",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", wrappedModuleDefault)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "label" })]),
    );

    const wrappedHelpers = [
      "const ready = true;",
      "const name = \"Save\";",
      "const helperIife = (() => ready || \"Save changes\");",
      "const helperSatisfies = () => (name ?? \"Save changes\") satisfies string;",
      "const helper = () => \"Save changes\";",
      "const get = helper;",
      "export function Example() {",
      "  const text = helper();",
      "  return (",
      "    <>",
      "      <button>{helperIife()}</button>",
      "      <button>{text}</button>",
      "      <button>{helperSatisfies()}</button>",
      "      <button>{get()}</button>",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", wrappedHelpers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "helperIife" }),
        expect.objectContaining({ kind: "rendered-local", text: "text" }),
        expect.objectContaining({ kind: "rendered-local", text: "helperSatisfies" }),
        expect.objectContaining({ kind: "rendered-local", text: "get" }),
      ]),
    );

    const stringPropertyNames = [
      "import { createElement } from \"react\";",
      "export function Example({ ready }: { ready?: boolean }) {",
      "  return (",
      "    <>",
      "      <section {...(ready ? { \"aria-label\": \"Capture form\" } : { \"aria-label\": \"Done\" })} />",
      "      {createElement(\"section\", extra ?? { \"aria-label\": \"Capture form\" })}",
      "    </>",
      "  );",
      "}",
      "const extra = {};",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", stringPropertyNames)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Capture form" }),
        expect.objectContaining({ kind: "jsx-text", text: "Done" }),
      ]),
    );

    const stringKeyDefault = [
      "export function Example({ field: { placeholder } = { \"placeholder\": \"Search\" } }: { field: { placeholder?: string } }) {",
      "  return <span>{placeholder}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", stringKeyDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "placeholder" }),
    ]);

    const arrayParameterDefault = [
      "export function Example({ items: [placeholder] = [\"Search\"] }: { items: string[] }) {",
      "  return <input placeholder={placeholder} />;",
      "}",
      "export function ExampleObject({ placeholder } = { placeholder: \"Search\" }) {",
      "  return <input placeholder={placeholder} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", arrayParameterDefault)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "placeholder" })]),
    );

    const createElementArraysAndModule = [
      "import { createElement } from \"react\";",
      "export function Example({ ready, value }: { ready?: boolean; value?: string[] | null }) {",
      "  return createElement(\"span\", null, ready ? [\"Save changes\"] : null, ready && [\"Save changes\"], value ?? [\"Save changes\"]);",
      "}",
      "export const field = createElement(\"span\", null, \"Save changes\");",
      "export const fieldTitle = createElement(\"section\", ready ? { title: \"Capture form\" } : { title: \"Done\" });",
      "const ready = true;",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", createElementArraysAndModule)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
        expect.objectContaining({ kind: "jsx-text", text: "Capture form" }),
        expect.objectContaining({ kind: "jsx-text", text: "Done" }),
      ]),
    );

    const shorthandSpread = [
      "import { createElement } from \"react\";",
      "const alt = \"Diagram\";",
      "const extra = { alt: \"Diagram\" };",
      "export function Example({ ready }: { ready?: boolean }) {",
      "  return (",
      "    <>",
      "      {createElement(\"img\", { alt })}",
      "      <img {...{ alt }} />",
      "      <img {...(ready ? extra : {})} />",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", shorthandSpread)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "alt" }),
        expect.objectContaining({ kind: "jsx-text", text: "Diagram" }),
      ]),
    );

    const moduleScopeAria = [
      "const ready = true;",
      "const name = \"Name\";",
      "export const field = <section aria-label={ready ? \"Capture form\" : \"Done\"} />;",
      "export const fieldOr = <section aria-label={\"Capture form\" || name} />;",
      "export const fieldAnd = <section aria-label={ready && \"Capture form\"} />;",
      "export const fieldParen = <section aria-label={(\"Capture form\")} />;",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", moduleScopeAria)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Capture form" }),
        expect.objectContaining({ kind: "jsx-text", text: "Done" }),
      ]),
    );

    const moduleMessageRendered = [
      "const message = \"Save changes\";",
      "const messageParen = (\"Save changes\");",
      "const messageAs = \"Save changes\" as string;",
      "const messageBang = \"Save changes\"!;",
      "const messageSatisfies = \"Save changes\" satisfies string;",
      "export function Example() {",
      "  return (",
      "    <>",
      "      <button>{message}</button>",
      "      <button>{messageParen}</button>",
      "      <button>{messageAs}</button>",
      "      <button>{messageBang}</button>",
      "      <button>{messageSatisfies}</button>",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", moduleMessageRendered)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "message" })]),
    );
  });

  it("notes fix round 11 createElement, binding, module, helper, and render forms", () => {
    const nestedCreateElementArrays = [
      'import { createElement } from "react";',
      "export function Example({ ready, value }: { ready?: boolean; value?: string[] | null }) {",
      '  return createElement("span", null, ready ? ["Save changes"] : null, ready && ["Save changes"], value ?? ["Save changes"]);',
      "}",
      'export const field = createElement("span", null, (ready ? ["Save changes"] : null));',
      "const ready = true;",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", nestedCreateElementArrays)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "jsx-text", text: "Save changes" })]),
    );

    const quotedBindingNames = [
      'export function ExampleA({ "placeholder": placeholder } = { "placeholder": "Search" }) {',
      "  return <input placeholder={placeholder} />;",
      "}",
      'export function ExampleB({ ["placeholder"]: placeholder } = { ["placeholder"]: "Search" }) {',
      "  return <input placeholder={placeholder} />;",
      "}",
      'export function ExampleC({ field: { "placeholder": placeholder } = { "placeholder": "Search" } }: { field: { placeholder?: string } }) {',
      "  return <input placeholder={placeholder} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", quotedBindingNames)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "placeholder" })]),
    );

    const wrappedComputedKeys = [
      "export function Example() {",
      '  return (',
      "    <>",
      '      <section {...{ [("aria-label")]: "Capture form" }} />',
      '      <section {...{ ["aria-label" as string]: "Capture form" }} />',
      '      <section {...{ ["aria-label"!]: "Capture form" }} />',
      '      <section {...{ ["aria-label" satisfies string]: "Capture form" }} />',
      "    </>",
      "  );",
      "}",
      'import { createElement } from "react";',
      'export const input = createElement("input", { [("placeholder")]: "Search" });',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", wrappedComputedKeys)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "jsx-text", text: "Capture form" })]),
    );

    const moduleAliasesAndLogical = [
      'const DEFAULT_LABEL = "Search";',
      "const ALIAS = (DEFAULT_LABEL);",
      "const ALIAS_NON_NULL = DEFAULT_LABEL!;",
      "const ALIAS_AS = DEFAULT_LABEL as string;",
      "const ALIAS_SATISFIES = DEFAULT_LABEL satisfies string;",
      "const ready = true;",
      'const name = "Name";',
      'const messageCond = ready ? "Save changes" : "Done";',
      'const messageOr = name || "Save changes";',
      'const messageAnd = ready && "Save changes";',
      'const messageNullish = name ?? "Save changes";',
      'const messageConcat = "Save " + "changes";',
      "export function Example() {",
      "  return (",
      "    <>",
      "      <span>{ALIAS}</span>",
      "      <input placeholder={ALIAS_NON_NULL} />",
      "      <input placeholder={ALIAS_AS} />",
      "      <input placeholder={ALIAS_SATISFIES} />",
      "      <button>{messageCond}</button>",
      "      <button>{messageOr}</button>",
      "      <button>{messageAnd}</button>",
      "      <button>{messageNullish}</button>",
      "      <button>{messageConcat}</button>",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", moduleAliasesAndLogical)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "ALIAS" }),
        expect.objectContaining({ kind: "rendered-local", text: "messageCond" }),
        expect.objectContaining({ kind: "rendered-local", text: "messageConcat" }),
      ]),
    );

    const helperAliasesAndWrappedCalls = [
      'const helper = () => "Save changes";',
      "const get = (helper);",
      "interface ExampleProps { label?: () => string; }",
      "export function Example({ label = get, labelNonNull = (get)! }: ExampleProps) {",
      "  return (",
      "    <>",
      "      <button>{label()}</button>",
      "      <button>{(get)()}</button>",
      "      <button>{get!()}</button>",
      "      <button>{(get as () => string)()}</button>",
      "      <button>{get()}</button>",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", helperAliasesAndWrappedCalls)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "label" }),
        expect.objectContaining({ kind: "rendered-local", text: "get" }),
      ]),
    );

    const createElementPropsVariable = [
      'import { createElement } from "react";',
      'const extra = { "aria-label": "Capture form", alt: "Diagram" };',
      "export function Example({ ready }: { ready?: boolean }) {",
      '  return (',
      "    <>",
      '      {createElement("img", extra)}',
      '      {createElement("img", { ...extra })}',
      '      {createElement("section", ready ? extra : { "aria-label": "Done" })}',
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", createElementPropsVariable)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "jsx-text", text: "Capture form" }),
        expect.objectContaining({ kind: "jsx-text", text: "Diagram" }),
        expect.objectContaining({ kind: "jsx-text", text: "Done" }),
      ]),
    );

    const nonMessageDefaults = [
      "export function ExampleA({ items: [caption] = [\"Save changes\"] }: { items: string[] }) {",
      "  return <span>{caption}</span>;",
      "}",
      'export function ExampleB(caption = "Save changes") {',
      "  return <span>{caption}</span>;",
      "}",
      'export function Example([caption] = ["Save changes"]) {',
      "  return <span>{caption}</span>;",
      "}",
      "export function ExampleA({ items: [text] = [\"Save changes\"] }: { items: string[] }) {",
      "  return <span>{text}</span>;",
      "}",
      'export function ExampleB(text = "Save changes") {',
      "  return <span>{text}</span>;",
      "}",
      'export function E([{ caption }] = [{ caption: "Save changes" }]) { return <span>{caption}</span>; }',
      'export function E({ items: [{ caption }] } = { items: [{ caption: "Save changes" }] }) { return <span>{caption}</span>; }',
      'export function E([x, [caption]] = ["1", ["Save changes"]]) { return <span>{x}{caption}</span>; }',
      'const D = { label: "Save changes" }; export function E({ label } = D) { return <span>{label}</span>; }',
      'const ITEMS = ["Save changes"]; export function E([caption] = ITEMS) { return <span>{caption}</span>; }',
      'export function f(mode = "strict mode") { return g(mode); } function g(x: string) { return x.length; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nonMessageDefaults)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "caption" }),
        expect.objectContaining({ kind: "rendered-local", text: "text" }),
        expect.objectContaining({ kind: "rendered-local", text: "label" }),
      ]),
    );
    expect(findShippedMessageViolations("Example.tsx", nonMessageDefaults)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "mode" })]),
    );

    const renderConcatenation = [
      'import { createElement } from "react";',
      "export function Example() {",
      "  return (",
      "    <>",
      '      <span>{"Save " + "changes"}</span>',
      '      {createElement("span", null, "Save " + "changes")}',
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", renderConcatenation)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "jsx-text", text: '"Save " + "changes"' })]),
    );
  });

  it("notes fix round 16 member slices and module expression statements", () => {
    const memberSliceSilent = [
      'function show(row: { id: string; caption: string }) { return <span>{row.caption}</span>; }',
      'export function E(row = { id: "Save changes", caption: "1" }) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", memberSliceSilent)).toEqual([]);

    const bracketCaption = [
      'function show(row: { caption: string }) { return <span>{row["caption"]}</span>; }',
      'export function E(row = { caption: "Save changes" }) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", bracketCaption)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const modeLength = ['export function f(mode = "strict mode") { return <span>{mode.length}</span>; }', ""].join("\n");
    expect(findShippedMessageViolations("Example.tsx", modeLength)).toEqual([]);

    const propertyCaption = [
      'function show(row: { caption: string }) { return <span>{row.caption}</span>; }',
      'export function E(row = { caption: "Save changes" }) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", propertyCaption)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const moduleExpressionStatement = [
      'import { createElement } from "react";',
      'createElement("span", { children: "Save changes" });',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", moduleExpressionStatement)).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
    ]);

    const moduleExportDefault = [
      'import { createElement } from "react";',
      'export default createElement("span", { children: "Save changes" });',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", moduleExportDefault)).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
    ]);

    const moduleCreateElementChild = [
      'import { createElement } from "react";',
      'createElement("span", null, "Save changes");',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.ts", moduleCreateElementChild)).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
    ]);
  });

  it("notes fix round 17 member slices, array indexes, and prop-name independence", () => {
    const conditionalObjectMember = [
      'export function E(row = true ? { id: "Save changes", caption: "1" } : { id: "1", caption: "1" }) { return <span>{row.caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", conditionalObjectMember)).toEqual([]);

    const stringDefaultBracketMember = [
      'export function E(row = "Save changes") { return <span>{row["caption"]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", stringDefaultBracketMember)).toEqual([]);

    const arrayIndexSilent = [
      'export function E(row = ["Save changes", "1"]) { return <span>{row[1]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", arrayIndexSilent)).toEqual([]);

    const arrayIndexNoted = [
      'function show(row: string[]) { return <span>{row[1]}</span>; }',
      'export function E(row = ["1", "Save changes"]) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", arrayIndexNoted)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const arrayStringIndexNoted = [
      'function show(row: string[]) { return <span>{row["1"]}</span>; }',
      'export function E(row = ["1", "Save changes"]) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", arrayStringIndexNoted)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const unrelatedCaptionDefault = [
      'export function E(caption = "Save changes", row = { caption: "1" }) { return <span>{row.caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", unrelatedCaptionDefault)).toEqual([]);

    const renderedCaptionParam = ['export function E(caption = "Save changes") { return <span>{caption}</span>; }', ""].join(
      "\n",
    );
    expect(findShippedMessageViolations("Example.tsx", renderedCaptionParam)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);
  });

  it("notes fix round 18 conditionals, indexes, helpers, destructuring, and length keys", () => {
    const conditionalObjectMember = [
      'export function E(row = true ? { caption: "Save changes" } : { caption: "1" }) { return <span>{row.caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", conditionalObjectMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const nullishObjectMember = [
      'export function E(row = null ?? { caption: "Save changes" }) { return <span>{row.caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nullishObjectMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const conditionalArrayIndexSilent = [
      'export function E(row = true ? ["Save changes", "1"] : ["nope", "1"]) { return <span>{row[1]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", conditionalArrayIndexSilent)).toEqual([]);

    const shortArrayIndexSilent = [
      'export function E(row = ["Save changes"]) { return <span>{row[1]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", shortArrayIndexSilent)).toEqual([]);

    const stringDefaultIndexSilent = [
      'export function E(row = "Save changes") { return <span>{row[1]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", stringDefaultIndexSilent)).toEqual([]);

    const helperConditionalObject = [
      'function show(row: { caption: string }) { return <span>{row.caption}</span>; }',
      'export function E(row = true ? { caption: "Save changes" } : { caption: "Also save" }) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", helperConditionalObject)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const helperConditionalArray = [
      'function show(row: string[]) { return <span>{row[1]}</span>; }',
      'export function E(row = true ? ["1", "Save changes"] : ["1", "1"]) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", helperConditionalArray)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const siblingCaptionDestructuring = [
      'export function E(caption = "Save changes", row = { caption: "1" }) { const { caption: title } = row; return <span>{title}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", siblingCaptionDestructuring)).toEqual([]);

    const indirectLengthKey = [
      'function g(row: { length: string }) { return <span>{row["length"]}</span>; }',
      'export function E(row = { length: "Save changes" }) { return g(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", indirectLengthKey)).toEqual([]);
  });

  it("notes fix round 19 slices, helpers, indexes, and render positions", () => {
    const siblingMemberReadSilent = [
      'export function E(nodeChapterFallbackTitle = "Widget", messages: { nodeChapterFallbackTitle: string }) {',
      "  const title = messages.nodeChapterFallbackTitle;",
      "  return <span>{title}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", siblingMemberReadSilent)).toEqual([]);

    const siblingBracketMemberReadSilent = [
      'export function E(nodeChapterFallbackTitle = "Widget", messages: { nodeChapterFallbackTitle: string }) {',
      '  const title = messages["nodeChapterFallbackTitle"];',
      "  return <span>{title}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", siblingBracketMemberReadSilent)).toEqual([]);

    const memberCallThroughHelper = [
      "function show(row: { caption: () => string }) { return <span>{row.caption()}</span>; }",
      'export function E(row = { caption: () => "Save changes" }) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", memberCallThroughHelper)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const directReturnHelperSilent = [
      "function renderBlock(messages: { nodeChapterFallbackTitle: string; statGridLabel: (index: number) => string }) {",
      "  const title = messages.nodeChapterFallbackTitle;",
      "  return title;",
      "}",
      "export function compileConsumerTemplateBlocks({",
      '  nodeChapterFallbackTitle = "Widget",',
      "  statGridLabel = () => `Stat ${1}`,",
      "}: { nodeChapterFallbackTitle?: string; statGridLabel?: (index: number) => string }) {",
      "  const messages = { nodeChapterFallbackTitle, statGridLabel };",
      "  return renderBlock(messages);",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", directReturnHelperSilent)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "messages" })]),
    );

    const variableArrayIndex = [
      'export function E(row = ["1", "Save changes"], i: number) { return <span>{row[i]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", variableArrayIndex)).toEqual([]);

    const conditionalCallArgument = [
      'function show(row: { caption: string }) { return <span>{row.caption}</span>; }',
      'export function E(row = { caption: "Save changes" }) { return show(true ? row : { caption: "1" }); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", conditionalCallArgument)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const unwrappedMemberReads = [
      'export function E(row = { caption: "Save changes" }) {',
      "  return (",
      "    <>",
      "      <span>{(row).caption}</span>",
      '      <span>{(row)["caption"]}</span>',
      "      <span>{row!.caption}</span>",
      "      <span>{(row as { caption: string }).caption}</span>",
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", unwrappedMemberReads)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "row" })]),
    );

    const nestedMemberRead = [
      'export function E(row = { meta: { caption: "Save changes" } }) { return <span>{row.meta.caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nestedMemberRead)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const arrayDestructuring = [
      'export function E(row = ["1", "Save changes"]) { const [, title] = row; return <span>{title}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", arrayDestructuring)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const jsxChildrenAttribute = ['export function E() { return <span children="Save changes" />; }', ""].join("\n");
    expect(findShippedMessageViolations("Example.tsx", jsxChildrenAttribute)).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
    ]);

    const explicitMessageProperty = [
      'export function E(caption = "Save changes") {',
      "  const messages = { caption: caption };",
      "  return () => show(messages);",
      "}",
      "function show(row: { caption: string }) { return <span>{row.caption}</span>; }",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", explicitMessageProperty)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "messages" })]),
    );
  });

  it("notes fix round 20 brackets, helpers, aliases, and binding forms", () => {
    const parenthesizedBracketMember = [
      'export function E(row = { caption: "Save changes" }) { return <span>{(row)["caption"]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", parenthesizedBracketMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const parenthesizedBracketThroughHelper = [
      "function show(row: { caption: string }) { return <span>{(row)[\"caption\"]}</span>; }",
      'export function E(row = { caption: "Save changes" }) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", parenthesizedBracketThroughHelper)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const parenthesizedBracketIndex = [
      'export function E(row = ["1", "Save changes"]) { return <span>{(row)[1]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", parenthesizedBracketIndex)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const nonNullBracketMember = [
      'export function E(row = { caption: "Save changes" }) { return <span>{row!["caption"]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nonNullBracketMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const assertionBracketMember = [
      'export function E(row = { caption: "Save changes" }) { return <span>{(row as { caption: string })["caption"]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", assertionBracketMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const nestedBracketMember = [
      'export function E(row = { meta: { caption: "Save changes" } }) { return <span>{row["meta"].caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nestedBracketMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const nestedBracketChain = [
      'export function E(row = { meta: { caption: "Save changes" } }) { return <span>{row["meta"]["caption"]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nestedBracketChain)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const nestedHelperForward = [
      "function inner(row: { caption: string }) { return <span>{row.caption}</span>; }",
      "function show(row: { caption: string }) { return inner(row); }",
      'export function E(row = { caption: "Save changes" }) { return show(row); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nestedHelperForward)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const objectLiteralCallArgument = [
      "function show(row: { caption: string }) { return <span>{row.caption}</span>; }",
      'export function E() { return show({ caption: "Save changes" }); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", objectLiteralCallArgument)).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Save changes" }),
    ]);

    const aliasMemberRead = [
      'export function E(row = { caption: "Save changes" }) { const copy = row; return <span>{copy.caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", aliasMemberRead)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "copy" }),
    ]);

    const nestedDestructuring = [
      'export function E(row = { meta: { caption: "Save changes" } }) { const { meta: { caption: title } } = row; return <span>{title}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nestedDestructuring)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const spreadDefaultObject = [
      'export function E(row = { ...{ caption: "Save changes" } }) { return <span>{row.caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", spreadDefaultObject)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const commaExpressionMember = [
      'export function E(row = { caption: "Save changes" }) { return <span>{(0, row.caption)}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", commaExpressionMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const restObjectMember = [
      'export function E(row = { id: "1", caption: "Save changes" }) { const { id, ...rest } = row; return <span>{rest.caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", restObjectMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "rest" }),
    ]);
  });

  it("notes fix round 21 member calls, string-key calls, defaults, copies, and indexes", () => {
    const onlyMemberCall = [
      "import { createElement } from \"react\";",
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "function renderBlock(messages: { nodeChapterFallbackTitle: string; statGridLabel: (index: number) => string }) {",
      "  return createElement(\"span\", { className: \"sr-only\" }, messages.statGridLabel(1));",
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
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", onlyMemberCall)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "messages" }),
    ]);

    const onlyMemberCallAlias = onlyMemberCall.replaceAll("messages", "copy");
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", onlyMemberCallAlias)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "copy" }),
    ]);

    const stringKeyCalls = [
      'export function E(row = { caption: () => "Save changes" }) {',
      "  return (",
      "    <>",
      '      <span>{row["caption"]()}</span>',
      '      <span>{(row)["caption"]()}</span>',
      '      <span>{row!["caption"]()}</span>',
      '      <span>{(row as { caption: () => string })["caption"]()}</span>',
      "    </>",
      "  );",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", stringKeyCalls)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "row" })]),
    );

    const nestedStringKeyCall = [
      'export function E(row = { meta: { caption: () => "Save changes" } }) { return <span>{row["meta"]["caption"]()}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nestedStringKeyCall)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const literalStringKeyCall = [
      'export function E(row = { caption: () => "1" }) { return <span>{row["caption"]()}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", literalStringKeyCall)).toEqual([]);

    const copiedCaptionElement = [
      'export function Example(caption = "Save changes") { const row = [caption]; return <span>{row[0]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", copiedCaptionElement)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const copiedCaptionThroughHelper = [
      "function show(row: string[]) { return <span>{row[0]}</span>; }",
      'export function Example(caption = "Save changes") { return show([caption]); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", copiedCaptionThroughHelper)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const copiedCaptionWithDefault = [
      "interface ExampleProps { /** @default \"Save changes\" */ caption?: string; }",
      'export function Example({ caption = "Save changes" }: ExampleProps) { const row = [caption]; return <span>{row[0]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", copiedCaptionWithDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const literalCopiedCaptionElement = [
      'export function Example(caption = "Save changes") { const row = ["1"]; return <span>{row[0]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", literalCopiedCaptionElement)).toEqual([]);

    const conditionalArrayVariableIndex = [
      'export function E(row = true ? ["1", "Save changes"] : ["1", "1"], i: number) { return <span>{row[i]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", conditionalArrayVariableIndex)).toEqual([]);

    const nullishArrayVariableIndex = [
      'export function E(row = null ?? ["1", "Save changes"], i: number) { return <span>{row[i]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nullishArrayVariableIndex)).toEqual([]);

    const logicalOrArrayVariableIndex = [
      'export function E(row = ["1", "1"] || ["1", "Save changes"], i: number) { return <span>{row[i]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", logicalOrArrayVariableIndex)).toEqual([]);

    const nullishArrayFixedIndex = [
      'export function E(row = null ?? ["1", "Save changes"]) { return <span>{row[1]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nullishArrayFixedIndex)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const nullishArrayFixedIndexSilent = [
      'export function E(row = null ?? ["Save changes", "1"]) { return <span>{row[1]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", nullishArrayFixedIndexSilent)).toEqual([]);

    const compileConsumerTemplateBlocksPath = path.join(SRC_ROOT, "internal/compileConsumerTemplateBlocks.ts");
    expect(findShippedMessageViolations(compileConsumerTemplateBlocksPath, readFileSync(compileConsumerTemplateBlocksPath, "utf8"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "messages", line: 66 }),
        expect.objectContaining({ kind: "rendered-local", text: "messages", line: 79 }),
      ]),
    );
  });

  it("finds no shipped message literals under publisher src/web", () => {
    const allowedRenderedLocalPaths = new Set([
      path.join(SRC_ROOT, "internal/compileConsumerTemplateBlocks.ts"),
      path.join(SRC_ROOT, "views/SystemAuditView.tsx"),
    ]);
    expect(
      scanShippedMessageTree(SRC_ROOT).filter((violation) => !allowedRenderedLocalPaths.has(violation.file)),
    ).toEqual([]);
  });

  it("notes fix round 22 inline calls, exempt members, and copied slices", () => {
    const inlineRangeSummary = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  return <p>{rangeSummaryMessage(1, 10, 100)}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", inlineRangeSummary)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "rangeSummaryMessage" }),
    ]);

    const nestedTernaryInlineCall = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "  noResultsLabel?: string;",
      "  totalItems?: number;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage, noResultsLabel = \"No results\", totalItems }: ExampleProps) {",
      "  return <p>{totalItems === 0 ? noResultsLabel : rangeSummaryMessage(1, 10, totalItems ?? 0)}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", nestedTernaryInlineCall)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "rangeSummaryMessage" })]),
    );

    const childrenInlineCall = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  return <span children={rangeSummaryMessage(1, 10, 100)} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", childrenInlineCall)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "rangeSummaryMessage" }),
    ]);

    const toggleLabelNullish = [
      "function defaultToggleLabel(_c: string, _n: string, labels: { system: string }): string { return `Theme: ${labels.system}`; }",
      "interface ExampleProps {",
      "  /** @default Theme */",
      "  toggleLabel?: typeof defaultToggleLabel;",
      "  preferenceLabels?: { system: string };",
      "}",
      "export function Example({ toggleLabel = defaultToggleLabel, preferenceLabels = { system: \"System\" } }: ExampleProps) {",
      "  return <button aria-label={undefined ?? toggleLabel(\"system\", \"light\", preferenceLabels)} />;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("ThemeToggle.tsx", toggleLabelNullish)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "toggleLabel" })]),
    );

    const preferenceAnnouncementLiveRegion = [
      "function defaultPreferenceAnnouncement(_n: string, labels: { light: string }): string { return `Theme set to ${labels.light}`; }",
      "interface ExampleProps {",
      "  /** @default Theme set */",
      "  preferenceAnnouncement?: typeof defaultPreferenceAnnouncement;",
      "  preferenceLabels?: { light: string };",
      "}",
      "export function Example({ preferenceAnnouncement = defaultPreferenceAnnouncement, preferenceLabels = { light: \"Light\" } }: ExampleProps) {",
      "  return <span role=\"status\" aria-live=\"polite\">{preferenceAnnouncement(\"light\", preferenceLabels)}</span>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("ThemeToggle.tsx", preferenceAnnouncementLiveRegion)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "preferenceAnnouncement" })]),
    );

    expect(findShippedMessageViolations("Example.tsx", `export function Example() { return <span aria-hidden="Save changes" />; }`)).toEqual([]);

    const ariaHiddenMember = [
      'export function Example() { const row = { "aria-hidden": "Save changes" }; return <span>{row["aria-hidden"]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", ariaHiddenMember)).toEqual([]);

    expect(findShippedMessageViolations("Example.tsx", `export function Example() { return <span aria-live="Save changes" />; }`)).toEqual([]);

    const ariaLiveMember = [
      'export function Example() { const row = { "aria-live": "Save changes" }; return <span>{row["aria-live"]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", ariaLiveMember)).toEqual([]);

    const glyphMember = [
      'export function Example() { const row = { glyph: "Save changes" }; return <span>{row.glyph}{row["glyph"]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", glyphMember)).toEqual([]);

    const displayNameMember = [
      'export function Example() { const row = { displayName: "Save changes" }; return <span>{row.displayName}{row["displayName"]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", displayNameMember)).toEqual([]);

    const pathDataMember = [
      'export function Example() { const row = { d: "M10 Save changes" }; return <svg><path d="M0 0" />{row.d}{row["d"]}</svg>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", pathDataMember)).toEqual([]);

    const copiedIndexLocal = [
      'export function Example(caption = "Save changes") { const row = [caption]; const title = row[0]; return <span>{title}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", copiedIndexLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const copiedIndexThroughLabel = [
      'export function Example(caption = "Save changes") { const label = caption; const row = [label]; return <span>{row[0]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", copiedIndexThroughLabel)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const copiedIndexFromLocal = [
      'export function Example() { const caption = "Save changes"; const row = [caption]; return <span>{row[0]}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", copiedIndexFromLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const copiedObjectShorthand = [
      'export function Example() { const caption = "Save changes"; const row = { caption }; return <span>{row.caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", copiedObjectShorthand)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);
  });

  it("notes fix round 23 parameter defaults, slices, calls, and aliases", () => {
    const parameterDefaultTag = [
      'export function Example(/** @default "Save changes" */ caption = "Save changes") { return <span>{caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", parameterDefaultTag)).toEqual([]);

    const documentedNameDoesNotSilenceLocal = [
      'interface Other { /** @default "Widget" */ title?: string }',
      'export function Example(caption = "Save changes") { const row = [caption]; const title = row[0]; return <span>{title}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", documentedNameDoesNotSilenceLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const siblingPropDoesNotAccuseMember = [
      'export function Other(caption = "Save changes") { return <span />; }',
      "export function Example(messages: { caption: string }) { const title = messages.caption; return <span>{title}</span>; }",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", siblingPropDoesNotAccuseMember)).toEqual([]);

    const rangeSummaryHelper = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const row = [rangeSummaryMessage(1, 10, 100)];",
      "  return <p>{row[0]}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", rangeSummaryHelper)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const storedCallArrayIndex = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = rangeSummaryMessage(1, 10, 100);",
      "  const row = [rangeSummary];",
      "  return <p>{row[0]}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", storedCallArrayIndex)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const storedCallIndexLocal = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = rangeSummaryMessage(1, 10, 100);",
      "  const row = [rangeSummary];",
      "  const title = row[0];",
      "  return <p>{title}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", storedCallIndexLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const storedCallObjectMember = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = rangeSummaryMessage(1, 10, 100);",
      "  const row = { caption: rangeSummary };",
      "  return <p>{row.caption}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", storedCallObjectMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const copiedFunctionMemberCall = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const row = { caption: rangeSummaryMessage };",
      "  return <p>{row.caption(1, 10, 100)}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", copiedFunctionMemberCall)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const parenthesizedCallLocal = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = (rangeSummaryMessage)(1, 10, 100);",
      "  return <p>{rangeSummary}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", parenthesizedCallLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "rangeSummary" }),
    ]);

    const nonNullCallLocal = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = rangeSummaryMessage!(1, 10, 100);",
      "  return <p>{rangeSummary}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", nonNullCallLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "rangeSummary" }),
    ]);

    const numericCopyIsSilent = [
      'export function Example(caption = "1") { const label = caption; return <span>{label}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", numericCopyIsSilent)).toEqual([]);
  });

  it("notes fix round 24 binding defaults, destructuring, and member slices", () => {
    const unusedInterfaceDoesNotExempt = [
      'interface ExampleProps { /** @default "Save changes" */ caption?: string }',
      'export function Other(caption = "Save changes") { return <span>{caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", unusedInterfaceDoesNotExempt)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);

    const siblingFunctionDefaultTag = [
      'export function Example(/** @default "Save changes" */ caption = "Save changes") { return <span />; }',
      'export function Other(caption = "Save changes") { return <span>{caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", siblingFunctionDefaultTag)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);

    const rangeSummaryHelper = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = rangeSummaryMessage(1, 10, 100);",
      "  const row = [rangeSummary];",
      "  const [title] = row;",
      "  return <p>{title}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", rangeSummaryHelper)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const storedCallMemberLocal = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = rangeSummaryMessage(1, 10, 100);",
      "  const row = { caption: rangeSummary };",
      "  const title = row.caption;",
      "  return <p>{title}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", storedCallMemberLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const storedCallMemberStringKeyLocal = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const rangeSummary = rangeSummaryMessage(1, 10, 100);",
      "  const row = { caption: rangeSummary };",
      '  const title = row["caption"];',
      "  return <p>{title}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", storedCallMemberStringKeyLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const copiedFunctionMemberCallLocal = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const row = { caption: rangeSummaryMessage };",
      "  const title = row.caption;",
      "  return <p>{title(1, 10, 100)}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", copiedFunctionMemberCallLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const copiedFunctionMemberStringKeyCallLocal = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "interface ExampleProps {",
      "  /** @default `Showing ${start}–${end} of ${total}` */",
      "  rangeSummaryMessage?: (start: number, end: number, total: number) => string;",
      "}",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: ExampleProps) {",
      "  const row = { caption: rangeSummaryMessage };",
      '  const title = row["caption"];',
      "  return <p>{title(1, 10, 100)}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", copiedFunctionMemberStringKeyCallLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);
  });

  it("notes fix round 25 aliases, literals, indexes, defaults, and destructuring", () => {
    const renamedCopyLocal = [
      "import { createElement } from \"react\";",
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "function renderBlock(messages: { nodeChapterFallbackTitle: string; statGridLabel: (index: number) => string }) {",
      "  return createElement(\"span\", { className: \"sr-only\" }, messages.nodeChapterFallbackTitle, messages.statGridLabel(1));",
      "}",
      "export function compileConsumerTemplateBlocks({",
      "  nodeChapterFallbackTitle = \"Widget\",",
      "  statGridLabel = defaultStatGridLabel,",
      "}: { nodeChapterFallbackTitle?: string; statGridLabel?: (index: number) => string }) {",
      "  const copy = { nodeChapterFallbackTitle, statGridLabel };",
      "  return () => renderBlock(copy);",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", renamedCopyLocal)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "messages" }),
      ]),
    );

    const objectLiteralArgument = [
      "import { createElement } from \"react\";",
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "function renderBlock(messages: { nodeChapterFallbackTitle: string; statGridLabel: (index: number) => string }) {",
      "  return createElement(\"span\", { className: \"sr-only\" }, messages.nodeChapterFallbackTitle, messages.statGridLabel(1));",
      "}",
      "export function compileConsumerTemplateBlocks({",
      "  nodeChapterFallbackTitle = \"Widget\",",
      "  statGridLabel = defaultStatGridLabel,",
      "}: { nodeChapterFallbackTitle?: string; statGridLabel?: (index: number) => string }) {",
      "  return () => renderBlock({ nodeChapterFallbackTitle, statGridLabel });",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", objectLiteralArgument)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "rendered-local", text: "messages" }),
      ]),
    );

    const missingIndexCopiedLocal = [
      'export function Example(row = ["Save changes"]) { const title = row[1]; return <span>{title}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", missingIndexCopiedLocal)).toEqual([]);

    const parenthesizedIndexCopiedLocal = [
      "function defaultRangeSummaryMessage(start: number, end: number, total: number): string { return `Showing ${start}–${end} of ${total}`; }",
      "export function Example({ rangeSummaryMessage = defaultRangeSummaryMessage }: { rangeSummaryMessage?: (start: number, end: number, total: number) => string }) {",
      "  const rangeSummary = rangeSummaryMessage(1, 10, 100);",
      "  const row = [rangeSummary];",
      "  const title = (row)[0];",
      "  return <p>{title}</p>;",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Pagination.tsx", parenthesizedIndexCopiedLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const nonNullIndexCopiedLocal = parenthesizedIndexCopiedLocal.replace("const title = (row)[0];", "const title = row![0];");
    expect(findShippedMessageViolations("Pagination.tsx", nonNullIndexCopiedLocal)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const sameLineInterfaceDefault = [
      'interface ExampleProps { /** @default "Save changes" */ caption?: string }',
      'export function Example({ caption = "Save changes" }: ExampleProps) { return <span>{caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", sameLineInterfaceDefault)).toEqual([]);

    const sameLineBindingDefault = [
      'export function Example({ /** @default "Save changes" */ caption = "Save changes" }) { return <span>{caption}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", sameLineBindingDefault)).toEqual([]);

    const defaultDoesNotExemptTemplate = [
      'export function Example(/** @default "Save changes" */ caption = "Save changes") { return <span>{`${caption}`}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", defaultDoesNotExemptTemplate)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);

    const defaultDoesNotExemptNullish = [
      'export function Example(/** @default "Save changes" */ caption = "Save changes") { return <span>{caption ?? "1"}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", defaultDoesNotExemptNullish)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);

    const defaultDoesNotExemptCall = [
      "function show(value: string) { return <span>{value}</span>; }",
      'export function Example(/** @default "Save changes" */ caption = "Save changes") { return show(caption); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", defaultDoesNotExemptCall)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);

    const destructureFromCallResult = [
      'function getRow(): { caption: string } { return { caption: "1" }; }',
      'export function Example(caption = "Save changes") { const { caption: title } = getRow(); return <span>{title}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", destructureFromCallResult)).toEqual([]);
  });

  it("notes fix round 26 plus, callee unwrap, argument unwrap, call slices, aliases, and @default", () => {
    const plusDefault = [
      'export function Example(/** @default "Save changes" */ caption = "Save changes") { return <span>{caption + ""}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", plusDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);

    const plusNoDefault = plusDefault.replace('/** @default "Save changes" */ ', "");
    expect(findShippedMessageViolations("Example.tsx", plusNoDefault)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);

    const indirectCallee = [
      "function show(value: string) { return <span>{value}</span>; }",
      'export function Example(/** @default "Save changes" */ caption = "Save changes") { return (show)(caption); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", indirectCallee)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);

    const nonNullCallee = indirectCallee.replace("return (show)(caption);", "return show!(caption);");
    expect(findShippedMessageViolations("Example.tsx", nonNullCallee)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);

    const renderBlockIndirect = [
      "import { createElement } from \"react\";",
      "function defaultStatGridLabel(index: number): string { return `Stat ${index}`; }",
      "function renderBlock(messages: { nodeChapterFallbackTitle: string; statGridLabel: (index: number) => string }) {",
      "  return createElement(\"span\", { className: \"sr-only\" }, messages.nodeChapterFallbackTitle, messages.statGridLabel(1));",
      "}",
      "export function compileConsumerTemplateBlocks({",
      "  nodeChapterFallbackTitle = \"Widget\",",
      "  statGridLabel = defaultStatGridLabel,",
      "}: { nodeChapterFallbackTitle?: string; statGridLabel?: (index: number) => string }) {",
      "  const copy = { nodeChapterFallbackTitle, statGridLabel };",
      "  return () => (renderBlock)(copy);",
      "}",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", renderBlockIndirect)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "messages" })]),
    );

    const renderBlockNonNull = renderBlockIndirect.replace("return () => (renderBlock)(copy);", "return () => renderBlock!(copy);");
    expect(findShippedMessageViolations("compileConsumerTemplateBlocks.ts", renderBlockNonNull)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "rendered-local", text: "messages" })]),
    );

    const wrappedArgument = [
      "function show(value: string) { return <span>{value}</span>; }",
      'export function Example(/** @default "Save changes" */ caption = "Save changes") { return show((caption)); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", wrappedArgument)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);
    expect(
      findShippedMessageViolations(
        "Example.tsx",
        wrappedArgument.replace("show((caption))", "show(caption!)"),
      ),
    ).toEqual([expect.objectContaining({ kind: "rendered-local", text: "caption" })]);
    expect(
      findShippedMessageViolations(
        "Example.tsx",
        wrappedArgument.replace("show((caption))", "show(caption as string)"),
      ),
    ).toEqual([expect.objectContaining({ kind: "rendered-local", text: "caption" })]);

    const wrappedCallArgument = [
      "function show(value: string) { return <span>{value}</span>; }",
      'export function Example(/** @default "Save changes" */ caption = "Save changes", on = true) { return show(caption ?? "1"); }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", wrappedCallArgument)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);
    expect(
      findShippedMessageViolations(
        "Example.tsx",
        wrappedCallArgument.replace('caption ?? "1"', "on && caption"),
      ),
    ).toEqual([expect.objectContaining({ kind: "rendered-local", text: "caption" })]);

    const callResultMember = [
      'function getRow(): { caption: string } { return { caption: "Save changes" }; }',
      "export function Example(caption = \"Save changes\") { const row = getRow(); return <span>{row.caption}</span>; }",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", callResultMember)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "row" }),
    ]);

    const callResultAlias = [
      'function getRow(): { caption: string } { return { caption: "Save changes" }; }',
      "export function Example(caption = \"Save changes\") { const get = getRow; const { caption: title } = get(); return <span>{title}</span>; }",
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", callResultAlias)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "title" }),
    ]);

    const defaultExemptWrappers = [
      'export function Example(/** @default "Save changes" */ caption = "Save changes") { return <span>{(caption)}</span>; }',
      "",
    ].join("\n");
    expect(findShippedMessageViolations("Example.tsx", defaultExemptWrappers)).toEqual([]);
    expect(
      findShippedMessageViolations("Example.tsx", defaultExemptWrappers.replace("{caption}", "{caption!}")),
    ).toEqual([]);
    expect(
      findShippedMessageViolations(
        "Example.tsx",
        defaultExemptWrappers.replace("{caption}", "{caption as string}"),
      ),
    ).toEqual([]);
    expect(
      findShippedMessageViolations(
        "Example.tsx",
        defaultExemptWrappers.replace("{caption}", "{caption satisfies string}"),
      ),
    ).toEqual([]);

    const noDefaultWrappers = defaultExemptWrappers.replace('/** @default "Save changes" */ ', "");
    expect(findShippedMessageViolations("Example.tsx", noDefaultWrappers)).toEqual([
      expect.objectContaining({ kind: "rendered-local", text: "caption" }),
    ]);
  });

});
