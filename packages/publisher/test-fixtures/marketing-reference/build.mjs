import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createCopyResolver } from "@clossys/writer";
import { resolveSurfaceDocument } from "@clossys/publisher/core";
import { renderWebDocument, StatusView } from "@clossys/publisher/web";
import { checkContentMap, projectRedirects, projectRobots, projectSitemap, buildSecurityTxt } from "@clossys/publisher/content-map";

const publication = JSON.parse(await readFile(new URL("publication.json", import.meta.url), "utf8"));
const findings = checkContentMap(publication);
if (findings.length) throw new Error(JSON.stringify(findings));
const origin = "https://example.com";
const copy = {
  "site.brand": "Example Co.",
  "site.description": "A generic marketing reference for a fictional company.",
  "site.cta": "Explore the example",
  "site.missing": "This page does not exist.",
  ...Object.fromEntries(publication.entries.map(entry => [`page.${entry.id}`, entry.title])),
};
const resolver = createCopyResolver({
  id: "example.marketing.copy", locale: "en", revision: "1",
  source: { kind: "consumer", reference: "marketing-reference" },
  entries: Object.entries(copy).map(([id, text]) => ({ id, text, context: "marketing reference", status: "approved" })),
});
const ref = id => ({ id });
const escape = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const document = (title, body, canonical, noindex = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(copy["site.description"])}"><link rel="canonical" href="${escape(canonical)}">${noindex ? '<meta name="robots" content="noindex">' : ""}<link rel="stylesheet" href="/site.css"></head><body>${body}</body></html>`;

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
const routes = [];
for (const entry of publication.entries) {
  const surface = {
    id: `example.${entry.id}`, channel: "web", template: "MarketingView",
    meta: { channel: "web", title: ref(`page.${entry.id}`), description: ref("site.description") },
    bindings: [
      { slot: "brand", copy: ref("site.brand") },
      { slot: "heroHeading", copy: ref(`page.${entry.id}`) },
      { slot: "heroDescription", copy: ref("site.description") },
      { slot: "ctaHeading", copy: ref("site.cta") },
      { slot: "features", items: [] },
    ],
  };
  const resolved = resolveSurfaceDocument(surface, resolver);
  const rendered = renderWebDocument(resolved.document, { groups: resolved.groups });
  const file = `${entry.id}.html`;
  await writeFile(`dist/${file}`, document(rendered.head.title, renderToStaticMarkup(rendered.element), new URL(entry.path, origin).href));
  routes.push({ path: entry.path, file, type: "text/html; charset=utf-8", status: 200 });
}
await writeFile("dist/not-found.html", document("404 | Example Co.", renderToStaticMarkup(createElement(StatusView, { status: "404", subtitle: copy["site.missing"] })), `${origin}/not-found`, true));
const robots = projectRobots(publication, { origin, crawl: "allow" });
const sitemap = projectSitemap(publication, { channel: "site", origin });
await writeFile("dist/robots.txt", [`User-agent: ${robots.rules.userAgent}`, ...robots.rules.allow.map(path => `Allow: ${path}`), ...robots.rules.disallow.map(path => `Disallow: ${path}`), `Sitemap: ${robots.sitemap}`, ""].join("\n"));
await writeFile("dist/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemap.map(entry => `<url><loc>${escape(entry.url)}</loc></url>`).join("")}</urlset>`);
await writeFile("dist/security.txt", buildSecurityTxt({ contact: "mailto:security@example.com", expires: "2027-10-01T00:00:00Z" }));
const require = createRequire(import.meta.url);
await writeFile("dist/site.css", (await Promise.all(["@clossys/designer/tokens.css", "@clossys/designer/compiled.css"].map(name => readFile(require.resolve(name), "utf8")))).join("\n"));
routes.push(...[
  ["/robots.txt", "robots.txt", "text/plain"], ["/sitemap.xml", "sitemap.xml", "application/xml"],
  ["/.well-known/security.txt", "security.txt", "text/plain"], ["/site.css", "site.css", "text/css"],
].map(([path, file, type]) => ({ path, file, type: `${type}; charset=utf-8`, status: 200 })));
await writeFile("dist/routes.json", JSON.stringify({ routes, redirects: projectRedirects(publication) }, null, 2));
console.log(`Built ${publication.entries.length} marketing pages and public protocols from installed packages.`);
