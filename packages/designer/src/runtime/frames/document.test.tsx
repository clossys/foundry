// @vitest-environment jsdom
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { SITE_MAIN_ID } from "../../frames/site-frame/types.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { DocumentFrame, FRAME_CRITICAL_STYLE_ATTRIBUTE, documentRenderer, type DocumentFrameProps } from "./document.js";

const props: DocumentFrameProps = { lang: "en", dir: "ltr", variant: "page", title: "Projects", children: <main>Host body</main> };
const parse = (element: ReactElement): Document => new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html");
function input(options: { head?: Record<string, unknown>; members?: string[]; content?: Record<string, unknown>; body?: ReactNode; slots?: Record<string, ReactNode[]> } = {}): RuntimeRenderInput<ReactNode> {
  const values = options.content ?? { head: options.head ?? { lang: "en", dir: "ltr", title: "Projects" } };
  return {
    fill: { leaf: "frames.document" }, selection: { leaf: "frames.document", members: options.members ?? [] },
    content: Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, { value }])),
    slots: options.slots ?? { body: [options.body ?? <main key="body">Host body</main>] },
  } as unknown as RuntimeRenderInput<ReactNode>;
}
const runtimeDocument = (value: RuntimeRenderInput<ReactNode>) => parse(<>{documentRenderer.render(value)}</>);

describe("DocumentFrame", () => {
  it.each([["en", "ltr"], ["ar", "rtl"]] as const)("renders actual SSR with caller-resolved %s/%s", (lang, dir) => {
    const document = parse(<DocumentFrame {...props} lang={lang} dir={dir} />);
    expect(document.documentElement.lang).toBe(lang);
    expect(document.documentElement.dir).toBe(dir);
    expect(document.title).toBe("Projects");
    expect(document.body.querySelector("main")?.textContent).toBe("Host body");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("preserves explicit direction without inferring it from the language", () => {
    expect(parse(<DocumentFrame {...props} lang="ar" dir="ltr" />).documentElement.dir).toBe("ltr");
  });

  it("owns page head tags, preserves link order and escapes content", () => {
    const document = parse(<DocumentFrame {...props} title={'Projects <script>alert(1)</script>'} htmlClassName="font-body" icon={{ href: "/icon.svg", type: "image/svg+xml" }} meta={[{ name: "description", content: '<script src="x"></script>' }]} links={[{ rel: "canonical", href: "https://example.com/projects" }, { rel: "alternate", href: "/ar/projects", hrefLang: "ar" }]} criticalCss="body{margin:0}" stylesheets={["/site.css", "https://cdn.example.com/brand.css"]} />);
    expect(document.title).toBe('Projects <script>alert(1)</script>');
    expect(document.documentElement.className).toBe("font-body");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe('<script src="x"></script>');
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/icon.svg");
    expect(document.head.querySelector('link[rel="alternate"]')?.getAttribute("hreflang")).toBe("ar");
    expect([...document.head.querySelectorAll('link[rel="stylesheet"]')].map(link => link.getAttribute("href"))).toEqual(["/site.css", "https://cdn.example.com/brand.css"]);
    expect(document.head.querySelector("style")?.textContent).toBe("body{margin:0}");
    expect([...document.head.children].indexOf(document.head.querySelector("style")!)).toBeLessThan([...document.head.children].indexOf(document.head.querySelector('link[rel="stylesheet"]')!));
    expect(document.querySelector("script")).toBeNull();
  });

  it("pins the status theme and robots and includes exact structural CSS only for framed status", () => {
    const document = parse(<DocumentFrame {...props} variant="status" framed stylesheets={["/site.css"]} />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.hasAttribute("data-brand-bound")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    const style = document.head.querySelector(`style[${FRAME_CRITICAL_STYLE_ATTRIBUTE}]`)!;
    expect(style.textContent).toBe([
      "@layer publisher-frame-critical{",
      "[data-frame-root]{display:flex;flex-direction:column;min-height:100dvh}",
      `#${SITE_MAIN_ID}{display:flex;flex:1;flex-direction:column;width:100%}`,
      `a[href="#${SITE_MAIN_ID}"]:not(:focus){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border-width:0}`,
      '[data-frame-root] header span.bg-accent[aria-hidden="true"]{display:inline-block;flex-shrink:0;background-color:var(--color-accent,currentColor)}',
      "}",
    ].join(""));
    expect([...document.head.children].indexOf(style)).toBeLessThan([...document.head.children].indexOf(document.head.querySelector('link[rel="stylesheet"]')!));
    expect(parse(<DocumentFrame {...props} variant="status" />).head.querySelector("style")).toBeNull();
    expect(parse(<DocumentFrame {...props} framed />).head.querySelector(`style[${FRAME_CRITICAL_STYLE_ATTRIBUTE}]`)).toBeNull();
  });

  it.each(["", " ", undefined, null])("refuses missing or blank lang %s", lang => {
    expect(() => renderToStaticMarkup(<DocumentFrame {...props} lang={lang as string} />)).toThrow(/DocumentFrame: lang must be non-empty text/);
  });
  it.each(["auto", "RTL", "", undefined])("refuses invalid explicit dir %s", dir => {
    expect(() => renderToStaticMarkup(<DocumentFrame {...props} dir={dir as "ltr"} />)).toThrow(/DocumentFrame: dir must be ltr or rtl/);
  });
  it.each(["</style><script>alert(1)</script>", "body{content:'<' }", "<!--css-->"])("refuses critical CSS containing markup", criticalCss => {
    expect(() => renderToStaticMarkup(<DocumentFrame {...props} criticalCss={criticalCss} />)).toThrow(/criticalCss/);
  });
  it("accepts extra status CSS after fixed rules and refuses robots overrides", () => {
    const document = parse(<DocumentFrame {...props} variant="status" framed criticalCss="body{margin:0}" />);
    expect(document.head.querySelectorAll("style")).toHaveLength(2);
    expect(document.head.querySelector("style")?.hasAttribute(FRAME_CRITICAL_STYLE_ATTRIBUTE)).toBe(true);
    expect(document.head.querySelectorAll("style")[1]?.textContent).toBe("body{margin:0}");
    expect(() => renderToStaticMarkup(<DocumentFrame {...props} variant="status" criticalCss="</style><script>alert(1)</script>" />)).toThrow(/criticalCss/);
    expect(() => renderToStaticMarkup(<DocumentFrame {...props} variant="status" meta={[{ name: "ROBOTS", content: "index" }]} />)).toThrow(/robots/);
  });
  it.each(["//cdn.example.com/site.css", "http://cdn.example.com/site.css", "javascript:alert(1)", "site.css", "", " ", "/\t/cdn.example.com/site.css", "/\n/cdn.example.com/site.css", "/\r/cdn.example.com/site.css", "https://cdn.example.com/\tsite.css", "/site .css", "/site\u0000.css", "/site\u007f.css", "/\\site.css"])("preserves legacy stylesheet refusal for %s", href => {
    expect(() => renderToStaticMarkup(<DocumentFrame {...props} componentName="NotFoundDocument" stylesheets={["/ok.css", href]} />)).toThrow(new TypeError("NotFoundDocument: stylesheets[1] must be a root-relative path or an https URL."));
  });
  it("preserves the legacy non-array stylesheet error", () => {
    expect(() => renderToStaticMarkup(<DocumentFrame {...props} componentName="GlobalErrorDocument" stylesheets={"/site.css" as unknown as string[]} />)).toThrow(new TypeError("GlobalErrorDocument: stylesheets must be an array."));
  });
  it.each(["javascript:alert(1)", "data:text/html,x", "//example.com", "/\\example.com", "/\t/example.com", "relative"])("refuses unsafe canonical URLs %s", href => {
    expect(() => renderToStaticMarkup(<DocumentFrame {...props} links={[{ rel: "canonical", href }]} />)).toThrow(/links\[0\]/);
  });
  it("admits http head destinations while keeping stylesheet HTTPS restrictions", () => {
    expect(parse(<DocumentFrame {...props} links={[{ rel: "canonical", href: "http://example.com" }]} />).head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("http://example.com");
  });
});

describe("frames.document renderer", () => {
  it("reads explicit locale JSON and a host-owned body slot, with a bounded page default", () => {
    const document = runtimeDocument(input({ head: { lang: "ar", dir: "rtl", title: "Projects" } }));
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.body.querySelector("main")?.textContent).toBe("Host body");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(documentRenderer.sample(specimenDataset)).toEqual({ head: specimenDataset.frames.document });
  });
  it("selects the status variant explicitly and maps only owned head tags", () => {
    const document = runtimeDocument(input({ members: ["variant.status"], head: { lang: "en", dir: "ltr", title: "Projects", framed: true, icon: { href: "/icon.svg" }, links: [{ rel: "alternate", href: "/ar", hrefLang: "ar" }], stylesheets: ["/site.css"] } }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.head.querySelector(`style[${FRAME_CRITICAL_STYLE_ATTRIBUTE}]`)).not.toBeNull();
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    expect(document.head.querySelector('link[rel="alternate"]')?.getAttribute("href")).toBe("/ar");
    expect(document.querySelector("script")).toBeNull();
  });
  it("keeps fixed framed status CSS alongside a validated critical-css fill", () => {
    const document = runtimeDocument(input({ members: ["variant.status"], content: { head: { lang: "ar", dir: "rtl", title: "Projects", framed: true }, "critical-css": "body{margin:0}" } }));
    expect(document.head.querySelectorAll("style")).toHaveLength(2);
    expect(document.head.querySelector(`style[${FRAME_CRITICAL_STYLE_ATTRIBUTE}]`)).not.toBeNull();
    expect(document.head.querySelectorAll("style")[1]?.textContent).toBe("body{margin:0}");
    expect(() => documentRenderer.render(input({ content: { head: { lang: "en", dir: "ltr", title: "Projects" }, "critical-css": "</style><script>alert(1)</script>" } }))).toThrow(/criticalCss/);
  });
  it("requires a boolean framed flag and refuses unmapped head link attributes", () => {
    expect(() => documentRenderer.render(input({ head: { lang: "en", dir: "ltr", title: "Projects", framed: "true" } }))).toThrow(/framed/);
    expect(() => documentRenderer.render(input({ head: { lang: "en", dir: "ltr", title: "Projects", links: [{ rel: "script", href: "/script.js" }] } }))).toThrow(/rel/);
    expect(() => documentRenderer.render(input({ head: { lang: "en", dir: "ltr", title: "Projects", links: [{ rel: "alternate", href: "/ar", onLoad: "alert(1)" }] } }))).toThrow(/onLoad/);
  });
  it("maps a page critical-css string", () => {
    const document = runtimeDocument(input({ content: { head: { lang: "en", dir: "ltr", title: "Projects" }, "critical-css": "body{margin:0}" } }));
    expect(document.head.querySelector("style")?.textContent).toBe("body{margin:0}");
  });
  it.each([{ lang: "en", title: "Projects" }, { dir: "ltr", title: "Projects" }, { lang: " ", dir: "rtl", title: "Projects" }])("requires resolved locale fields", head => {
    expect(() => runtimeDocument(input({ head }))).toThrow(/lang|dir/);
  });
  it("refuses unknown head data, scripts, unsupported members and slots", () => {
    expect(() => documentRenderer.render(input({ head: { lang: "en", dir: "ltr", title: "Projects", script: "alert(1)" } }))).toThrow(/script/);
    expect(() => documentRenderer.render(input({ content: { head: { lang: "en", dir: "ltr", title: "Projects" }, scripts: [] } }))).toThrow(/scripts/);
    expect(() => documentRenderer.render(input({ members: ["variant.other"] }))).toThrow(/variant.other/);
    expect(() => documentRenderer.render(input({ members: ["variant.page", "variant.status"] }))).toThrow(/variant/);
    expect(() => documentRenderer.render(input({ slots: { main: ["Other body"] } }))).toThrow(/main/);
    expect(() => documentRenderer.render(input({ slots: {} }))).toThrow(/body/);
  });
});
