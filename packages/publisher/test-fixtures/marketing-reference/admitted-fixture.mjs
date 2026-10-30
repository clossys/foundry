/** Partial native fixture: only already available passages and renderers are selected. */
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { createCopyResolver, validateWriterRecord } from "@clossys/writer";
import { resolveSectionedViewDocument } from "@clossys/publisher/core";
import { SectionedView } from "@clossys/publisher/web";
import { Hero, LogoCloud, TestimonialSet, StatGroup, SectionFrame, Form, ContentSection, ArticleBody, PageHeader, RecordCards, FeatureGrid, Faq, NavGrid, TableOfContents, Gallery, LogoHero } from "@clossys/designer/blocks";
import { SemanticContent, Button, Textarea } from "@clossys/designer/components";

const writerRoot = new URL("../", import.meta.resolve("@clossys/writer"));
const read = async path => JSON.parse(await readFile(new URL(path, writerRoot), "utf8"));
const site = await read("src/catalog/records/site.en.json");
const common = await read("src/catalog/records/common-labels.r1.en.json");
const envelopes = [
  { path: "packages/writer/src/catalog/records/site.en.json", data: site },
  { path: "packages/writer/src/catalog/records/common-labels.r1.en.json", data: common },
];
const byId = new Map();
for (const envelope of envelopes) for (const record of envelope.data.records) {
  if (byId.has(record.id)) throw new Error(`Duplicate Writer record ${record.id}`);
  const layer = record.id.startsWith("st.") ? "strings" : record.id.startsWith("ps.") ? "passages" : record.id.startsWith("pt.") ? "patterns" : "narratives";
  if (validateWriterRecord(record, layer).length) throw new Error(`Invalid Writer record ${record.id}`);
  byId.set(record.id, { record, envelope });
}
function field(alias, name, index = 0) {
  const passage = byId.get(site.aliases[alias])?.record;
  const value = passage?.fields?.[name];
  const reference = Array.isArray(value) ? value[index] : value;
  if (!reference || reference.ref !== "string" || !byId.has(reference.id)) throw new Error(`Missing native passage field ${alias}.${name}`);
  return { id: reference.id };
}
function resolver(reference) {
  const row = byId.get(reference.id);
  if (!row || typeof row.record.text !== "string") throw new Error(`Missing Writer string ${reference.id}`);
  return createCopyResolver({
    id: row.envelope.path, locale: row.envelope.data.locale,
    revision: row.envelope.data.revision === undefined ? "sha256:" + createHash("sha256").update(JSON.stringify(row.envelope.data)).digest("hex") : String(row.envelope.data.revision),
    source: { kind: "generated", reference: row.envelope.path },
    entries: [row.record],
  }, { target: "preview", timeZone: "UTC" })(reference);
}
const hero = () => ({ id: "intro", kind: "hero", heading: field("ps.hero.home", "header.heading"), eyebrow: field("ps.hero.home", "header.eyebrow"), description: field("ps.hero.home", "header.description"), size: "compact" });
const documents = {
  "/": () => [hero()],
  "/features": () => [hero(), { id: "features", kind: "feature-grid", heading: field("ps.features.about", "header.heading"), description: field("ps.features.about", "header.description"), items: [{ id: "detail", heading: field("ps.features.about", "items[].heading"), description: field("ps.features.about", "items[].description") }] }],
};
export const routes = [{ path: "/", family: "hero" }, { path: "/features", family: "features" }, ...["tabs", "alternating", "scroll"].map(layout => ({ path: `/features-${layout}`, family: `features.${layout}` })), { path: "/faq", family: "faq.public-block" }, { path: "/summary", family: "content.summary" }, { path: "/roles", family: "link-index.roles" }, { path: "/article", family: "article.reading" }, { path: "/backdrop", family: "hero.backdrop" }, { path: "/gallery", family: "gallery" }, { path: "/logos", family: "logo-cloud" }, { path: "/testimonials", family: "testimonials" }, { path: "/stats", family: "stats" }, { path: "/band", family: "band" }, { path: "/contact", family: "form" }, { path: "/privacy", family: "legal-prose" }, { path: "/terms", family: "legal-prose" }, { path: "/editorial", family: "editorial" }, { path: "/case-study", family: "case-study" }];
routes.push({ path: "/mark", family: "logo-hero.logo-mark" });
export const gaps = ["Native tokens.css shows a CSS-generated unbound-brand debug badge; outside DOM Writer probe coverage", "FAQ uses the public block's real one-row support; the registered runtime adapter still requires four to six rows and is not qualified here", "04 timeline-specific dated passages unavailable; mark artwork is a fictional fixture-owned geometric SVG, not a brand binding; contact form is a disabled static preview", "05 newsletter/announcement/locale-specific Writer passages unavailable; no submission service or translated copy is claimed", "06 bento requires at least two items; the actual feature passage supplies one and is not duplicated", "09 author/date/outcome-specific copy is absent; editorial fixtures reuse existing generic Writer title/description/draft-status fields", "11 video and runtime-module assets unavailable; the checked static token-painted SVG backdrop is exercised", "12 footnote-specific Writer passages unavailable; article and TOC reuse actual generic title and legal-body passages"];
const styles = (await Promise.all(["tokens.css", "compiled.css"].map(name => readFile(new URL(import.meta.resolve("@clossys/designer/" + name)), "utf8")))).join("\n").replace(/<\/style/gi, "<\\/style");
export async function render(item) {
  const writerValues = [];
  const text = (alias, name, index) => {
    const resolution = resolver(field(alias, name, index));
    if (!resolution) throw new Error(`Unresolved native passage ${alias}.${name}`);
    writerValues.push(resolution.text); return resolution.text;
  };
  const ground = item.theme === "inverse" ? "inverse" : "base";
  let element;
  const proofAlias = { "/logos": "ps.proof.logo-cloud", "/testimonials": "ps.proof.testimonials", "/stats": "ps.proof.stats" }[item.route];
  const intro = () => createElement(Hero, { heading: text("ps.hero.home", "header.heading"), ground, size: "compact" });
  if (item.route === "/mark") {
    const mark = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 8H56V56H8Z" fill="currentColor"/><path d="M20 20H44V44H20Z" fill="white"/></svg>');
    element = createElement("main", null, intro(), createElement(LogoHero, { mark, name: text("ps.hero.logo", "name") }), createElement(LogoHero, { mark, member: "brand.mark-only" }));
  } else if (item.route.startsWith("/features-")) {
    const layout = item.route.slice("/features-".length);
    element = createElement("main", null, intro(), createElement(SectionFrame, { ground }, createElement(FeatureGrid, { layout, ground, heading: text("ps.features.about", "header.heading"), description: text("ps.features.about", "header.description"), items: [{ id: "actual-writer-item", heading: text("ps.features.about", "items[].heading"), description: text("ps.features.about", "items[].description") }] })));
  } else if (item.route === "/faq") {
    element = createElement("main", null, intro(), createElement(SectionFrame, { ground }, createElement(Faq, { ground, heading: text("ps.faq.about", "header.heading"), items: [{ id: "actual-writer-question", question: text("ps.faq.about", "items[].question"), answer: text("ps.faq.about", "items[].answer") }] })));
  } else if (item.route === "/summary") {
    element = createElement("main", null, intro(), createElement(SectionFrame, { ground }, createElement(ContentSection, { ground, heading: text("ps.features.about", "header.heading"), description: text("ps.features.about", "header.description"), aside: [{ id: "draft-status", label: text("ps.page-header.contact", "meta[].label"), value: text("ps.page-header.contact", "meta[].value") }] })));
  } else if (item.route === "/roles") {
    element = createElement("main", null, intro(), createElement(SectionFrame, { ground }, createElement(NavGrid, { config: "roles", heading: text("ps.features.about", "header.heading"), items: [{ id: "generic-reference", href: "/features", title: text("ps.features.about", "items[].heading"), description: text("ps.features.about", "items[].description"), details: [{ id: "draft-status", label: text("ps.page-header.contact", "meta[].label"), value: text("ps.page-header.contact", "meta[].value") }] }] })));
  } else if (item.route === "/article") {
    const heading = text("ps.features.about", "header.heading");
    const policy = text("ps.legal.privacy", "heading");
    element = createElement("main", null, intro(), createElement(SectionFrame, { ground, measure: "prose" }, createElement(ArticleBody.Progress), createElement(ArticleBody, { dropCap: true, toc: createElement(TableOfContents, { label: text("ps.page-header.contact", "breadcrumbs.label"), items: [{ id: "reference-body", label: heading, level: 2 }, { id: "reference-policy", label: policy, level: 2 }], trackCurrent: "css" }) }, createElement(SemanticContent, { as: "h2", id: "reference-body" }, heading), createElement(SemanticContent, { as: "p" }, text("ps.features.about", "header.description")), createElement(SemanticContent, { as: "h2", id: "reference-policy" }, policy), createElement(SemanticContent, { as: "p" }, text("ps.legal.privacy", "body")))));
  } else if (item.route === "/gallery") {
    const alias = "ps.proof.gallery";
    const label = text(alias, "images.items[].label");
    const enlarge = text(alias, "controls.enlarge");
    element = createElement("main", null, createElement(Hero, { heading: text(alias, "header.heading"), ground, size: "compact" }), createElement(SectionFrame, { ground }, createElement(Gallery, { label: text(alias, "images.label"), images: [{ id: "generic-image", label, caption: text(alias, "images.items[].caption"), media: createElement("svg", { viewBox: "0 0 160 90", role: "img", "aria-label": label }, createElement("path", { d: "M0 0H160V90H0Z", fill: "var(--color-surface-sunken)" }), createElement("path", { d: "M0 90L80 10L160 90Z", fill: "var(--color-accent)" })) }], labels: { close: text(alias, "controls.close"), enlarge: () => enlarge } })));
  } else if (item.route === "/backdrop") {
    const backdrop = { slot: "backdrop", purpose: "decorative", alt: "", width: 1600, height: 900, aspect: "16:9", fit: "cover", loading: "lazy", bytes: 160, backgroundToken: "--color-surface-base", source: { format: "svg", paths: [{ d: "M0 0H1600V900H0Z", fillToken: "--color-surface-base" }, { d: "M0 900L1600 0V900Z", fillToken: "--color-surface-sunken" }] } };
    element = createElement("main", null, createElement(Hero, { heading: text("ps.hero.home", "header.heading"), description: text("ps.hero.home", "header.description"), ground, size: "compact", backdrop }));
  } else if (item.route === "/editorial" || item.route === "/case-study") {
    const config = item.route === "/editorial" ? "article" : "case-study";
    const records = [{ id: "reference", title: text("ps.features.about", "items[].heading"), description: text("ps.features.about", "items[].description"), href: "/features", badge: { label: text("ps.page-header.contact", "meta[].value") } }];
    element = createElement("main", null, createElement(SectionFrame, { ground },
      createElement(PageHeader, { title: text("ps.features.about", "header.heading"), description: text("ps.features.about", "header.description"), config }),
      createElement(RecordCards, { records, config: config === "article" ? "post" : "case-study", locale: "en" }),
      ...(config === "article" ? [createElement(RecordCards, { key: "featured", records, config: "post-featured", locale: "en" })] : [])));
  } else if (item.route === "/contact") {
    const alias = "ps.form.contact";
    element = createElement("main", null,
      createElement(Hero, { heading: text(alias, "header.heading"), description: text(alias, "header.description"), ground, size: "compact" }),
      createElement(SectionFrame, { ground }, createElement(Form, { composition: "contact", onSubmit: () => Promise.reject(new Error("No fixture submission service")), errorSummaryMessage: text(alias, "error-summary.heading"),
        actions: createElement(Button, { type: "submit", isDisabled: true }, text(alias, "submit.label")) },
        createElement(Textarea, { label: text(alias, "fields[].label"), description: text(alias, "fields[].description"), placeholder: text(alias, "fields[].placeholder"), errorMessage: text(alias, "fields[].error"), name: "message", rows: 6 }))));
  } else if (item.route === "/privacy" || item.route === "/terms") {
    const alias = item.route === "/privacy" ? "ps.legal.privacy" : "ps.legal.terms";
    element = createElement("main", null,
      createElement(Hero, { heading: text(alias, "heading"), ground, size: "compact" }),
      createElement(ContentSection, { heading: text(alias, "revision.label"), description: text(alias, "revision.value"), ground },
        createElement(ArticleBody, null, createElement(SemanticContent, { as: "p" }, text(alias, "body")))));
  } else if (proofAlias) {
    const heading = createElement(Hero, { heading: text(proofAlias, "header.heading"), ground, size: "compact" });
    let proof;
    if (item.route === "/logos") proof = createElement(LogoCloud, {
      ground, motion: "marquee", motionLabels: { pause: text(proofAlias, "controls.pause"), resume: text(proofAlias, "controls.resume") },
      items: [0, 1, 2].map(index => { const name = text(proofAlias, "logos[].name", index); return { id: `logo-${index}`, name, logo: createElement(SemanticContent, { as: "span" }, name) }; }),
    });
    if (item.route === "/testimonials") {
      const items = [0, 1, 2].map(index => ({ id: `quote-${index}`, quote: text(proofAlias, "quotes[].quote", index), attributorName: text(proofAlias, "quotes[].attributorName", index) }));
      proof = createElement(SectionFrame, { ground }, createElement(TestimonialSet, { items, ground, layout: "wall" }), createElement(TestimonialSet, { items, ground, layout: "carousel", carouselLabels: { previous: text(proofAlias, "controls.previous"), next: text(proofAlias, "controls.next") } }));
    }
    if (item.route === "/stats") {
      const value = text(proofAlias, "stats[].value");
      proof = createElement(StatGroup, { motion: "count", items: [{ id: "stat", label: text(proofAlias, "stats[].label"), value, countTo: Number(value.replaceAll(",", "")) }] });
    }
    element = createElement("main", null, heading, proof);
  } else if (item.route === "/band") {
    element = createElement("main", null, createElement(SectionFrame, { ground: ground === "inverse" ? "inverse" : "wash", texture: "grain", reveal: true }, createElement(Hero, { heading: text("ps.hero.home", "header.heading"), description: text("ps.hero.home", "header.description"), ground, size: "compact" })));
  } else {
    if (!documents[item.route]) throw new Error(`Unavailable fixture route ${item.route}`);
  const sections = documents[item.route]().map(section => ({ ...section, ground: item.theme === "inverse" ? "inverse" : "base" }));
  const document = resolveSectionedViewDocument({ id: resolver(field("ps.hero.home", "header.heading")).text, sections }, resolver);
  writerValues.push(...document.resolutions.map(resolution => resolution.text));
  element = createElement(SectionedView, { document, prefersReducedMotion: item.reducedMotion });
  }
  const markup = renderToStaticMarkup(element);
  return {
    html: `<!doctype html><html lang="en" dir="${item.dir}" data-theme="${item.theme === "dark" ? "dark" : "light"}" style="color-scheme:${item.theme === "dark" ? "dark" : "light"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head><body class="m-0 bg-surface-base text-ink-primary">${markup}</body></html>`,
    writerValues,
  };
}
