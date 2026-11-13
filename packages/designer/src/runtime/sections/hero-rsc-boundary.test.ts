// @vitest-environment node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// REQ-0009: under react-server the registered Hero heading is not a server h1.
// Every semantic element of the block is the consumer-selected
// components.semantic-content leaf, so the server tree names each as that
// client boundary: a React.lazy element whose componentProps carry the tag
// (`as`) and its children, which stay server elements. An RSC tree evaluator
// reads the heading from the boundary whose `as` is "h1".
it("names the Hero heading's client boundary under react-server", () => {
  const entry = resolve(import.meta.dirname, "../../../dist/blocks/server.js");
  const script = `
    import { createElement } from "react";
    import { Hero } from ${JSON.stringify(entry)};
    const LAZY = Symbol.for("react.lazy"); const FORWARD = Symbol.for("react.forward_ref");
    const boundaries = []; const tags = [];
    const textOf = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(textOf).join("")
      : node && typeof node === "object" ? textOf(node.props?.componentProps?.children ?? node.props?.children) : "";
    function evaluate(node) {
      if (Array.isArray(node)) return node.forEach(evaluate);
      if (!node || typeof node !== "object") return;
      // A client boundary's children are server elements passed through it: evaluate them too.
      if (node.type?.$$typeof === LAZY) {
        const { as, children } = node.props.componentProps;
        boundaries.push({ leaf: node.props.leaf, parts: node.props.parts, as, text: textOf(children) });
        return evaluate(children);
      }
      if (node.type?.$$typeof === FORWARD) return evaluate(node.type.render(node.props, null));
      if (typeof node.type === "function") return evaluate(node.type(node.props));
      if (typeof node.type === "string") tags.push(node.type);
      evaluate(node.props?.children);
    }
    evaluate(createElement(Hero, { heading: "RSC native home", size: "display" }));
    process.stdout.write(JSON.stringify({ createContext: typeof (await import("react")).createContext, boundaries, tags }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 }));
  expect(result.createContext).toBe("undefined");
  expect(result.tags).not.toContain("h1");
  const headings = result.boundaries.filter((boundary: { as?: string }) => boundary.as === "h1");
  expect(headings).toEqual([{ leaf: "components.semantic-content", parts: [], as: "h1", text: "RSC native home" }]);
});
