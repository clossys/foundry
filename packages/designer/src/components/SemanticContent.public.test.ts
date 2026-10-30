/** @vitest-environment node */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dist = resolve(import.meta.dirname, "../../dist");
function probe(script: string, server = false): string {
  return execFileSync(process.execPath, [...(server ? ["--conditions=react-server"] : []), "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 }).trim();
}
describe("SemanticContent public boundary", () => {
  for (const entry of ["components/index.js", "components/server.js", "index.js"]) it(`exports the real compiled component from ${entry}`, () => {
    expect(probe(`import { SemanticContent } from ${JSON.stringify(dist + "/" + entry)}; console.log(typeof SemanticContent.render);`)).toBe("function");
  });
  it("imports and executes the real compiled server component under the server condition", () => {
    expect(probe(`import { SemanticContent } from ${JSON.stringify(dist + "/components/server.js")};
      const result = SemanticContent.render({ as: "h2", id: "title", tabIndex: -1, children: "Title" }, null);
      console.log(JSON.stringify({type:result.type,props:result.props}));`, true)).toBe(JSON.stringify({ type: "h2", props: { id: "title", tabIndex: -1, children: "Title", ref: null } }));
  });
  it("server-renders one unpainted native heading without a wrapper", () => {
    expect(probe(`import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server";
      import { SemanticContent } from ${JSON.stringify(dist + "/components/server.js")};
      console.log(renderToStaticMarkup(createElement(SemanticContent, {as:"h2",id:"title",tabIndex:-1}, "Title")));`)).toBe('<h2 id="title" tabindex="-1">Title</h2>');
  });
});
