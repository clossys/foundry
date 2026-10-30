import { expect, it } from "vitest";
import { parseSiteSyncConfig } from "./config.js";

const host = {
  locale: "en", frame: { file: "hosts.tsx", export: "Frame" }, consent: { file: "hosts.tsx", export: "Consent" },
  notFound: { file: "hosts.tsx", export: "NotFound" }, security: { contact: "https://example.test/contact", expires: "2027-10-29T00:00:00Z" },
};
const target = { app: "apps/site", publication: "site", format: "web.page.responsive" };
const config = (value: unknown = target) => `export default { targets: { site: ${JSON.stringify(value)} } };\nexport const siteSyncHost = ${JSON.stringify(host)} as const;`;

it("reads canonical literal data and typed defineConfig without running imports", () => {
  expect(parseSiteSyncConfig(config())).toEqual({ target, host });
  expect(parseSiteSyncConfig(`import { defineConfig as configure } from "@clossys/producer/config";\nimport type { SiteSyncHost } from "@clossys/publisher/site-sync";\nexport default configure({ targets: { site: ${JSON.stringify(target)} } });\nexport const siteSyncHost: SiteSyncHost = ${JSON.stringify(host)};`)).toEqual({ target, host });
});

it("refuses top-level effects, executable values and inert-looking getters without evaluating them", () => {
  const probes = [
    `globalThis.siteSyncProbe = true;\n${config()}`,
    config().replace(JSON.stringify(target), `(() => (${JSON.stringify(target)}))()`),
    config().replace('"app":"apps/site"', 'get app() { globalThis.siteSyncProbe = true; return "apps/site"; }'),
    `import "node:fs";\n${config()}`,
    config().replace('"locale":"en"', '"locale":process.env.LANG'),
    config().replace('"locale":"en"', '"locale":"en", "locale":"fr"'),
    config().replace('"locale":"en"', '...{locale:"en"}'),
    config().replace('"app":"apps/site",', '"app":"apps/site" '),
  ];
  for (const source of probes) expect(() => parseSiteSyncConfig(source)).toThrow(TypeError);
  expect(Object.hasOwn(globalThis, "siteSyncProbe")).toBe(false);
});

it("refuses ambiguous web targets, target traversal and malformed source ports", () => {
  expect(() => parseSiteSyncConfig(config().replace('site: ', 'site: ' + JSON.stringify(target) + ', other: '))).toThrow();
  for (const app of ["apps/../escape", "apps/site/", "apps/site\\escape"]) expect(() => parseSiteSyncConfig(config({ ...target, app }))).toThrow();
  expect(() => parseSiteSyncConfig(config().replace('"export":"Frame"', '"export":"default"'))).toThrow();
  expect(() => parseSiteSyncConfig(config().replace('"expires":"2027-10-29T00:00:00Z"', '"expires":42'))).toThrow();
});
