import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createElement, Suspense, use } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { describe, expect, it } from "vitest";
import { NEXT_BOUNDARY_RUNTIME, NEXT_SHELL_TIME_SCRIPT, nextStreamingScriptShape } from "./next-streaming.js";
import type { NextStreamingScript } from "./next-streaming.js";

// The shape of a root `loading.tsx` boundary whose route suspends past the shell: a document, a
// Suspense boundary per suspended part and the bootstrap script Next always sends (its id is `_R_`).
async function stream(parts: number, options: { nonce?: string } = {}): Promise<string> {
  const pending = Array.from({ length: parts }, () => { let done!: () => void; const promise = new Promise<void>(resolve => { done = resolve; }); return { promise, done }; });
  const Part = ({ index }: { index: number }) => { use(pending[index]!.promise); return createElement("main", null, `part ${index}`); };
  const tree = createElement("html", null, createElement("body", null,
    ...pending.map((_, index) => createElement(Suspense, { key: index, fallback: createElement("p", null, "loading") }, createElement(Part, { index })))));
  const body = await renderToReadableStream(tree, { bootstrapScriptContent: "self.__bootstrap=1", ...options });
  pending.forEach((part, index) => setTimeout(part.done, 5 * (index + 1)));
  return new Response(body).text();
}

function inlineScripts(html: string): NextStreamingScript[] {
  return [...html.matchAll(/<script((?:\s+[a-z-]+(?:="[^"]*")?)*)>([\s\S]*?)<\/script>/g)]
    .map(([, attributes = "", text = ""]) => ({ attributes: [...attributes.matchAll(/\s+([a-z-]+)/g)].map(match => match[1]!), text }))
    .filter(script => !script.attributes.includes("src") && !script.attributes.includes("id"));
}

describe("Next shell streaming scripts", () => {
  it("registers exactly the two scripts a suspended root boundary streams", async () => {
    const scripts = inlineScripts(await stream(1));
    expect(scripts.map(nextStreamingScriptShape)).toEqual(["shell-time", "boundary-completion"]);
    expect(scripts[0]).toEqual({ attributes: [], text: NEXT_SHELL_TIME_SCRIPT });
    expect(scripts[1]!.text).toBe(`${NEXT_BOUNDARY_RUNTIME}$RC("B:0","S:0")`);
  });

  it("registers a later completion without the runtime and a CSP nonce", async () => {
    const scripts = inlineScripts(await stream(2));
    expect(scripts.map(nextStreamingScriptShape)).toEqual(["shell-time", "boundary-completion", "boundary-completion"]);
    expect(scripts[2]!.text).toMatch(/^\$RC\("B:1","S:1"\)$/);
    const nonced = inlineScripts(await stream(1, { nonce: "n0nce" }));
    expect(nonced.map(script => script.attributes)).toEqual([["nonce"], ["nonce"]]);
    expect(nonced.map(nextStreamingScriptShape)).toEqual(["shell-time", "boundary-completion"]);
  });

  it("pins the registered texts to the renderer the Next shell ships", () => {
    const next = dirname(createRequire(import.meta.url).resolve("next/package.json"));
    const vendored = ["react-dom-server.edge.production.js", "react-dom-server.node.production.js"]
      .map(file => readFileSync(join(next, "dist/compiled/react-dom/cjs", file), "utf8"));
    for (const source of vendored) {
      expect(source).toContain(`"${NEXT_SHELL_TIME_SCRIPT}"`);
      expect(source).toContain(`'${NEXT_BOUNDARY_RUNTIME.replace("\n", "\\n")}'`);
      expect(source).toContain(`completeBoundaryScript1Partial = stringToPrecomputedChunk('$RC("')`);
    }
  });

  it.each([
    ["an extra statement after the call", { attributes: [], text: '$RC("B:0","S:0");alert(1)' }],
    ["an id attribute", { attributes: ["id"], text: '$RC("B:0","S:0")' }],
    ["any other attribute", { attributes: ["nonce", "data-x"], text: NEXT_SHELL_TIME_SCRIPT }],
    ["an altered shell-time mark", { attributes: [], text: "requestAnimationFrame(function(){$RT=1});" }],
    ["a runtime fragment", { attributes: [], text: "window.$RB=[];" }],
    ["the runtime without a call", { attributes: [], text: NEXT_BOUNDARY_RUNTIME }],
    ["the runtime twice", { attributes: [], text: `${NEXT_BOUNDARY_RUNTIME}${NEXT_BOUNDARY_RUNTIME}$RC("B:0","S:0")` }],
    ["an altered runtime", { attributes: [], text: `${NEXT_BOUNDARY_RUNTIME.replace("2300", "9")}$RC("B:0","S:0")` }],
    ["a non-hex id", { attributes: [], text: '$RC("B:x","S:0")' }],
    ["two calls in one script", { attributes: [], text: '$RC("B:0","S:0")$RC("B:1","S:1")' }],
    ["a segment instruction", { attributes: [], text: '$RS("S:1","P:1")' }],
    ["a client-render error instruction", { attributes: [], text: '$RX("B:0")' }],
    ["a style-wait instruction", { attributes: [], text: '$RR("B:0","S:0",[])' }],
  ])("refuses %s", (_, script) => {
    expect(nextStreamingScriptShape(script)).toBeUndefined();
  });
});
