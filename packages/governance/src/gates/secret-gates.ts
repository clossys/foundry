import type {
  CredentialInventory,
  CredentialInventoryEntry,
  CredentialSurfaceObservation,
  LocalFileObservation,
  LocalSecretFileOptions,
  ProviderResourceNamingRule,
  ProviderResourceObservation,
  RawSecretReadOptions,
  SecretCatalogGateDocument,
  SecretCatalogGateEntry,
  SecretGateFinding,
  SecretReadinessObservation,
} from "./secret-types.js";
import ts from "typescript";

const SECRET_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const CREDENTIAL_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SENSITIVE_SUFFIX = /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|PASSCODE|SALT|PRIVATE_KEY|CONNECTION_STRING)$/;
const DEFAULT_SENSITIVE_NAMES = new Set(["DATABASE_URL"]);
const SECRET_ENV_BASENAME = /^\.env(?:rc)?(?:\..+)?$/;
const EXAMPLE_SUFFIXES = [".example", ".sample", ".template", ".dist"];

function finding(
  rule: string,
  severity: SecretGateFinding["severity"],
  message: string,
  path?: string,
): SecretGateFinding {
  return { rule, severity, message, ...(path === undefined ? {} : { path }) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractExecutableMdx(body: string): string {
  const visible = [...body];
  const mask = (start: number, end: number): void => {
    for (let index = start; index < end; index += 1) {
      if (visible[index] !== "\n" && visible[index] !== "\r") visible[index] = " ";
    }
  };
  const lines = body.split(/(?<=\n)/);
  let offset = 0;
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of lines) {
    const trimmed = line.trimStart();
    const match = /^(`{3,}|~{3,})/.exec(trimmed);
    if (match !== null) {
      const delimiter = match[1] as string;
      const marker = delimiter[0] as "`" | "~";
      if (fence === null) {
        fence = { marker, length: delimiter.length };
      } else if (
        marker === fence.marker &&
        delimiter.length >= fence.length &&
        trimmed.slice(delimiter.length).trim().length === 0
      ) {
        fence = null;
      }
      mask(offset, offset + line.length);
    } else if (fence !== null) {
      mask(offset, offset + line.length);
    }
    offset += line.length;
  }
  let commentStart = body.indexOf("<!--");
  while (commentStart !== -1) {
    const close = body.indexOf("-->", commentStart + 4);
    const commentEnd = close === -1 ? body.length : close + 3;
    mask(commentStart, commentEnd);
    commentStart = body.indexOf("<!--", commentEnd);
  }
  const visibleBody = visible.join("");
  const executable: string[] = [...body].map((character) =>
    character === "\n" || character === "\r" ? character : " ");
  const moduleRanges: Array<{ start: number; end: number }> = [];
  const moduleStatement = /^\s{0,3}(?:import|export)\b/gm;
  for (let match = moduleStatement.exec(visibleBody); match !== null; match = moduleStatement.exec(visibleBody)) {
    const start = match.index;
    const moduleSource = ts.createSourceFile(
      "module.mdx.tsx",
      visibleBody.slice(start),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const statement = moduleSource.statements[0];
    if (statement === undefined) continue;
    const end = start + statement.end;
    moduleRanges.push({ start, end });
    for (let index = start; index < end; index += 1) executable[index] = visible[index] ?? " ";
    moduleStatement.lastIndex = end;
  }
  for (let start = 0; start < visibleBody.length;) {
    const moduleRange = moduleRanges.find((range) => range.start <= start && range.end > start);
    if (moduleRange !== undefined) {
      start = moduleRange.end;
      continue;
    }
    if (visibleBody[start] === "`") {
      let delimiterEnd = start + 1;
      while (visibleBody[delimiterEnd] === "`") delimiterEnd += 1;
      const delimiter = "`".repeat(delimiterEnd - start);
      let close = visibleBody.indexOf(delimiter, delimiterEnd);
      while (
        close !== -1 &&
        (visibleBody[close - 1] === "`" || visibleBody[close + delimiter.length] === "`")
      ) {
        close = visibleBody.indexOf(delimiter, close + delimiter.length);
      }
      start = close === -1 ? delimiterEnd : close + delimiter.length;
      continue;
    }
    if (visibleBody[start] !== "{") {
      start += 1;
      continue;
    }
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, visibleBody.slice(start));
    let depth = 0;
    let end: number | null = null;
    const templateDepths: number[] = [];
    let previousToken: ts.SyntaxKind | undefined;
    // A regular expression can begin wherever an expression can begin. Keep
    // this explicit rather than treating every non-terminating token as an
    // operator: keywords such as `return` and punctuation such as `{` are
    // valid starts too, while an identifier followed by `/` is division.
    const regularExpressionPrefixTokens = new Set<ts.SyntaxKind>([
      ts.SyntaxKind.OpenBraceToken,
      ts.SyntaxKind.OpenParenToken,
      ts.SyntaxKind.OpenBracketToken,
      ts.SyntaxKind.CommaToken,
      ts.SyntaxKind.SemicolonToken,
      ts.SyntaxKind.TypeOfKeyword,
      ts.SyntaxKind.VoidKeyword,
      ts.SyntaxKind.DeleteKeyword,
      ts.SyntaxKind.AwaitKeyword,
      ts.SyntaxKind.YieldKeyword,
      ts.SyntaxKind.ReturnKeyword,
      ts.SyntaxKind.ThrowKeyword,
      ts.SyntaxKind.CaseKeyword,
      ts.SyntaxKind.ElseKeyword,
      ts.SyntaxKind.DoKeyword,
      ts.SyntaxKind.InstanceOfKeyword,
      ts.SyntaxKind.InKeyword,
      ts.SyntaxKind.OfKeyword,
      ts.SyntaxKind.NewKeyword,
    ]);
    const allowsRegularExpression = (token: ts.SyntaxKind | undefined): boolean =>
      token === undefined ||
      regularExpressionPrefixTokens.has(token) ||
      (token >= ts.SyntaxKind.FirstBinaryOperator &&
        token <= ts.SyntaxKind.LastBinaryOperator &&
        token !== ts.SyntaxKind.LessThanSlashToken &&
        token !== ts.SyntaxKind.PlusPlusToken &&
        token !== ts.SyntaxKind.MinusMinusToken &&
        token !== ts.SyntaxKind.AtToken &&
        token !== ts.SyntaxKind.BacktickToken &&
        token !== ts.SyntaxKind.HashToken);
    for (let scanned = scanner.scan(); scanned !== ts.SyntaxKind.EndOfFileToken; scanned = scanner.scan()) {
      const token =
        (scanned === ts.SyntaxKind.SlashToken || scanned === ts.SyntaxKind.SlashEqualsToken) &&
        allowsRegularExpression(previousToken)
          ? scanner.reScanSlashToken()
          : scanned;
      if (token === ts.SyntaxKind.OpenBraceToken) depth += 1;
      if (token === ts.SyntaxKind.TemplateHead) templateDepths.push(depth);
      if (token === ts.SyntaxKind.CloseBraceToken) {
        if (templateDepths.at(-1) === depth) {
          const templateToken = scanner.reScanTemplateToken(false);
          if (templateToken === ts.SyntaxKind.TemplateTail) templateDepths.pop();
          previousToken = templateToken;
          continue;
        }
        depth -= 1;
        if (depth === 0) {
          end = start + scanner.getTextPos();
          break;
        }
      }
      if (
        token < ts.SyntaxKind.FirstTriviaToken ||
        token > ts.SyntaxKind.LastTriviaToken
      ) {
        previousToken = token;
      }
    }
    if (end === null) {
      start += 1;
      continue;
    }
    for (let index = start; index < end; index += 1) executable[index] = visible[index] ?? " ";
    start = end;
  }
  return executable.join("");
}

export function checkSecretName(name: string, path?: string): SecretGateFinding[] {
  const findings: SecretGateFinding[] = [];
  if (typeof name !== "string") {
    findings.push(finding("secrets/name-shape", "error", "Secret key must be a string.", path));
    return findings;
  }
  if (name.length === 0) {
    findings.push(finding("secrets/name-empty", "error", "Secret key must not be empty.", path));
    return findings;
  }
  if (name.length > 128) {
    findings.push(finding("secrets/name-length", "error", "Secret key must be at most 128 characters.", path));
  }
  if (!SECRET_NAME.test(name)) {
    findings.push(
      finding(
        "secrets/name-format",
        "error",
        "Secret key must use uppercase underscore-separated segments and begin with a letter.",
        path,
      ),
    );
  }
  return findings;
}

export function detectRawSecretReads(
  input: { filePath: string; body: string },
  options: RawSecretReadOptions = {},
): SecretGateFinding[] {
  if (options.exempt === true) return [];
  const normalizeEnvironmentName = (name: string): string => name.toUpperCase();
  const sensitive = new Set(
    [...DEFAULT_SENSITIVE_NAMES, ...(options.sensitiveNames ?? [])].map(normalizeEnvironmentName),
  );
  const allowed = new Set((options.allowedNames ?? []).map(normalizeEnvironmentName));
  const matches: Array<{ index: number; finding: SecretGateFinding }> = [];
  const extension = input.filePath.toLowerCase();
  if (extension.endsWith(".md") || extension.endsWith(".markdown")) {
    return [];
  }
  const scriptKind = extension.endsWith(".tsx") || extension.endsWith(".mdx")
    ? ts.ScriptKind.TSX
    : extension.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : extension.endsWith(".js") || extension.endsWith(".mjs") || extension.endsWith(".cjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const body = extension.endsWith(".mdx") ? extractExecutableMdx(input.body) : input.body;
  const triviaSourceFile = ts.createSourceFile(input.filePath, body, ts.ScriptTarget.Latest, true, scriptKind);
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    scriptKind === ts.ScriptKind.JSX || scriptKind === ts.ScriptKind.TSX
      ? ts.LanguageVariant.JSX
      : ts.LanguageVariant.Standard,
    body,
  );
  const suppressedLines = new Set<number>();
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia &&
      /\/\/\s*(?:lint-allow|secrets-allow):/i.test(scanner.getTokenText())
    ) {
      suppressedLines.add(triviaSourceFile.getLineAndCharacterOfPosition(scanner.getTokenPos()).line);
    }
  }
  const programFilePath = extension.endsWith(".mdx") ? `${input.filePath}.tsx` : input.filePath;
  const sourceFile = ts.createSourceFile(programFilePath, body, ts.ScriptTarget.Latest, true, scriptKind);
  const compilerOptions: ts.CompilerOptions = {
    allowJs: scriptKind === ts.ScriptKind.JS || scriptKind === ts.ScriptKind.JSX,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const compilerHost = ts.createCompilerHost(compilerOptions, true);
  compilerHost.getSourceFile = (fileName) => fileName === programFilePath ? sourceFile : undefined;
  compilerHost.fileExists = (fileName) => fileName === programFilePath;
  compilerHost.readFile = (fileName) => fileName === programFilePath ? body : undefined;
  compilerHost.getDefaultLibFileName = () => "";
  const checker = ts.createProgram([programFilePath], compilerOptions, compilerHost).getTypeChecker();
  const unwrap = (expression: ts.Expression): ts.Expression => {
    let current = expression;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  };
  const staticString = (expression: ts.Expression | undefined): string | null => {
    if (expression === undefined) return null;
    const current = unwrap(expression);
    return ts.isStringLiteralLike(current) ? current.text : null;
  };
  const processModuleBindings = new Set<ts.Symbol>();
  const environmentModuleBindings = new Set<ts.Symbol>();
  const processDestructuringWrites = new Map<ts.Symbol, number[]>();
  const environmentDestructuringWrites = new Map<ts.Symbol, number[]>();
  const symbolAt = (identifier: ts.Identifier): ts.Symbol | undefined => checker.getSymbolAtLocation(identifier);
  const addBinding = (bindings: Set<ts.Symbol>, identifier: ts.Identifier): void => {
    const symbol = symbolAt(identifier);
    if (symbol !== undefined) bindings.add(symbol);
  };
  const recordEnvironmentDestructuringWrite = (identifier: ts.Identifier, activeAt: number): void => {
    const symbol = symbolAt(identifier);
    if (symbol === undefined) return;
    const writes = environmentDestructuringWrites.get(symbol) ?? [];
    writes.push(activeAt);
    environmentDestructuringWrites.set(symbol, writes);
  };
  const recordProcessDestructuringWrite = (identifier: ts.Identifier, activeAt: number): void => {
    const symbol = symbolAt(identifier);
    if (symbol === undefined) return;
    const writes = processDestructuringWrites.get(symbol) ?? [];
    writes.push(activeAt);
    processDestructuringWrites.set(symbol, writes);
  };
  const isProcessModuleName = (value: string | null): boolean => value === "node:process" || value === "process";
  const isStaticProcessRequire = (expression: ts.Expression): boolean => {
    const current = unwrap(expression);
    return (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === "require" &&
      symbolAt(current.expression) === undefined &&
      current.arguments.length === 1 &&
      isProcessModuleName(staticString(current.arguments[0]))
    );
  };
  const isStaticProcessImport = (expression: ts.Expression): boolean => {
    let current = unwrap(expression);
    let awaited = false;
    while (ts.isAwaitExpression(current)) {
      awaited = true;
      current = unwrap(current.expression);
    }
    return (
      awaited &&
      ts.isCallExpression(current) &&
      current.expression.kind === ts.SyntaxKind.ImportKeyword &&
      current.arguments.length === 1 &&
      isProcessModuleName(staticString(current.arguments[0]))
    );
  };
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && isProcessModuleName(staticString(statement.moduleSpecifier))) {
      const clause = statement.importClause;
      if (clause?.name !== undefined) addBinding(processModuleBindings, clause.name);
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        addBinding(processModuleBindings, bindings.name);
      } else if (bindings !== undefined) {
        for (const element of bindings.elements) {
          const importedName = (element.propertyName ?? element.name).text;
          if (importedName === "env") addBinding(environmentModuleBindings, element.name);
          if (importedName === "default") addBinding(processModuleBindings, element.name);
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression !== undefined &&
      isProcessModuleName(staticString(statement.moduleReference.expression))
    ) {
      addBinding(processModuleBindings, statement.name);
    }
  }
  type BindingWrite = {
    activeAt: number;
    conditional: boolean;
    owner: ts.Node;
    value: ts.Expression;
  };
  const flowOwnerOf = (node: ts.Node): ts.Node => {
    let current = node;
    while (current.parent !== undefined && !ts.isFunctionLike(current) && !ts.isSourceFile(current)) {
      current = current.parent;
    }
    return current;
  };
  const isConditionallyExecuted = (node: ts.Node, owner: ts.Node): boolean => {
    let current = node;
    while (current.parent !== undefined && current !== owner) {
      const parent = current.parent;
      if (
        (ts.isIfStatement(parent) && current !== parent.expression) ||
        (ts.isConditionalExpression(parent) && current !== parent.condition) ||
        (ts.isBinaryExpression(parent) &&
          current === parent.right &&
          (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) ||
        ((ts.isWhileStatement(parent) || ts.isDoStatement(parent)) && current === parent.statement) ||
        (ts.isForStatement(parent) && (current === parent.statement || current === parent.incrementor)) ||
        ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && current === parent.statement) ||
        ts.isCaseClause(parent) ||
        ts.isDefaultClause(parent) ||
        ts.isCatchClause(parent) ||
        ts.isTryStatement(parent)
      ) {
        return true;
      }
      current = parent;
    }
    return false;
  };
  const bindingWrites = new Map<ts.Symbol, BindingWrite[]>();
  const collectBindingWrites = (node: ts.Node): void => {
    let identifier: ts.Identifier | null = null;
    let value: ts.Expression | null = null;
    const activeAt = node.getEnd();
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      identifier = node.name;
      value = node.initializer;
    } else if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken) &&
      ts.isIdentifier(node.left)
    ) {
      identifier = node.left;
      value = node.right;
    }
    if (identifier !== null && value !== null) {
      const symbol = symbolAt(identifier);
      if (symbol !== undefined) {
        const owner = flowOwnerOf(node);
        const writes = bindingWrites.get(symbol) ?? [];
        writes.push({
          activeAt,
          conditional:
            (ts.isBinaryExpression(node) && node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) ||
            isConditionallyExecuted(node, owner),
          owner,
          value,
        });
        bindingWrites.set(symbol, writes);
      }
    }
    ts.forEachChild(node, collectBindingWrites);
  };
  collectBindingWrites(sourceFile);
  const collectHoistedHelperEffects = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const symbol = symbolAt(node.expression);
      const declaration = symbol?.declarations?.find(
        (candidate): candidate is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(candidate) && candidate.body !== undefined,
      );
      if (declaration !== undefined) {
        const callOwner = flowOwnerOf(node);
        const callIsConditional = isConditionallyExecuted(node, callOwner);
        for (const [binding, writes] of bindingWrites) {
          // A direct function call executes writes in its own body, but not
          // writes captured by nested callbacks that it merely declares.
          const directWrites = writes.filter((write) => write.owner === declaration);
          for (const [index, write] of directWrites.entries()) {
            bindingWrites.set(binding, [
              ...(bindingWrites.get(binding) ?? []),
              {
                // Keep writes from one helper call in source order so the
                // final unconditional assignment wins at a later read.
                activeAt: node.getEnd() + (index + 1) / (directWrites.length + 1),
                conditional: write.conditional || callIsConditional,
                owner: callOwner,
                value: write.value,
              },
            ]);
          }
        }
      }
    }
    ts.forEachChild(node, collectHoistedHelperEffects);
  };
  collectHoistedHelperEffects(sourceFile);
  const ownerContains = (outer: ts.Node, inner: ts.Node): boolean =>
    outer === inner || (outer.getStart(sourceFile) <= inner.getStart(sourceFile) && outer.getEnd() >= inner.getEnd());
  const reachingWrites = (symbol: ts.Symbol, use: ts.Identifier): BindingWrite[] => {
    const position = use.getStart(sourceFile);
    const useOwner = flowOwnerOf(use);
    return (bindingWrites.get(symbol) ?? [])
      .filter((write) =>
        write.activeAt < position || (write.owner !== useOwner && ownerContains(write.owner, useOwner)))
      .sort((left, right) => right.activeAt - left.activeAt);
  };
  const isDefinitelyReaching = (write: BindingWrite, use: ts.Identifier): boolean =>
    !write.conditional && write.activeAt < use.getStart(sourceFile) && ownerContains(write.owner, flowOwnerOf(use));
  const isGlobalObject = (expression: ts.Expression): boolean => {
    const current = unwrap(expression);
    if (!ts.isIdentifier(current) || (current.text !== "globalThis" && current.text !== "global")) return false;
    const symbol = symbolAt(current);
    return (
      symbol === undefined ||
      symbol.declarations === undefined ||
      symbol.declarations.length === 0
    );
  };
  const isProcessValue = (expression: ts.Expression, resolving: Set<ts.Symbol>): boolean => {
    const current = unwrap(expression);
    if (ts.isConditionalExpression(current)) {
      return (
        isProcessValue(current.whenTrue, new Set(resolving)) ||
        isProcessValue(current.whenFalse, new Set(resolving))
      );
    }
    // A comma expression evaluates its left side for effects, then returns its
    // right side. Only that final value can make the binding a process alias.
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return isProcessValue(current.right, resolving);
    }
    if (
      ts.isBinaryExpression(current) &&
      (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        current.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      return (
        isProcessValue(current.left, new Set(resolving)) ||
        isProcessValue(current.right, new Set(resolving))
      );
    }
    if (ts.isIdentifier(current)) {
      const symbol = symbolAt(current);
      if (symbol === undefined) return current.text === "process";
      if (resolving.has(symbol)) return false;
      const destructuringWrite = (processDestructuringWrites.get(symbol) ?? [])
        .filter((activeAt) => activeAt < current.getStart(sourceFile))
        .sort((left, right) => right - left)[0];
      resolving.add(symbol);
      const writes = reachingWrites(symbol, current);
      if (destructuringWrite !== undefined && (writes[0] === undefined || destructuringWrite > writes[0].activeAt)) {
        resolving.delete(symbol);
        return true;
      }
      for (const write of writes) {
        if (isProcessValue(write.value, resolving)) {
          resolving.delete(symbol);
          return true;
        }
        if (isDefinitelyReaching(write, current)) {
          resolving.delete(symbol);
          return false;
        }
      }
      resolving.delete(symbol);
      if (destructuringWrite !== undefined) return true;
      return processModuleBindings.has(symbol);
    }
    if (isStaticProcessRequire(current) || isStaticProcessImport(current)) return true;
    if (ts.isPropertyAccessExpression(current)) {
      return current.name.text === "process" && isGlobalObject(current.expression);
    }
    return (
      ts.isElementAccessExpression(current) &&
      isGlobalObject(current.expression) &&
      staticString(current.argumentExpression) === "process"
    );
  };
  const isProcess = (expression: ts.Expression): boolean => isProcessValue(expression, new Set());
  const isEnvironmentObjectValue = (expression: ts.Expression, resolving: Set<ts.Symbol>): boolean => {
    const current = unwrap(expression);
    if (ts.isIdentifier(current)) {
      const symbol = symbolAt(current);
      if (symbol === undefined || resolving.has(symbol)) return false;
      const writes = reachingWrites(symbol, current);
      const destructuringWrite = (environmentDestructuringWrites.get(symbol) ?? [])
        .filter((activeAt) => activeAt < current.getStart(sourceFile))
        .sort((left, right) => right - left)[0];
      if (writes.length === 0 && destructuringWrite === undefined) {
        return environmentModuleBindings.has(symbol);
      }
      if (destructuringWrite !== undefined && (writes[0] === undefined || destructuringWrite > writes[0].activeAt)) {
        return true;
      }
      resolving.add(symbol);
      for (const write of writes) {
        if (isEnvironmentObjectValue(write.value, resolving)) {
          resolving.delete(symbol);
          return true;
        }
        if (isDefinitelyReaching(write, current)) {
          resolving.delete(symbol);
          return false;
        }
      }
      resolving.delete(symbol);
      if (destructuringWrite !== undefined) return true;
      return environmentModuleBindings.has(symbol);
    }
    if (ts.isPropertyAccessExpression(current)) {
      return current.name.text === "env" && isProcess(current.expression);
    }
    return (
      ts.isElementAccessExpression(current) &&
      isProcess(current.expression) &&
      staticString(current.argumentExpression) === "env"
    );
  };
  const isEnvironmentObject = (expression: ts.Expression): boolean =>
    isEnvironmentObjectValue(expression, new Set());
  const destructuredEnvironmentReads: Array<{ key: string | null; node: ts.Node }> = [];
  const collectDestructuredEnvironmentReads = (pattern: ts.ObjectBindingPattern): void => {
    for (const element of pattern.elements) {
      let key: string | null;
      if (element.dotDotDotToken !== undefined) {
        key = null;
      } else if (element.propertyName === undefined) {
        key = ts.isIdentifier(element.name) ? element.name.text : null;
      } else if (ts.isComputedPropertyName(element.propertyName)) {
        key = staticString(element.propertyName.expression);
      } else {
        key = element.propertyName.text;
      }
      destructuredEnvironmentReads.push({ key, node: element });
    }
  };
  const collectEnvironmentBindings = (node: ts.Node): void => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.initializer !== undefined) {
      if (ts.isObjectBindingPattern(node.name) && isEnvironmentObject(node.initializer)) {
        collectDestructuredEnvironmentReads(node.name);
      } else if (ts.isObjectBindingPattern(node.name) && isProcess(node.initializer)) {
        for (const element of node.name.elements) {
          if (element.dotDotDotToken !== undefined) continue;
          const importedName = element.propertyName === undefined
            ? ts.isIdentifier(element.name) ? element.name.text : null
            : ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName)
              ? element.propertyName.text
              : null;
          if (importedName === "default" && ts.isIdentifier(element.name)) {
            recordProcessDestructuringWrite(element.name, node.getEnd());
          } else if (importedName !== "env") {
            continue;
          } else if (ts.isIdentifier(element.name)) {
            recordEnvironmentDestructuringWrite(element.name, node.getEnd());
          } else if (ts.isObjectBindingPattern(element.name)) {
            collectDestructuredEnvironmentReads(element.name);
          } else {
            destructuredEnvironmentReads.push({ key: null, node: element });
          }
        }
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = unwrap(node.left);
      if (ts.isObjectLiteralExpression(left) && isEnvironmentObject(node.right)) {
        for (const property of left.properties) {
          let key: string | null;
          if (ts.isSpreadAssignment(property)) {
            key = null;
          } else if (ts.isShorthandPropertyAssignment(property)) {
            key = property.name.text;
          } else if (ts.isPropertyAssignment(property)) {
            key = ts.isComputedPropertyName(property.name)
              ? staticString(property.name.expression)
              : property.name.text;
          } else {
            key = null;
          }
          destructuredEnvironmentReads.push({ key, node: property });
        }
      } else if (ts.isObjectLiteralExpression(left) && isProcess(node.right)) {
        for (const property of left.properties) {
          const propertyName = ts.isShorthandPropertyAssignment(property)
            ? property.name.text
            : ts.isPropertyAssignment(property)
              ? ts.isComputedPropertyName(property.name)
                ? staticString(property.name.expression)
                : property.name.text
              : null;
          if (propertyName === "default" && ts.isPropertyAssignment(property)) {
            const target = unwrap(property.initializer);
            if (ts.isIdentifier(target)) recordProcessDestructuringWrite(target, node.getEnd());
          } else if (propertyName !== "env") {
            continue;
          } else if (ts.isShorthandPropertyAssignment(property)) {
            recordEnvironmentDestructuringWrite(property.name, node.getEnd());
          } else if (ts.isPropertyAssignment(property)) {
            const target = unwrap(property.initializer);
            if (ts.isIdentifier(target)) {
              recordEnvironmentDestructuringWrite(target, node.getEnd());
            } else if (ts.isObjectLiteralExpression(target)) {
              for (const nestedProperty of target.properties) {
                let key: string | null;
                if (ts.isSpreadAssignment(nestedProperty)) {
                  key = null;
                } else if (ts.isShorthandPropertyAssignment(nestedProperty)) {
                  key = nestedProperty.name.text;
                } else if (ts.isPropertyAssignment(nestedProperty)) {
                  key = ts.isComputedPropertyName(nestedProperty.name)
                    ? staticString(nestedProperty.name.expression)
                    : nestedProperty.name.text;
                } else {
                  key = null;
                }
                destructuredEnvironmentReads.push({ key, node: nestedProperty });
              }
            } else {
              destructuredEnvironmentReads.push({ key: null, node: property });
            }
          }
        }
      }
    }
    ts.forEachChild(node, collectEnvironmentBindings);
  };
  collectEnvironmentBindings(sourceFile);
  const isTransparentExpression = (node: ts.Node): node is ts.Expression & { expression: ts.Expression } =>
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node);
  const isAccessBase = (node: ts.Expression): boolean => {
    let current: ts.Node = node;
    let parent = current.parent;
    while (parent !== undefined && isTransparentExpression(parent) && parent.expression === current) {
      current = parent;
      parent = current.parent;
    }
    return (
      parent !== undefined &&
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === current
    );
  };
  const isWriteOnlyAccess = (node: ts.Expression): boolean => {
    let current: ts.Node = node;
    let parent = current.parent;
    while (parent !== undefined) {
      if (isTransparentExpression(parent) && parent.expression === current) {
        current = parent;
        parent = current.parent;
        continue;
      }
      if (
        (ts.isPropertyAssignment(parent) && parent.initializer === current) ||
        (ts.isShorthandPropertyAssignment(parent) && parent.name === current) ||
        (ts.isSpreadAssignment(parent) && parent.expression === current)
      ) {
        current = parent.parent;
        parent = current.parent;
        continue;
      }
      break;
    }
    return (
      (parent !== undefined &&
        ts.isBinaryExpression(parent) &&
        parent.left === current &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
      (parent !== undefined && ts.isDeleteExpression(parent) && parent.expression === current)
    );
  };
  const isDestructuringEnvironmentSource = (node: ts.Expression): boolean => {
    let current: ts.Node = node;
    let parent = current.parent;
    while (parent !== undefined && isTransparentExpression(parent) && parent.expression === current) {
      current = parent;
      parent = current.parent;
    }
    return (
      (parent !== undefined &&
        ts.isVariableDeclaration(parent) &&
        parent.initializer === current &&
        ts.isObjectBindingPattern(parent.name)) ||
      (parent !== undefined &&
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        parent.right === current &&
        ts.isObjectLiteralExpression(unwrap(parent.left)))
    );
  };
  const isBindingOrPropertyName = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    return (
      (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node)) ||
      (ts.isImportClause(parent) && parent.name === node) ||
      (ts.isNamespaceImport(parent) && parent.name === node) ||
      (ts.isImportEqualsDeclaration(parent) && parent.name === node) ||
      (ts.isVariableDeclaration(parent) && parent.name === node) ||
      (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node)
    );
  };
  const pathAt = (node: ts.Node): string => {
    const position = node.getStart(sourceFile);
    return `${input.filePath}:${sourceFile.getLineAndCharacterOfPosition(position).line + 1}`;
  };
  const isSuppressed = (node: ts.Node): boolean =>
    suppressedLines.has(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line);
  const addComputedFinding = (node: ts.Node, message: string): void => {
    if (isSuppressed(node)) return;
    const index = node.getStart(sourceFile);
    matches.push({
      index,
      finding: finding("secrets/raw-env-computed-read", "error", message, pathAt(node)),
    });
  };
  const addRawFinding = (node: ts.Node, key: string): void => {
    if (isSuppressed(node)) return;
    const comparableKey = normalizeEnvironmentName(key);
    if (
      allowed.has(comparableKey) ||
      comparableKey.startsWith("NEXT_PUBLIC_") ||
      (!sensitive.has(comparableKey) && !SENSITIVE_SUFFIX.test(comparableKey))
    ) {
      return;
    }
    matches.push({
      index: node.getStart(sourceFile),
      finding: finding(
        "secrets/raw-env-read",
        "error",
        `Raw environment read of sensitive key ${JSON.stringify(key)} bypasses the injected secrets client.`,
        pathAt(node),
      ),
    });
  };
  for (const read of destructuredEnvironmentReads) {
    if (read.key === null) {
      addComputedFinding(
        read.node,
        "Computed environment read cannot be classified safely and bypasses the injected secrets client.",
      );
    } else {
      addRawFinding(read.node, read.key);
    }
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      isEnvironmentObject(node) &&
      !isBindingOrPropertyName(node) &&
      !isAccessBase(node) &&
      !isWriteOnlyAccess(node)
    ) {
      addComputedFinding(
        node,
        "Whole-environment read cannot be classified safely and bypasses the injected secrets client.",
      );
    } else if (
      ts.isPropertyAccessExpression(node) &&
      isEnvironmentObject(node.expression) &&
      !isWriteOnlyAccess(node)
    ) {
      addRawFinding(node, node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      isEnvironmentObject(node.expression) &&
      !isWriteOnlyAccess(node)
    ) {
      const key = staticString(node.argumentExpression);
      if (key === null) {
        addComputedFinding(
          node,
          "Computed environment read cannot be classified safely and bypasses the injected secrets client.",
        );
      } else {
        addRawFinding(node, key);
      }
    } else if (
      ts.isElementAccessExpression(node) &&
      isProcess(node.expression) &&
      staticString(node.argumentExpression) === null &&
      !isWriteOnlyAccess(node)
    ) {
      addComputedFinding(
        node,
        "Computed process member access cannot be classified safely and may bypass the injected secrets client.",
      );
    } else if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isEnvironmentObject(node) &&
      !isAccessBase(node) &&
      !isDestructuringEnvironmentSource(node) &&
      !isWriteOnlyAccess(node)
    ) {
      addComputedFinding(
        node,
        "Whole-environment read cannot be classified safely and bypasses the injected secrets client.",
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches.sort((left, right) => left.index - right.index).map((item) => item.finding);
}

function parseSecretCatalog(value: unknown): {
  document: SecretCatalogGateDocument | null;
  findings: SecretGateFinding[];
} {
  const findings: SecretGateFinding[] = [];
  if (!isObject(value)) {
    return {
      document: null,
      findings: [finding("secrets/catalog-shape", "error", "Secret catalog must be an object.")],
    };
  }
  const topLevelKeys = Object.keys(value);
  for (const key of topLevelKeys) {
    if (key !== "version" && key !== "entries") {
      findings.push(
        finding(
          "secrets/catalog-value-free",
          "error",
          `Secret catalog contains forbidden top-level property ${JSON.stringify(key)}.`,
          key,
        ),
      );
    }
  }
  if (value.version !== 1) {
    findings.push(finding("secrets/catalog-version", "error", "Secret catalog version must be 1.", "version"));
  }
  if (!Array.isArray(value.entries)) {
    findings.push(finding("secrets/catalog-shape", "error", "Secret catalog entries must be an array.", "entries"));
    return { document: null, findings };
  }
  if (value.entries.length === 0) {
    findings.push(
      finding("secrets/catalog-empty", "error", "Secret catalog must contain at least one entry when this gate is used.", "entries"),
    );
  }

  const entries: SecretCatalogGateEntry[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries.entries()) {
    const path = `entries[${index}]`;
    if (!isObject(item)) {
      findings.push(finding("secrets/catalog-shape", "error", "Catalog entry must be an object.", path));
      continue;
    }
    const allowed = new Set(["key", "required", "description", "group"]);
    for (const property of Object.keys(item)) {
      if (!allowed.has(property)) {
        findings.push(
          finding(
            "secrets/catalog-value-free",
            "error",
            `Catalog entry contains forbidden property ${JSON.stringify(property)}.`,
            `${path}.${property}`,
          ),
        );
      }
    }
    if (typeof item.key !== "string" || typeof item.required !== "boolean") {
      findings.push(
        finding("secrets/catalog-shape", "error", "Catalog entry requires string key and boolean required fields.", path),
      );
      continue;
    }
    findings.push(...checkSecretName(item.key, `${path}.key`));
    if (seen.has(item.key)) {
      findings.push(
        finding("secrets/catalog-duplicate", "error", `Catalog key ${JSON.stringify(item.key)} is duplicated.`, `${path}.key`),
      );
    }
    seen.add(item.key);
    if (item.description !== undefined && typeof item.description !== "string") {
      findings.push(finding("secrets/catalog-shape", "error", "Catalog description must be a string.", `${path}.description`));
    }
    if (item.group !== undefined && typeof item.group !== "string") {
      findings.push(finding("secrets/catalog-shape", "error", "Catalog group must be a string.", `${path}.group`));
    }
    entries.push({
      key: item.key,
      required: item.required,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      ...(typeof item.group === "string" ? { group: item.group } : {}),
    });
  }

  return {
    document: findings.some((item) => item.severity === "error") ? null : { version: 1, entries },
    findings,
  };
}

export function checkValueFreeSecretCatalog(value: unknown): SecretGateFinding[] {
  return parseSecretCatalog(value).findings;
}

export function checkSecretReadiness(
  catalog: unknown,
  observations: readonly SecretReadinessObservation[],
): SecretGateFinding[] {
  const parsed = parseSecretCatalog(catalog);
  const findings = [...parsed.findings];
  if (parsed.document === null) return findings;

  const observed = new Map<string, boolean>();
  for (const [index, observation] of observations.entries()) {
    if (!isObject(observation)) {
      findings.push(
        finding(
          "secrets/readiness-shape",
          "error",
          "Readiness observation requires string key and boolean present fields.",
          `observations[${index}]`,
        ),
      );
      continue;
    }
    if (Object.keys(observation).some((key) => key !== "key" && key !== "present")) {
      findings.push(
        finding(
          "secrets/readiness-value-free",
          "error",
          "Readiness observation contains fields outside key and present.",
          `observations[${index}]`,
        ),
      );
      continue;
    }
    if (typeof observation.key !== "string" || typeof observation.present !== "boolean") {
      findings.push(
        finding(
          "secrets/readiness-shape",
          "error",
          "Readiness observation requires string key and boolean present fields.",
          `observations[${index}]`,
        ),
      );
      continue;
    }
    if (observed.has(observation.key)) {
      findings.push(
        finding(
          "secrets/readiness-duplicate",
          "error",
          `Readiness observation for ${JSON.stringify(observation.key)} is duplicated.`,
          `observations[${index}]`,
        ),
      );
      continue;
    }
    observed.set(observation.key, observation.present);
  }
  const catalogKeys = new Set(parsed.document.entries.map((entry) => entry.key));
  for (const [key] of observed) {
    if (!catalogKeys.has(key)) {
      findings.push(
        finding(
          "secrets/readiness-unregistered",
          "error",
          `Readiness observed unregistered key ${JSON.stringify(key)}.`,
          key,
        ),
      );
    }
  }
  for (const entry of parsed.document.entries) {
    const present = observed.get(entry.key) ?? false;
    if (!present) {
      findings.push(
        finding(
          entry.required ? "secrets/readiness-required" : "secrets/readiness-optional",
          entry.required ? "error" : "warning",
          `${entry.required ? "Required" : "Optional"} catalog key ${JSON.stringify(entry.key)} is not ready.`,
          entry.key,
        ),
      );
    }
  }
  return findings;
}

function parseCredentialInventory(value: unknown): {
  inventory: CredentialInventory | null;
  findings: SecretGateFinding[];
} {
  const findings: SecretGateFinding[] = [];
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.credentials)) {
    return {
      inventory: null,
      findings: [
        finding(
          "secrets/credential-inventory-shape",
          "error",
          "Credential inventory must be a version 1 object with a credentials array.",
        ),
      ],
    };
  }
  for (const key of Object.keys(value)) {
    if (key !== "version" && key !== "credentials") {
      findings.push(
        finding(
          "secrets/credential-inventory-value-free",
          "error",
          `Credential inventory contains forbidden top-level property ${JSON.stringify(key)}.`,
          key,
        ),
      );
    }
  }
  if (value.credentials.length === 0) {
    findings.push(
      finding(
        "secrets/credential-inventory-empty",
        "error",
        "Credential inventory must contain at least one entry when this gate is used.",
        "credentials",
      ),
    );
  }
  const credentials: CredentialInventoryEntry[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const [index, valueEntry] of value.credentials.entries()) {
    const path = `credentials[${index}]`;
    if (!isObject(valueEntry)) {
      findings.push(finding("secrets/credential-inventory-shape", "error", "Credential entry must be an object.", path));
      continue;
    }
    const entryKeys = Object.keys(valueEntry);
    if (entryKeys.some((key) => !["id", "secretKey", "provider", "surfaces"].includes(key))) {
      findings.push(
        finding(
          "secrets/credential-inventory-value-free",
          "error",
          "Credential entry contains fields outside id, secretKey, provider, and surfaces.",
          path,
        ),
      );
    }
    if (
      typeof valueEntry.id !== "string" ||
      typeof valueEntry.secretKey !== "string" ||
      typeof valueEntry.provider !== "string" ||
      !Array.isArray(valueEntry.surfaces) ||
      !valueEntry.surfaces.every((surface) => typeof surface === "string")
    ) {
      findings.push(
        finding(
          "secrets/credential-inventory-shape",
          "error",
          "Credential entry requires id, secretKey, provider, and string surfaces.",
          path,
        ),
      );
      continue;
    }
    if (!CREDENTIAL_ID.test(valueEntry.id)) {
      findings.push(
        finding(
          "secrets/credential-id-format",
          "error",
          "Credential id must use lowercase hyphen-separated segments.",
          `${path}.id`,
        ),
      );
    }
    findings.push(...checkSecretName(valueEntry.secretKey, `${path}.secretKey`));
    if (valueEntry.provider.trim().length === 0) {
      findings.push(finding("secrets/credential-provider", "error", "Credential provider must not be empty.", `${path}.provider`));
    }
    const surfaces = valueEntry.surfaces as string[];
    if (surfaces.length === 0 || surfaces.some((surface) => surface.trim().length === 0)) {
      findings.push(finding("secrets/credential-surfaces", "error", "Credential surfaces must be non-empty strings.", `${path}.surfaces`));
    }
    if (new Set(surfaces).size !== surfaces.length) {
      findings.push(finding("secrets/credential-surfaces", "error", "Credential surfaces must be unique.", `${path}.surfaces`));
    }
    if (ids.has(valueEntry.id)) {
      findings.push(finding("secrets/credential-id-duplicate", "error", `Credential id ${JSON.stringify(valueEntry.id)} is duplicated.`, `${path}.id`));
    }
    if (keys.has(valueEntry.secretKey)) {
      findings.push(finding("secrets/credential-key-duplicate", "error", `Credential key ${JSON.stringify(valueEntry.secretKey)} is duplicated.`, `${path}.secretKey`));
    }
    ids.add(valueEntry.id);
    keys.add(valueEntry.secretKey);
    credentials.push({
      id: valueEntry.id,
      secretKey: valueEntry.secretKey,
      provider: valueEntry.provider,
      surfaces,
    });
  }
  return {
    inventory: findings.some((item) => item.severity === "error") ? null : { version: 1, credentials },
    findings,
  };
}

export function checkCredentialInventory(value: unknown): SecretGateFinding[] {
  return parseCredentialInventory(value).findings;
}

export function checkCredentialSurfaceDrift(
  inventory: unknown,
  observations: readonly CredentialSurfaceObservation[],
): SecretGateFinding[] {
  const parsed = parseCredentialInventory(inventory);
  const findings = [...parsed.findings];
  if (parsed.inventory === null) return findings;
  const declared = new Map(
    parsed.inventory.credentials.map((credential) => [credential.id, new Set(credential.surfaces)]),
  );
  const observed = new Map<string, Set<string>>();
  for (const [index, observation] of observations.entries()) {
    if (
      !isObject(observation) ||
      Object.keys(observation).some((key) => key !== "credentialId" && key !== "surface") ||
      typeof observation.credentialId !== "string" ||
      typeof observation.surface !== "string"
    ) {
      findings.push(
        finding(
          "secrets/credential-surface-observation-shape",
          "error",
          "Credential surface observation requires string credentialId and surface fields.",
          `observations[${index}]`,
        ),
      );
      continue;
    }
    const observedSurfaces = observed.get(observation.credentialId) ?? new Set<string>();
    if (observedSurfaces.has(observation.surface)) {
      findings.push(
        finding("secrets/credential-surface-observation-duplicate", "error", "Credential surface observation is duplicated.", `observations[${index}]`),
      );
    }
    observedSurfaces.add(observation.surface);
    observed.set(observation.credentialId, observedSurfaces);
    if (!declared.get(observation.credentialId)?.has(observation.surface)) {
      findings.push(
        finding(
          "secrets/credential-surface-undeclared",
          "error",
          `Observed surface ${JSON.stringify(observation.surface)} is not declared for credential ${JSON.stringify(observation.credentialId)}.`,
          `observations[${index}]`,
        ),
      );
    }
  }
  for (const credential of parsed.inventory.credentials) {
    for (const surface of credential.surfaces) {
      if (!observed.get(credential.id)?.has(surface)) {
        findings.push(
          finding(
            "secrets/credential-surface-missing",
            "error",
            `Declared surface ${JSON.stringify(surface)} was not observed for credential ${JSON.stringify(credential.id)}.`,
            credential.id,
          ),
        );
      }
    }
  }
  return findings;
}

export function checkLocalSecretFiles(
  files: readonly LocalFileObservation[],
  options: LocalSecretFileOptions = {},
): SecretGateFinding[] {
  const allowed = new Set(options.allowedPaths ?? []);
  const findings: SecretGateFinding[] = [];
  for (const [index, file] of files.entries()) {
    if (
      !isObject(file) ||
      Object.keys(file).some((key) => key !== "path" && key !== "tracked") ||
      typeof file.path !== "string" ||
      typeof file.tracked !== "boolean"
    ) {
      findings.push(
        finding("secrets/local-file-shape", "error", "Local file observation requires string path and boolean tracked fields.", `files[${index}]`),
      );
      continue;
    }
    const name = file.path.replaceAll("\\", "/").split("/").at(-1) ?? file.path;
    const comparableName = name.toLowerCase();
    if (
      !SECRET_ENV_BASENAME.test(comparableName) ||
      EXAMPLE_SUFFIXES.some((suffix) => comparableName.endsWith(suffix))
    ) continue;
    if (allowed.has(file.path)) continue;
    findings.push(
      finding(
        file.tracked ? "secrets/local-file-tracked" : "secrets/local-file-present",
        "error",
        file.tracked
          ? "Secret-bearing environment file is tracked."
          : "Secret-bearing environment file is present locally; use in-memory provider injection instead.",
        file.path,
      ),
    );
  }
  return findings;
}

export function checkProviderResourceNames(
  resources: readonly ProviderResourceObservation[],
  rules: readonly ProviderResourceNamingRule[],
): SecretGateFinding[] {
  const findings: SecretGateFinding[] = [];
  const ruleIdentities: Array<{ provider: string; kind: string | undefined }> = [];
  const compiled = rules.map((rule, index) => {
    if (
      !isObject(rule) ||
      Object.keys(rule).some((key) => key !== "provider" && key !== "kind" && key !== "pattern") ||
      typeof rule.provider !== "string" ||
      (rule.kind !== undefined && typeof rule.kind !== "string") ||
      typeof rule.pattern !== "string"
    ) {
      findings.push(
        finding(
          "secrets/provider-resource-rule-shape",
          "error",
          "Provider resource naming rule requires string provider and pattern fields and an optional string kind.",
          `rules[${index}]`,
        ),
      );
      return null;
    }
    if (ruleIdentities.some((identity) => identity.provider === rule.provider && identity.kind === rule.kind)) {
      findings.push(
        finding(
          "secrets/provider-resource-rule-duplicate",
          "error",
          "Provider resource naming rules must have unique provider and kind identities.",
          `rules[${index}]`,
        ),
      );
      return null;
    }
    ruleIdentities.push({ provider: rule.provider, kind: rule.kind });
    try {
      return { rule, pattern: new RegExp(`^(?:${rule.pattern})$`) };
    } catch {
      findings.push(
        finding(
          "secrets/provider-resource-rule-invalid",
          "error",
          `Provider resource naming rule ${index} has an invalid pattern.`,
          `rules[${index}]`,
        ),
      );
      return null;
    }
  });
  for (const [index, resource] of resources.entries()) {
    if (
      !isObject(resource) ||
      Object.keys(resource).some((key) => key !== "provider" && key !== "kind" && key !== "name" && key !== "path") ||
      typeof resource.provider !== "string" ||
      typeof resource.kind !== "string" ||
      typeof resource.name !== "string" ||
      (resource.path !== undefined && typeof resource.path !== "string")
    ) {
      findings.push(
        finding(
          "secrets/provider-resource-shape",
          "error",
          "Provider resource observation requires string provider, kind, and name fields and an optional string path.",
          `resources[${index}]`,
        ),
      );
      continue;
    }
    const match = compiled.find(
      (candidate) =>
        candidate !== null &&
        candidate.rule.provider === resource.provider &&
        candidate.rule.kind === resource.kind,
    ) ?? compiled.find(
      (candidate) => candidate !== null && candidate.rule.provider === resource.provider && candidate.rule.kind === undefined,
    );
    if (match === undefined || match === null) {
      findings.push(
        finding(
          "secrets/provider-resource-rule-missing",
          "error",
          `No naming rule covers provider ${JSON.stringify(resource.provider)} kind ${JSON.stringify(resource.kind)}.`,
          resource.path ?? `resources[${index}]`,
        ),
      );
    } else if (!match.pattern.test(resource.name)) {
      findings.push(
        finding(
          "secrets/provider-resource-name",
          "error",
          `Provider resource name ${JSON.stringify(resource.name)} does not match its configured convention.`,
          resource.path ?? `resources[${index}]`,
        ),
      );
    }
  }
  return findings;
}
