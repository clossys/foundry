import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { standardM1FixtureEngine, standardM1Runtime } from "./__fixtures__/standard-m1-runtime.js";
import { prepareRuntimeAssembly } from "./runtime-assembly.js";
const engine = standardM1FixtureEngine();
describe("Standard M1 real section assembly fixture", () => {
  it("renders actual public Hero and ArticleBody in a truthful consumer-owned frame", () => {
    const input = standardM1Runtime({ engine, identity: { kind: "git", head: "1".repeat(40), tree: "2".repeat(40) }, source: { entry: "synthetic.tsx", files: { "synthetic.tsx": "// SYNTHETIC descriptor; SSR assertions are not browser LK12" }, dependencies: {} }, css: [{ id: "fixture.css", contents: "body{margin:0}" }] });
    const result = prepareRuntimeAssembly(input); expect(result.status, JSON.stringify(result)).toBe("ready"); if (result.status !== "ready") return;
    const html = renderToStaticMarkup(result.assembly.render(result.assembly.snapshot.cells[0]!));
    const dom = new DOMParser().parseFromString(html, "text/html");
    expect(dom.querySelectorAll("main")).toHaveLength(1); expect(dom.querySelector("main")!.id).toBe("main-content");
    expect(dom.querySelector("a")!.getAttribute("href")).toBe("#main-content");
    expect(dom.querySelectorAll("h1")).toHaveLength(1);
    expect(dom.querySelector("h1")!.textContent).toBe("Made for a clear first impression");
    expect(dom.querySelector("article p")!.textContent).toBe("A real content region composed through the consumer library.");
    expect([...dom.querySelectorAll("[data-runtime-path]")].map(node => node.getAttribute("data-runtime-path"))).toEqual(["frame", "sections.body.0", "sections.body.1"]);
    expect(dom.querySelector('[data-runtime-path="sections.body.0"] h1')?.textContent).toContain("Made for a clear first impression");
    expect(input.ports.manifest.consumer).toBe("standard-m1-fixture");
  });
});
