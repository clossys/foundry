import { describe, expect, it } from "vitest";
import { pages as source, studio, chat, adminCopyFixture, copyEnvelopes } from "./__fixtures__/copy.mjs";
import { createAdminPageCopy, writerCopy, adminTechnicalData, resolveAdminPageValue, bindAdminPageLoaders } from "./admin-copy.js";
import { runtimeHash } from "@clossys/designer/catalog";

describe("Writer-backed admin page copy", () => {
  it("resolves real W1 aliases with ICU arguments and retains cell/record/revision evidence", () => {
    const copy = adminCopyFixture();
    const value = copy.resolve({ id: "strings.admin.stats.total", values: { count: 2 } });
    expect(value.text).toBe("2 records");
    expect(value.provenance).toMatchObject({ cellId: "strings.admin.stats.total", recordId: source.aliases["strings.admin.stats.total"], revision: source.revision, locale: "en", status: "draft", activation: "none" });
    expect(copy({ id: "strings.admin.page.writer" })).toBe("Writer");
  });
  it("refuses missing cells, invalid ICU arguments, foreign locale and raw display text", () => {
    const copy = adminCopyFixture();
    expect(() => copy({ id: "missing" })).toThrow(/Writer/);
    expect(() => copy({ id: "strings.admin.stats.total" })).toThrow(/Writer/);
    expect(() => copy({ id: "strings.admin.page.writer", locale: "fr" })).toThrow(/locale/);
    expect(() => resolveAdminPageValue(copy, { heading: "Unbound title" }, "copy")).toThrow(/CopyRef/);
    expect(() => resolveAdminPageValue(copy, { heading: adminTechnicalData("id", "unbound-heading") }, "copy")).toThrow(/cannot replace Writer UI copy/);
    expect(() => resolveAdminPageValue(copy, { label: adminTechnicalData("message", "unbound label") }, "records")).toThrow(/cannot replace Writer UI copy/);
    expect(resolveAdminPageValue(copy, { heading: writerCopy({ id: "strings.admin.page.writer" }), id: "strings--names", count: 2 }, "copy")).toEqual({ heading: "Writer", id: "strings--names", count: 2 });
  });
  it("resolves external aliases across declared source envelopes and refuses missing sources", () => {
    const copy = adminCopyFixture();
    const external = source.externalRecords.find(record => record.source === "admin-studio.r1.en.json")!;
    const alias = Object.entries(source.aliases).find(([, id]) => id === external.recordId)![0];
    expect(copy.resolve({id:alias}).provenance).toMatchObject({cellId:alias,recordId:external.recordId,bindingSource:"admin-pages.r1.en.json",recordSource:external.source});
    for (const alias of Object.keys(source.aliases).filter(alias => alias.startsWith("strings.admin.chat."))) expect(copy({id:alias}).trim()).not.toBe("");
    const missing = createAdminPageCopy({locale:"en",envelopes:copyEnvelopes().filter(envelope=>envelope.source!==external.source)});
    expect(()=>missing({id:alias})).toThrow(/Writer/);
    expect(()=>resolveAdminPageValue(copy,{kind:"copy",ref:"address",heading:"smuggled"},"records")).toThrow(/unbound/);
  });
  it("refuses technical markers in copy values and displayed text before loader caching", async () => {
    const copy = adminCopyFixture(), unbound = adminTechnicalData("id", "Unbound");
    for (const value of [unbound, { text: unbound, id: "heading" }, { value: unbound }, [unbound]]) {
      expect(() => resolveAdminPageValue(copy, value, "copy")).toThrow(/cannot replace Writer UI copy/);
    }
    expect(() => resolveAdminPageValue(copy, { header: { text: unbound } }, "records")).toThrow(/cannot replace Writer UI copy/);
    const reference = { kind: "copy" as const, ref: "card.header" }, value = { text: unbound, id: "heading" };
    const loaders = bindAdminPageLoaders(copy, { chunk: async () => [{ reference, value, hash: runtimeHash(value) }], search: async () => [], item: async () => undefined });
    await expect(loaders.chunk({ l0: "strings" })).rejects.toThrow(/cannot replace Writer UI copy/);
  });
  it("retains structural technical values, item values and chat content beside Writer labels", () => {
    const copy = adminCopyFixture();
    expect(resolveAdminPageValue(copy, {
      text: writerCopy({ id: "strings.admin.page.writer" }), id: adminTechnicalData("id", "strings--names"),
      href: adminTechnicalData("href", "/agents/writer"), locale: adminTechnicalData("locale", "ar"), count: 2,
    }, "copy")).toEqual({ text: "Writer", id: "strings--names", href: "/agents/writer", locale: "ar", count: 2 });
    expect(resolveAdminPageValue(copy, {
      fields: [{ label: writerCopy({ id: "strings.admin.column.id" }), value: adminTechnicalData("id", "item-1") },
        { label: writerCopy({ id: "strings.admin.column.lastPublished" }), value: adminTechnicalData("date", "2026-10-29T00:00:00Z") }],
      parts: [{ id: "message-1", role: "user", content: adminTechnicalData("message", "A user message") }],
      enabled: true, missing: null,
    }, "records")).toEqual({ fields: [{ label: copy("strings.admin.column.id"), value: "item-1" },
      { label: copy("strings.admin.column.lastPublished"), value: "2026-10-29T00:00:00Z" }],
      parts: [{ id: "message-1", role: "user", content: "A user message" }], enabled: true, missing: null });
  });
  it("serves both genuine Arabic fixture records inside an English UI without fallback", () => {
    const copy = adminCopyFixture();
    expect(copy.resolve({id:"strings.admin.page.writer",locale:"ar"})).toMatchObject({text:"الكاتب",provenance:{locale:"ar",mode:"writer-literal-preview"}});
    expect(copy({id:"strings.admin.column.text",locale:"ar"})).toBe("النص");
    expect(copy({id:"strings.admin.page.writer"})).toBe("Writer");
    expect(()=>copy({id:"strings.admin.page.writer",locale:"ar",values:{name:"bad"}})).toThrow(/Writer/);
  });
  it("resolves all 363 W1 aliases through authentic Writer records and declared cells", () => {
    const copy = adminCopyFixture(), records = [...source.records,...studio.records,...chat.records];
    for (const [alias,id] of Object.entries(source.aliases)) {
      const record = records.find(record=>record.id===id)!;
      const values=Object.fromEntries((record.args??[]).map(arg=>[arg.name,["number","plural","date"].includes(arg.type)?2:copy({id:"strings.admin.page.writer"})]));
      const resolved=copy.resolve({id:alias,...(Object.keys(values).length?{values}:{})});
      expect(resolved.provenance.cellId,alias).toBe(alias);
      expect(resolved.text.trim(),alias).not.toBe("");
    }
    expect(Object.keys(source.aliases)).toHaveLength(363);
  });
  it("refuses an unbound row returned by a consumer loader before caching or rendering", async () => {
    const value=[{id:"technical-id",text:"Unbound row text"}];
    const loaders=bindAdminPageLoaders(adminCopyFixture(),{chunk:async()=>[{reference:{kind:"records",ref:"rows"},value,hash:runtimeHash(value)}],search:async()=>[],item:async()=>undefined});
    await expect(loaders.chunk({l0:"strings"})).rejects.toThrow(/Writer CopyRef/);
  });
});
