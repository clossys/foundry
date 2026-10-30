import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const textTags = new Set("p span h1 h2 h3 h4 h5 h6 small strong em b i label legend dt dd li code pre blockquote figcaption time summary caption th td option output".split(" "));
const interactiveTags = new Set("a button input select textarea details dialog form fieldset".split(" "));
const interactiveRoles = new Set("button link checkbox radio switch textbox combobox slider spinbutton tab menuitem option treeitem".split(" "));
const walkFiles = root => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walkFiles(path.join(root, entry.name)) : [path.join(root, entry.name)]);
const sourcePath = target => target.replace(/\/dist\//, "/src/").replace(/\.[cm]?js$/, ".ts");
const getText = node => ts.isStringLiteralLike(node) ? node.text : undefined;
const declarationKey = node => `${node.getSourceFile().fileName}:${node.pos}:${node.end}`;
const isType = node => ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isJSDoc(node);

/** Symbol closure, including local helpers, aliases, re-exports and imported factories. */
export function createLeafAnalyzer({ program, root, componentRoots = new Map(), tokenRoots = new Set(), componentLeaves, leafFactory }) {
  const checker = program.getTypeChecker();
  const relative = file => path.relative(root, file).split(path.sep).join("/");
  const symbolOf = node => {
    let symbol = checker.getSymbolAtLocation(node);
    const seen = new Set();
    while (symbol?.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) { seen.add(symbol); symbol = checker.getAliasedSymbol(symbol); }
    return symbol;
  };
  const declarations = node => symbolOf(node)?.declarations ?? [];
  function analyze(roots) {
    const findings = [], files = new Set(), visited = new Set();
    const add = (rule, node, detail, leaf) => {
      const source = node.getSourceFile(), position = source.getLineAndCharacterOfPosition(node.getStart(source));
      findings.push({ file: relative(source.fileName), line: position.line + 1, column: position.character + 1, rule, detail, ...(leaf ? { componentLeaf: leaf } : {}) });
    };
    const isLeafFactory = node => declarations(node).some(declaration => leafFactory && declaration.getSourceFile().fileName === leafFactory && declaration.name?.getText() === "componentLeaf");
    function literalValues(node, seen = new Set()) {
      if (!node || seen.has(node)) return [];
      seen.add(node);
      if (ts.isStringLiteralLike(node)) return [node.text];
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literalValues(node.expression, seen);
      if (ts.isConditionalExpression(node)) return [...literalValues(node.whenTrue, seen), ...literalValues(node.whenFalse, seen)];
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return [...literalValues(node.left, seen), ...literalValues(node.right, seen)];
      const values = declarations(node).flatMap(declaration => declaration.initializer ? literalValues(declaration.initializer, seen) : []);
      if (values.length) return values;
      const type = checker.getTypeAtLocation(node);
      return (type.isUnion() ? type.types : [type]).filter(value => value.isStringLiteral()).map(value => value.value);
    }
    function selectedLeaf(node, seen = new Set()) {
      if (!node || seen.has(node)) return;
      seen.add(node);
      if (ts.isCallExpression(node) && isLeafFactory(node.expression)) return node.arguments[0] && getText(node.arguments[0]);
      if (ts.isPropertyAccessExpression(node)) return selectedLeaf(node.expression, seen);
      for (const declaration of declarations(node)) if (declaration.initializer) {
        const leaf = selectedLeaf(declaration.initializer, seen);
        if (leaf) return leaf;
      }
    }
    function reactFactory(node, seen = new Set()) {
      if (!node || seen.has(node)) return false;
      seen.add(node);
      const name = ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
      const local = ts.isPropertyAccessExpression(node) ? node.expression : node;
      for (const declaration of checker.getSymbolAtLocation(local)?.declarations ?? []) {
        let imported = declaration;
        while (imported.parent && !ts.isImportDeclaration(imported) && !ts.isSourceFile(imported)) imported = imported.parent;
        if (ts.isImportDeclaration(imported) && ["react", "react/jsx-runtime", "react/jsx-dev-runtime"].includes(imported.moduleSpecifier.text) && !imported.importClause?.isTypeOnly) {
          const factory = ts.isImportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).text : name;
          if (["createElement", "jsx", "jsxs", "jsxDEV"].includes(factory)) return true;
        }
        if (declaration.initializer && reactFactory(declaration.initializer, seen)) return true;
      }
      return false;
    }
    function objectProperties(node, seen = new Set()) {
      if (!node || seen.has(node)) return [];
      seen.add(node);
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return objectProperties(node.expression, seen);
      if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(property => ts.isSpreadAssignment(property) ? objectProperties(property.expression, seen) : [property]);
      return declarations(node).flatMap(declaration => declaration.initializer ? objectProperties(declaration.initializer, seen) : []);
    }
    function designLiteral(node) {
      const value = node.text;
      if (/(?:#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch|lch|lab)a?\s*\()/i.test(value)) add("color-literal", node, value);
      if (/(?:\d*\.)?\d+(?:px|rem|em|vh|vw|dvh|svh|ch)\b/.test(value)) add("size-literal", node, value);
      if (/\b(?:bg|text|border|fill|stroke|ring|outline|shadow)-(?:black|white|red|blue|green|slate|gray|zinc|neutral|stone)-(?:\d{2,3})\b/.test(value)) add("color-literal", node, value);
      if (/(?:^|[\s:])(?:bg|text|border|fill|stroke|ring|outline)-(?:black|white)(?:\/\d+)?(?=$|\s)/.test(value)) add("color-literal", node, value);
      if ([...value.matchAll(/(?:^|[\s:])(?:w|h|size|min-w|max-w|min-h|max-h|p[xysetblr]?|m[xysetblr]?|gap(?:-[xy])?|space-[xy]|rounded(?:-[setblr])?|border(?:-[setblr])?|text|leading|tracking)-(\d+(?:\.\d+)?)(?![\d./])(?=$|\s)/g)].some(match => Number(match[1]) !== 0)) add("size-literal", node, value);
    }
    function styleExpression(node, seen = new Set(), cssObject = true) {
      if (!node || seen.has(node) || isType(node)) return;
      seen.add(node);
      if (ts.isStringLiteralLike(node)) designLiteral(node);
      if (cssObject && ts.isPropertyAssignment(node) && /^(?:width|height|minWidth|maxWidth|minHeight|maxHeight|fontSize|padding|margin|gap|borderRadius|borderWidth|size)$/.test(node.name.getText().replace(/["']/g, "")) && ts.isNumericLiteral(node.initializer) && Number(node.initializer.text) !== 0) add("size-literal", node.initializer, node.getText());
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
        for (const declaration of declarations(ts.isPropertyAccessExpression(node) ? node.name : node)) {
          if (!tokenRoots.has(declarationKey(declaration)) && !componentRoots.has(declarationKey(declaration)) && declaration.getSourceFile().fileName.startsWith(root + path.sep) && declaration.initializer) styleExpression(declaration.initializer, seen, cssObject);
        }
        // A property read consumes that value, not every sibling in its owner.
        // Walking the receiver again would turn metadata next to a CSS value
        // into rendered style and would enter generic component API types.
        return;
      }
      ts.forEachChild(node, child => styleExpression(child, seen, ts.isPropertyAssignment(node) ? node.name.getText() === "style" : cssObject));
    }
    function visitDeclaration(declaration, reference) {
      const file = declaration.getSourceFile().fileName;
      if (!file.startsWith(root + path.sep) || file.includes("/node_modules/")) return;
      const key = declarationKey(declaration), boundary = componentRoots.get(key);
      if (boundary) { add("direct-component-binding", reference ?? declaration, "Component implementation bypasses consumer selection", boundary); return; }
      if (tokenRoots.has(key)) return;
      if (!/\.[cm]?tsx?$/.test(file)) return;

      if (visited.has(key)) return;
      visited.add(key); files.add(relative(file)); walk(declaration);
    }
    function intrinsic(name, node, attributes) {
      if (interactiveTags.has(name)) add("raw-interactive-element", node, name);
      else if (textTags.has(name)) add("raw-text-element", node, name);
      for (const attribute of attributes ?? []) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          for (const property of objectProperties(attribute.expression)) {
            const key = property.name?.getText().replace(/["']/g, "");
            if (/^on[A-Z]/.test(key ?? "") || key === "tabIndex" || key === "role" && ts.isPropertyAssignment(property) && literalValues(property.initializer).some(value => interactiveRoles.has(value))) add("raw-interactive-element", property, `${name}.${key}`);
          }
        }
        if (!ts.isJsxAttribute(attribute)) continue;
        const key = attribute.name.getText(), values = attribute.initializer && literalValues(ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer);
        if (/^on[A-Z]/.test(key) || key === "tabIndex" || key === "role" && values?.some(value => interactiveRoles.has(value))) add("raw-interactive-element", attribute, `${name}.${key}`);
      }
    }
    function styleContext(node) {
      for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
        if (ts.isJsxAttribute(current)) return /^(?:className|style|width|height|size|color)$/.test(current.name.getText());
        if (ts.isPropertyAssignment(current) && /^(?:style|className)$/.test(current.name.getText().replace(/["']/g,""))) return true;
        if (ts.isCallExpression(current) && /^(?:cx|clsx|cva)$/.test(current.expression.getText())) return true;
      }
      return false;
    }
    function rawTextContext(node) {
      for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
        if (ts.isJsxAttribute(parent)) return false;
        if (ts.isJsxFragment(parent) || ts.isJsxExpression(parent)) continue;
        if (ts.isJsxElement(parent)) {
          const tag = parent.openingElement.tagName.getText();
          return /^[a-z]/.test(tag) && !textTags.has(tag) && !["style", "script", "title"].includes(tag);
        }
        if (ts.isFunctionLike(parent) || ts.isReturnStatement(parent)) return true;
      }
      return false;
    }
    function walk(node) {
      if (isType(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText();
        if (/^[a-z]/.test(name)) intrinsic(name, node, node.attributes.properties);
        else for (const tag of new Set(literalValues(node.tagName))) intrinsic(tag, node, node.attributes.properties);
        if (selectedLeaf(node.tagName) === "components.semantic-content") intrinsic("semantic-content", node, node.attributes.properties);
        for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute) && /^(?:className|style|width|height|size|color)$/.test(attribute.name.getText()) && attribute.initializer) styleExpression(attribute.initializer);
      }
      if (ts.isCallExpression(node)) {
        if (isLeafFactory(node.expression)) {
          const leaf = node.arguments[0] && getText(node.arguments[0]);
          if (!leaf || !/^components\.[a-z][a-z0-9-]*$/.test(leaf) || componentLeaves && !componentLeaves.has(leaf)) add("unproven-component-leaf", node, "Consumer leaf must be a literal registered component id");
          return;
        }
        if (reactFactory(node.expression) && node.arguments[0]) {
          const tags = literalValues(node.arguments[0]);
          for (const tag of new Set(tags)) {
            intrinsic(tag, node);
            const props = node.arguments[1];
            for (const property of objectProperties(props)) if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
              const key = property.name.getText().replace(/["']/g, "");
              if (/^on[A-Z]/.test(key) || key === "tabIndex" || key === "role" && ts.isPropertyAssignment(property) && literalValues(property.initializer).some(value => interactiveRoles.has(value))) add("raw-interactive-element", property, `${tag}.${key}`);
              if (/^(?:style|className|width|height|size|color)$/.test(key) && ts.isPropertyAssignment(property)) styleExpression(property.initializer);
              if (key === "children" && !textTags.has(tag) && ts.isPropertyAssignment(property) && literalValues(property.initializer).some(value => value.trim())) add("raw-text-content", property, `${tag} factory children`);
            }
            if (!textTags.has(tag) && node.arguments.slice(2).some(argument => literalValues(argument).some(value => value.trim()))) add("raw-text-content", node, `${tag} factory children`);
          }
        }
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const specifier = node.arguments[0] && getText(node.arguments[0]);
          if (!specifier) add("unresolved-render-source", node, "Dynamic module name prevents a complete render closure");
          else if (!specifier.startsWith(".")) add("vendor-import", node, specifier);
          else {
            const file = ts.resolveModuleName(specifier, node.getSourceFile().fileName, program.getCompilerOptions(), ts.sys).resolvedModule?.resolvedFileName;
            const source = file && program.getSourceFile(file);
            if (!source) add("unresolved-render-source", node, specifier);
            else for (const statement of source.statements) {
              if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) visitDeclaration(declaration,node);
              if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) visitDeclaration(statement,node);
            }
          }
        }
      }
      if (ts.isJsxText(node) && node.text.trim()) {
        if (rawTextContext(node)) add("raw-text-content", node, node.text.trim().slice(0, 100));
      }
      if (ts.isJsxExpression(node) && node.expression && rawTextContext(node)) {
        const type = checker.getTypeAtLocation(node.expression);
        const primitive = value => Boolean(value.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike));
        const literals = literalValues(node.expression);
        if ((!literals.length || literals.some(value => value.trim())) && (primitive(type) || type.isUnion() && type.types.every(primitive))) add("raw-text-content", node, node.expression.getText().slice(0,100));
      }
      if (ts.isStringLiteralLike(node) && !ts.isLiteralTypeNode(node.parent) && styleContext(node)) {
        designLiteral(node);
      }
      if (ts.isPropertyAccessExpression(node)) {
        // The facade's generic API type can point to a package implementation's
        // property declaration. Runtime dispatch still belongs to the consumer.
        if (selectedLeaf(node.expression)) return;
        const properties = declarations(node.name).filter(declaration => ts.isPropertyAssignment(declaration));
        if (properties.length) { for (const declaration of properties) visitDeclaration(declaration, node); return; }
      }
      if (ts.isIdentifier(node)) {
        const raw = checker.getSymbolAtLocation(node);
        for (const declaration of raw?.declarations ?? []) {
          let imported = declaration;
          while (imported.parent && !ts.isImportDeclaration(imported) && !ts.isSourceFile(imported)) imported = imported.parent;
          if (ts.isImportDeclaration(imported) && !imported.importClause?.isTypeOnly) {
            const module = imported.moduleSpecifier.text;
            const signatures = checker.getTypeAtLocation(node).getCallSignatures();
            const dataFunction = signatures.length && signatures.every(signature => Boolean(signature.getReturnType().flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike)));
            if (!module.startsWith(".") && module !== "react" && module !== "react/jsx-runtime" && !module.startsWith("@clossys/") && !(module !== "react-aria-components" && dataFunction)) add("vendor-import", imported, module);
          }
        }
        for (const declaration of declarations(node)) {
          if (declaration === node || declaration.name === node && !ts.isShorthandPropertyAssignment(declaration)) continue;
          if (!isType(declaration) && !ts.isImportSpecifier(declaration) && !ts.isParameter(declaration) && !ts.isPropertySignature(declaration) && !ts.isPropertyDeclaration(declaration) && !ts.isBindingElement(declaration)) visitDeclaration(declaration, node);
        }
      }
      ts.forEachChild(node, walk);
    }
    for (const declaration of roots) visitDeclaration(declaration);
    return { files: [...files].sort(), findings: [...new Map(findings.map(row => [JSON.stringify(row), row])).values()].sort((a,b) => a.file.localeCompare(b.file) || a.line-b.line || a.column-b.column || a.rule.localeCompare(b.rule)) };
  }
  return { analyze, declarations, symbolOf };
}

/** Shared registry and symbol context for surface/module body consumers. */
export function createSurfaceLeafContext(repository, { sourceRoots = [], analysisRoot = repository } = {}) {
  const root = path.resolve(repository), packages = ["designer", "publisher"].map(name => {
    const directory = path.join(root,"packages",name), manifest = JSON.parse(fs.readFileSync(path.join(directory,"package.json"),"utf8"));
    return { directory, manifest };
  });
  const roots = packages.flatMap(({ directory }) => walkFiles(path.join(directory,"src")).filter(file => /\.[cm]?tsx?$/.test(file) && !/\.(?:test|spec|stories)\./.test(file)));
  const program = ts.createProgram([...roots, ...sourceRoots], { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule:true, skipLibCheck:true });
  const checker = program.getTypeChecker();
  const unalias = symbol => symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  function pointer(pin) {
    if (!pin?.package || !pin.export) return [];
    const owner = packages.find(row=>row.manifest.name===pin.package), [subpath, name] = pin.export.split("#");
    if (!owner || !name) return [];
    const target = owner.manifest.exports?.[subpath];
    const output = typeof target === "string" ? target : target?.import ?? target?.default;
    if (typeof output !== "string") return [];
    let file = sourcePath(path.resolve(owner.directory, output));
    if (!fs.existsSync(file)) file = file.replace(/\.ts$/,".tsx");
    const source = program.getSourceFile(file), symbol = source && checker.getSymbolAtLocation(source);
    return unalias(symbol && checker.getExportsOfModule(symbol).find(row=>row.name===name))?.declarations ?? [];
  }
  const docs = walkFiles(path.join(root,"packages/designer/src/catalog/fills")).filter(file=>file.endsWith(".json")).map(file=>({ file:path.relative(root,file), doc:JSON.parse(fs.readFileSync(file,"utf8")) })).filter(row=>row.doc.$extensions?.["com.clossys.fill"]);
  const components = new Map();
  for (const { doc } of docs) {
    const meta = doc.$extensions["com.clossys.fill"];
    if (meta.slot?.startsWith("components.")) for (const node of pointer(meta.pin)) components.set(declarationKey(node),meta.slot);
  }
  const leafFactory = path.join(root,"packages/designer/src/runtime/component-leaf.tsx");
  const tokenRoots = new Set(pointer({package:packages[0].manifest.name,export:"./tokens#TOKENS"}).map(declarationKey));
  const componentLeaves = new Set(JSON.parse(fs.readFileSync(path.join(root,"packages/designer/src/catalog/slots/components.json"),"utf8")).map(row=>row.id));
  const analyzer = createLeafAnalyzer({ program, root:path.resolve(analysisRoot), componentRoots:components, tokenRoots, componentLeaves, leafFactory });
  const runtimeRoots = new Map();
  function renderDeclarations(expression, seen = new Set()) {
    if (seen.has(expression)) return []; seen.add(expression);
    if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) return renderDeclarations(expression.expression, seen);
    if (ts.isCallExpression(expression) && expression.expression.getText() === "Object.freeze" && expression.arguments[0]) return renderDeclarations(expression.arguments[0], seen);
    if (ts.isObjectLiteralExpression(expression)) {
      const render = expression.properties.find(property => property.name?.getText() === "render");
      if (render && ts.isPropertyAssignment(render)) return analyzer.symbolOf(render.initializer)?.declarations ?? [render.initializer];
      if (render && ts.isShorthandPropertyAssignment(render)) return checker.getShorthandAssignmentValueSymbol(render)?.declarations ?? [];
      if (render && ts.isMethodDeclaration(render)) return [render];
      return [];
    }
    const declarations = analyzer.symbolOf(expression)?.declarations ?? [];
    const variables = declarations.filter(ts.isVariableDeclaration);
    if (variables.length) return variables.flatMap(declaration => declaration.initializer ? renderDeclarations(declaration.initializer, seen) : []);
    return checker.getTypeAtLocation(expression).getCallSignatures().length ? declarations.length ? declarations : [expression] : [];
  }

  for (const source of program.getSourceFiles().filter(source=>source.fileName.includes("/designer/src/runtime/"))) {
    const visit = node => {
      if (ts.isPropertyAssignment(node)) {
        const leaf = getText(node.name);
        if (leaf && /^(?:sections|frames)\./.test(leaf)) {
          const declarations = renderDeclarations(node.initializer);
          runtimeRoots.set(leaf,[...(runtimeRoots.get(leaf)??[]),...declarations]);
        }
      }
      // Group-b uses {leaf, render} records rather than a keyed object.
      if (ts.isObjectLiteralExpression(node)) {
        const leaf = node.properties.find(item=>ts.isPropertyAssignment(item) && item.name.getText()==="leaf");
        const render = node.properties.find(item=>ts.isPropertyAssignment(item) && item.name.getText()==="render");
        const id = leaf && getText(leaf.initializer);
        if (id && render && /^(?:sections|frames)\./.test(id)) runtimeRoots.set(id,[...(runtimeRoots.get(id)??[]),...renderDeclarations(render.initializer)]);
      }
      ts.forEachChild(node,visit);
    }; visit(source);
  }
  const fills = docs.filter(({doc})=>/^(?:sections|frames)\./.test(doc.$extensions["com.clossys.fill"].slot)).map(({file,doc})=>{
    const meta = doc.$extensions["com.clossys.fill"], packageRoots = pointer(meta.pin), runtime = runtimeRoots.get(meta.slot)??[];
    return { id:meta.id, leaf:meta.slot, descriptor:file, packageRoots, runtimeRoots:runtime };
  });
  return { program, analyzer, fills };
}

export function checkSurfaceLeaves(repository) {
  const { analyzer, fills: registered } = createSurfaceLeafContext(repository);
  const fills = registered.map(({id,leaf,descriptor,packageRoots,runtimeRoots:runtime})=>{
    const result = analyzer.analyze([...packageRoots,...runtime]);
    if (!packageRoots.length) result.findings.push({file:descriptor,line:1,column:1,rule:"unresolved-fill-source",detail:"Registered fill has no resolved source export"});
    return { id,leaf,descriptor,packageRoots:packageRoots.length,runtimeRoots:runtime.length,...result };
  });
  return { schemaVersion:1,coverage:{fills:fills.length,sections:fills.filter(row=>row.leaf.startsWith("sections.")).length,frames:fills.filter(row=>row.leaf.startsWith("frames.")).length,files:new Set(fills.flatMap(row=>row.files)).size},fills,findings:fills.flatMap(row=>row.findings.map(finding=>({fill:row.id,leaf:row.leaf,...finding}))),limits:["Runtime selection must supply normalized component APIs; this check does not qualify third-party component behavior."] };
}
