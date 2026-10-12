import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { expect, it } from "vitest";

it("executes the consumer content README example through built public exports", () => {
  const section = readFileSync(new URL("../../README.md", import.meta.url), "utf8").split("## Consumer-owned content\n")[1];
  const fences = [...(section ?? "").matchAll(/^```ts\n([\s\S]*?)^```/gm)];
  expect(fences).toHaveLength(1);
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const output = buildSync({
    stdin: { contents: `${fences[0]![1]!}\nimport { renderToStaticMarkup } from "react-dom/server";\nconsole.log(JSON.stringify({ findings, fillReport, resolved, html: renderToStaticMarkup(element) }));`, resolveDir: packageRoot, loader: "ts" },
    bundle: true, packages: "external", platform: "node", format: "esm", write: false,
  }).outputFiles[0]!.text;
  const temporary = mkdtempSync(join(packageRoot, ".readme-content-"));
  try {
    const path = join(temporary, "example.mjs");
    writeFileSync(path, output);
    const example = JSON.parse(execFileSync(process.execPath, [path], { cwd: packageRoot, encoding: "utf8" }));
    expect(example.findings).toEqual([]);
    expect(example.fillReport.ok).toBe(true);
    expect(example.resolved.resolutions.map((entry: any) => entry.ref.id)).toContain("example.alt");
    expect(example.html).toContain('alt="A landscape beside a walking path"');
    expect(example.html).toContain('loading="lazy"');
    expect(example.html).toContain("data-media-figure");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
