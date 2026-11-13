/** Node host: source inventory never becomes a tracked asset or public endpoint. */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
const loader = await build({ entryPoints: [fileURLToPath(new URL("./external-inventory.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { loadExternalAppInventory } = await import(`data:text/javascript;base64,${Buffer.from(loader.outputFiles[0].text).toString("base64")}`);
const { inventory, sha256 } = await loadExternalAppInventory();
const result = await build({ entryPoints: [fileURLToPath(new URL("./preview.tsx", import.meta.url))], bundle: true, write: false, outdir: "preview", format: "esm", platform: "browser", define: { __PUBLISHER_APP_INVENTORY__: JSON.stringify(inventory) } });
const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
const { generatePreviewCss } = await import("../../../../../scripts/preview-css.mjs");
const css = readFileSync(createRequire(import.meta.url).resolve("@clossys/designer/tokens.css"), "utf8") + await generatePreviewCss();
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Publisher App preview</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = createServer((req, res) => {
  const path = req.url?.split("?")[0];
  res.setHeader("Content-Type", path === "/fixture.js" ? "text/javascript" : path === "/fixture.css" ? "text/css" : "text/html");
  res.end(path === "/fixture.js" ? js : path === "/fixture.css" ? css : html);
});
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
server.listen(Number(process.env.PORT ?? 4320), "127.0.0.1", () => console.log(`Publisher App preview: http://127.0.0.1:${server.address().port} | source ${inventory.source.head} | sha256 ${sha256}`));
