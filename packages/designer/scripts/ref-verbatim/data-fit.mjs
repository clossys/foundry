/** Finite owner-directed source replays. Records supply data, never replacement JSX. */
import { createHash } from "node:crypto";
import { loadTypeScript } from "./typescript.mjs";
import { ICON_LIBRARIES, normalizeReference } from "./normalize.mjs";
export const DATA_FIT_OPERATIONS = Object.freeze([
  "sidebar15-frame-split", "sidebar15-right-offcanvas", "sidebar07-single-option",
  "sidebar-mirrored-edge", "sidebar-resizable-panels",
]);
export const sourceHash = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();

/** Replay only against a verified shadcn source file from the approved version.
 * raw is the verified pre-normalization source; text includes only CLI rewrites.
 */
export function replayDataFit(text, file, record, context) {
  if (!DATA_FIT_OPERATIONS.includes(record.operation) || !record.reason?.trim()
    || record.sourceHash !== sourceHash(context.raw)
    || !["shadcn", "shadcn-aria"].includes(context.source.registry)
    || context.source.version !== "4.23.0") throw new Error("NEED: data-fit requires a finite operation, reason and exact verified source bytes/version");
  const ts = loadTypeScript();
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (source.parseDiagnostics.length) throw new Error("NEED: data-fit source must parse");
  const elements = [];
  const visit = node => { if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node); ts.forEachChild(node, visit); };
  visit(source);
  const tag = node => (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(source);
  const one = name => {
    const found = elements.filter(node => tag(node) === name);
    if (found.length !== 1) throw new Error(`NEED: expected one stock ${name} subtree`);
    return found[0];
  };
  const bytes = node => node.getText(source);
  const edits = [];
  const replace = (node, value) => edits.push([node.getStart(source), node.getEnd(), value]);
  const requireFile = (item, suffix) => {
    if (context.source.item !== item || !file.endsWith(suffix)) throw new Error(`NEED: ${record.operation} requires ${item}/${suffix}`);
  };
  const children = node => node && ts.isJsxElement(node)
    ? node.children.filter(child => !ts.isJsxText(child) || child.text.trim()) : [];
  const replaceChildren = (node, name) => edits.push([
    node.openingElement.getEnd(), node.closingElement.getStart(source), `{${name}}`,
  ]);
  // These opt-ins consume stock content, so verify the complete function before
  // discarding any child list. Only existing CLI icon rewrites may differ.
  const stockFunction = name => {
    const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    const fn = functions[0];
    const matches = fn && Object.keys(ICON_LIBRARIES).some(iconLibrary => {
      const normalized = normalizeReference(context.raw, file, { aliases: {}, rsc: true, iconLibrary });
      const raw = ts.createSourceFile(file, normalized, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const stock = raw.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
      return stock.length === 1 && bytes(fn) === stock[0].getText(raw);
    });
    if (functions.length !== 1 || !matches) throw new Error(`NEED: content slots require the stock ${name} function`);
    return fn;
  };
  const bind = record.bindings;
  if (record.operation === "sidebar15-right-offcanvas") {
    requireFile("sidebar-15", "/components/sidebar-right.tsx");
    const contentSlots = exactKeys(bind, ["side", "collapsible", "contentSlots"]) && bind.contentSlots === true;
    if (!(exactKeys(bind, ["side", "collapsible"]) || contentSlots) || bind.side !== "right" || bind.collapsible !== "offcanvas") throw new Error("NEED: right sidebar binds only right/offcanvas with optional true contentSlots");
    const sidebar = one("Sidebar");
    if (contentSlots) {
      const fn = stockFunction("SidebarRight");
      const parameter = fn.parameters[0];
      if (fn.parameters.length !== 1 || !ts.isObjectBindingPattern(parameter.name)
        || parameter.name.elements.length !== 1 || !parameter.name.elements[0].dotDotDotToken
        || parameter.name.elements[0].name.getText(source) !== "props"
        || parameter.type?.getText(source) !== "React.ComponentProps<typeof Sidebar>"
        || parameter.initializer || parameter.questionToken || fn.typeParameters?.length || fn.type || fn.asteriskToken)
        throw new Error("NEED: content slots require stock SidebarRight props binding");
      const regions = [one("SidebarHeader"), one("SidebarContent"), one("SidebarFooter")];
      const direct = children(sidebar);
      if (!ts.isJsxElement(sidebar) || direct.length !== regions.length
        || regions.some((node, index) => !ts.isJsxElement(node) || direct[index] !== node))
        throw new Error("NEED: content slots require direct stock header/content/footer regions");
      replace(parameter, "{ header, children, footer, ...props }: React.ComponentProps<typeof Sidebar> & { header: React.ReactNode; footer: React.ReactNode }");
      regions.forEach((node, index) => replaceChildren(node, ["header", "children", "footer"][index]));
    }
    const attrs = sidebar.openingElement.attributes.properties;
    const collapsible = attrs.find(a => ts.isJsxAttribute(a) && a.name.getText(source) === "collapsible");
    const classes = attrs.find(a => ts.isJsxAttribute(a) && a.name.getText(source) === "className");
    if (collapsible?.initializer?.text !== "none" || classes?.initializer?.text !== "sticky top-0 hidden h-svh border-l lg:flex") throw new Error("NEED: right sidebar defaults differ from the stock source");
    replace(collapsible, 'side="right" collapsible="offcanvas"');
    replace(classes, 'className="sticky top-0 h-svh border-l"');
  } else if (record.operation === "sidebar07-single-option") {
    if (context.source.item !== "sidebar-07" || !/\/components\/(team-switcher|nav-user)\.tsx$/.test(file)) throw new Error("NEED: static row requires sidebar-07 team-switcher/nav-user");
    const input = file.endsWith("team-switcher.tsx") ? "teams" : "user";
    if (!exactKeys(bind, ["input", "values"]) || bind.input !== input || !Array.isArray(bind.values) || bind.values.length !== 1
      || !bind.values[0] || typeof bind.values[0] !== "object" || Array.isArray(bind.values[0])) throw new Error("NEED: static row requires one recorded input value");
    const menu = one("DropdownMenu");
    const trigger = one("DropdownMenuTrigger");
    const button = one("SidebarMenuButton");
    if (!ts.isJsxElement(menu) || !ts.isJsxElement(trigger) || !ts.isJsxElement(button)
      || !trigger.children.includes(button)) throw new Error("NEED: stock menu trigger/button anatomy differs");
    // Only the terminal stock choice chevron disappears. Avatar, labels and styles stay.
    const chevrons = button.children.filter(node => ts.isJsxSelfClosingElement(node)
      && (tag(node) === "ChevronsUpDownIcon" || tag(node) === "IconPlaceholder" && node.attributes.properties.some(a => a.initializer?.text === "ChevronsUpDownIcon")));
    if (chevrons.length !== 1) throw new Error("NEED: one stock choice chevron required");
    const chevron = chevrons[0];
    const retained = text.slice(button.getStart(source), chevron.getStart(source)) + text.slice(chevron.getEnd(), button.getEnd());
    replace(context.source.registry === "shadcn-aria" ? trigger : menu, retained);
    const hook = source.statements.filter(ts.isFunctionDeclaration).flatMap(fn => [...(fn.body?.statements ?? [])])
      .find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.initializer?.getText(source) === "useSidebar()"));
    if (hook) replace(hook, "");
    if (input === "teams") {
      const state = source.statements.filter(ts.isFunctionDeclaration).flatMap(fn => [...(fn.body?.statements ?? [])])
        .find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.initializer?.getText(source) === "React.useState(teams[0])"));
      if (!state) throw new Error("NEED: stock single-team selection is missing");
      replace(state, "const activeTeam = teams[0]");
    }
  } else {
    requireFile("sidebar-15", "/page.tsx");
    const provider = one("SidebarProvider");
    if (!ts.isJsxElement(provider)) throw new Error("NEED: stock provider anatomy differs");
    if (record.operation === "sidebar15-frame-split") {
      const body = exactKeys(bind, ["region", "body"]) && bind.region === "page" && bind.body === "children";
      if (!(exactKeys(bind, ["region"]) || body) || !["app", "page"].includes(bind.region)) throw new Error("NEED: frame split selects app or page with optional page children body");
      const inset = one("SidebarInset"), left = one("SidebarLeft"), right = one("SidebarRight");
      if (bind.region === "app" || body) {
        const pages = source.statements.filter(node => ts.isFunctionDeclaration(node)
          && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword));
        const page = pages[0];
        let returned = page?.body?.statements[0];
        returned = returned && ts.isReturnStatement(returned) ? returned.expression : undefined;
        while (returned && ts.isParenthesizedExpression(returned)) returned = returned.expression;
        if (pages.length !== 1 || page.name?.text !== "Page" || page.modifiers.length !== 2
          || !page.modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
          || page.parameters.length || page.typeParameters?.length || page.type || page.asteriskToken
          || page.body?.statements.length !== 1 || returned !== provider)
          throw new Error("NEED: app frame requires stock zero-parameter default Page returning the provider");
        edits.push([page.parameters.pos, page.parameters.end, "{ children }: { children: React.ReactNode }"]);
      }
      if (bind.region === "app") {
        replace(inset, "{children}"); replace(right, "");
      }
      else {
        if (body) {
          stockFunction("Page");
          const direct = children(inset), wrapper = direct[1];
          const placeholders = children(wrapper);
          if (direct.length !== 2 || tag(direct[0]) !== "header" || !ts.isJsxElement(wrapper)
            || bytes(wrapper.openingElement) !== '<div className="flex flex-1 flex-col gap-4 p-4">'
            || placeholders.length !== 2 || placeholders.some((node, index) => !ts.isJsxSelfClosingElement(node)
              || bytes(node) !== `<div className="mx-auto ${index ? "h-[100vh]" : "h-24"} w-full max-w-3xl rounded-xl bg-muted/50" />`))
            throw new Error("NEED: page body requires the two direct stock placeholders");
          replaceChildren(wrapper, "children");
        }
        replace(provider.openingElement, "<>"); replace(provider.closingElement, "</>"); replace(left, "");
      }
    } else if (record.operation === "sidebar-mirrored-edge") {
      if (!exactKeys(bind, ["side"]) || !["left", "right"].includes(bind.side)) throw new Error("NEED: mirrored edge selects left or right");
      const trigger = bytes(one("SidebarTrigger"));
      const divider = one("Separator");
      const attr = divider.attributes?.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(source) === "className");
      if (!attr || !ts.isStringLiteral(attr.initializer) || attr.initializer.text.split(/\s+/).filter(token => token === "mr-2").length !== 1) throw new Error("NEED: stock mirrored separator needs its one directional mr-2 token");
      const remaining = attr.initializer.text.split(/\s+/).filter(token => token !== "mr-2").join(" ");
      const separator = bytes(divider).replace(attr.initializer.getText(source), JSON.stringify(remaining));
      replace(provider, bind.side === "left" ? `<>${trigger}${separator}</>` : `<>${separator}${trigger}</>`);
    } else if (record.operation === "sidebar-resizable-panels") {
      if (!exactKeys(bind, ["orientation"]) || bind.orientation !== "horizontal"
        || !context.sources.some(row => row.source.item === "resizable" && row.source.version === "4.23.0"
          && ["shadcn", "shadcn-aria"].includes(row.source.registry))) throw new Error("NEED: resize requires the verified same-engine stock resizable part and horizontal orientation");
      const nodes = [one("SidebarLeft"), one("SidebarInset"), one("SidebarRight")];
      const parts = nodes.map(node => `<ResizablePanel>${bytes(node)}</ResizablePanel>`);
      const group = `<ResizablePanelGroup orientation="horizontal">${parts.join("<ResizableHandle />")}</ResizablePanelGroup>`;
      // Provider remains identical; only its three existing children gain stock wrappers.
      replace(provider, `${bytes(provider.openingElement)}${group}${bytes(provider.closingElement)}`);
      edits.push([0, 0, 'import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@clossys/designer-ui";\n']);
    }
  }
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + value + text.slice(end);
  return text;
}
