import { Children, isValidElement, type ReactNode } from "react";
import { assertItemData, hasContent } from "../items/policies.js";
import type { TreeNodeData, TreeProps } from "./Tree.js";

const NODE_KEYS = new Set(["id", "heading", "description", "eyebrow", "meta", "figure", "status", "badge", "parent", "edgeLabel"]);
const CONTROL_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary", "details", "label", "iframe", "object", "embed"]);
const CONTROL_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "textbox", "combobox", "listbox", "option", "menuitem", "slider", "spinbutton", "tab", "tree", "treeitem"]);

/** Inspect supplied elements without executing opaque components, matching Item's boundary. */
function assertPassive(content: ReactNode, inSvg = false): void {
  Children.forEach(content, child => {
    if (!isValidElement(child)) return;
    const props = child.props as Record<string, unknown>;
    const tag = typeof child.type === "string" ? child.type.toLowerCase() : undefined;
    const svg = tag === "svg" || inSvg;
    const resource = svg && (tag === "use" || tag === "image");
    const editable = props.contentEditable === true || (typeof props.contentEditable === "string" && ["", "true", "plaintext-only"].includes(props.contentEditable.toLowerCase()));
    const media = (tag === "audio" || tag === "video") && Boolean(props.controls);
    if ((tag !== undefined && CONTROL_TAGS.has(tag)) || props.tabIndex !== undefined || editable || media ||
      props.focusable === true || props.focusable === "true" || props.dangerouslySetInnerHTML !== undefined ||
      (props.href !== undefined && !resource) || Object.keys(props).some(key => /^on[A-Z]/.test(key) && props[key] !== undefined) ||
      (typeof props.role === "string" && props.role.split(/\s+/).some(role => CONTROL_ROLES.has(role)))) {
      throw new TypeError("Tree: node and edge content must be passive, without focus or interactive targets.");
    }
    assertPassive(props.children as ReactNode, tag === "foreignobject" ? false : svg);
  });
}

/** Validate every graph component before deriving bounded, source-ordered layout. */
export function assertTree({ nodes, orientation = "right", ground = "base" }: TreeProps) {
  if (orientation !== "right" && orientation !== "down") throw new TypeError("Tree: unknown orientation.");
  if (ground !== "base" && ground !== "sunken" && ground !== "inverse") throw new TypeError("Tree: unknown ground.");
  if (!Array.isArray(nodes) || nodes.length < 3 || nodes.length > 12) throw new RangeError("Tree: supply 3-12 nodes.");
  const byId = new Map<string, TreeNodeData>();
  const children = new Map<string, TreeNodeData[]>();
  for (let index = 0; index < nodes.length; index++) {
    if (!Object.hasOwn(nodes, index)) throw new TypeError("Tree: nodes must be a dense array.");
    const node = nodes[index];
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new TypeError("Tree: every node must be an object.");
    if (Object.keys(node).some(key => !NODE_KEYS.has(key))) throw new TypeError("Tree: unsupported node field; use the documented Item slots.");
    assertItemData(node);
    if (byId.has(node.id)) throw new TypeError("Tree: node ids must be unique.");
    byId.set(node.id, node);
    children.set(node.id, []);
    for (const content of [node.heading, node.description, node.eyebrow, node.meta, node.figure?.value, node.figure?.delta, node.status?.label, node.badge?.label, node.edgeLabel]) assertPassive(content);
  }
  const roots: TreeNodeData[] = [];
  for (const node of nodes) {
    if (node.parent === undefined) roots.push(node);
    else {
      if (typeof node.parent !== "string" || !byId.has(node.parent)) throw new TypeError("Tree: every parent must exist.");
      children.get(node.parent)!.push(node);
    }
  }
  if (roots.length !== 1) throw new TypeError("Tree: exactly one root is required.");

  const state = new Map<string, "visiting" | "visited">();
  function visit(node: TreeNodeData): void {
    if (state.get(node.id) === "visiting") throw new TypeError("Tree: a cycle is not allowed.");
    if (state.get(node.id) === "visited") return;
    state.set(node.id, "visiting");
    if (node.parent !== undefined) visit(byId.get(node.parent)!);
    state.set(node.id, "visited");
  }
  nodes.forEach(visit);

  const root = roots[0]!;
  for (const node of nodes) {
    const siblings = children.get(node.id)!;
    const maximum = node.id === root.id ? 6 : 4;
    if (siblings.length !== 0 && (siblings.length < 2 || siblings.length > maximum)) throw new RangeError("Tree: parents need 2-4 children; the root allows up to six.");
    const labelled = siblings.filter(child => hasContent(child.edgeLabel)).length;
    if (labelled !== 0 && labelled !== siblings.length) throw new TypeError("Tree: edge labels must cover all siblings or none.");
  }
  const levels: number[] = [];
  let depth = 0;
  let leaves = 0;
  function measure(node: TreeNodeData, level: number): void {
    depth = Math.max(depth, level);
    levels[level] = (levels[level] ?? 0) + 1;
    const descendants = children.get(node.id)!;
    if (descendants.length === 0) leaves++;
    descendants.forEach(child => measure(child, level + 1));
  }
  measure(root, 0);
  if (depth > (orientation === "right" ? 3 : 2)) throw new RangeError("Tree: depth exceeds the orientation's limit.");
  if (orientation === "down" && levels.some(count => count > 6)) throw new RangeError("Tree: every down level allows at most six nodes.");
  if (orientation === "right" && leaves > 8) throw new RangeError("Tree: right orientation allows at most eight leaves.");
  return { root, children, depth };
}
