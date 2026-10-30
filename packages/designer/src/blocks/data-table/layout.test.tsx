/** @vitest-environment node */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable } from "../DataTable.js";
import { DetailView } from "../DetailView.js";
import { Matrix } from "../Matrix.js";
import { PAGINATION_COPY_REFS, Pagination } from "../Pagination.js";
import { Button } from "../../components/Button.js";
import { SearchField } from "../../components/SearchField.js";
import { Select } from "../../components/Select.js";
import { selectChromium } from "../../__fixtures__/chromium-discovery.js";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import type { ShellCopyResolver } from "../../components/Banner.copy.js";
import { createCopyResolver } from "../../../../writer/src/resolve.js";
import type { StringRecord } from "../../../../writer/src/model/types.js";
import { withDeclaredCommonRecords } from "../../../../writer/src/catalog/__fixtures__/shared-records.fixture.js";
import sectionCopy from "../../../../writer/src/catalog/records/section-defaults.r1.en.json" with { type: "json" };

const packageRoot = resolve(import.meta.dirname, "../../..");
const paginationIds = new Set<string>(Object.values(PAGINATION_COPY_REFS).map(ref => ref.id));
const paginationRecords = withDeclaredCommonRecords(sectionCopy).filter((record): record is StringRecord => "text" in record && paginationIds.has(record.id));
const resolvePaginationCopy = createCopyResolver({
  id: "pagination-layout-fixture", locale: sectionCopy.locale, revision: String(sectionCopy.revision),
  source: { kind: "generated", reference: "writer/section-defaults.r1.en.json" },
  entries: paginationRecords.map(record => ({ ...record, placeholders: record.args?.map(arg => arg.name) })),
}, { target: "preview" });
const paginationCopyResolver: ShellCopyResolver = ref => {
  const resolved = resolvePaginationCopy(ref);
  return resolved ? { ref, text: resolved.text } : undefined;
};

// A real browser is required: jsdom has neither intrinsic table sizing nor container queries.
async function measure(html: string, run: (evaluate: (expression: string) => Promise<any>, send: (method: string, params?: object) => Promise<any>) => Promise<void>) {
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const chrome = selectChromium(process.env.FOUNDRY_TEST_CHROME ?? (existsSync(macChrome) ? macChrome : undefined), (path, args) => spawnSync(path, args, { stdio: "ignore" }));
  const profile = mkdtempSync(join(tmpdir(), "section-fit-"));
  const browser = spawn(chrome, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", `--user-data-dir=${profile}`, "--remote-debugging-pipe"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let sequence = 0, buffer = "", sessionId: string | undefined;
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();
  const send = (method: string, params: object = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Browser measurement timeout: ${method}`)); }, 10_000);
    pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
    (browser.stdio[3] as NodeJS.WritableStream).write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
  (browser.stdio[4] as NodeJS.ReadableStream).on("data", chunk => {
    buffer += String(chunk);
    let boundary: number;
    while ((boundary = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
      const task = pending.get(message.id); if (!task) continue;
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    }
  });
  const evaluate = async (expression: string) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  try {
    const target = await send("Target.createTarget", { url: "about:blank" });
    sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
    await send("Page.enable");
    const { frameTree } = await send("Page.getFrameTree");
    await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
    await run(evaluate, send);
  } finally {
    for (const task of pending.values()) task.reject(new Error("Browser measurement closed"));
    browser.kill();
    await new Promise<void>(resolve => browser.once("exit", () => resolve()));
    rmSync(profile, { recursive: true, force: true });
  }
}

const columns = [
  { id: "name", header: "Publication", isRowHeader: true, allowsSorting: true, cell: (row: { id: string; name: string }) => row.name },
  { id: "state", header: "Status", cell: () => "Ready for publication" },
  { id: "channel", header: "Channel", cell: () => "Public website and email" },
  { id: "action", header: "Actions", cell: () => <Button>Configure</Button> },
];
const rows = [{ id: "one", name: "Quarterly publication with a meaningful descriptive title" }];
const model = { version: 2, table: { version: 1, collation: { locale: "en", sensitivity: "base", numeric: true }, columns: [{ id: "name", kind: "text" }], groupBy: [{ column: "name" }] }, mode: "grouped", density: "comfortable", sort: [], visibleColumns: ["name"] } as const;

function fixture() {
  return <ShellCopyProvider resolver={paginationCopyResolver}>
    <section data-proof="table"><DataTable aria-label="Publisher" columns={columns} rows={rows} rowKey={row => row.id}
      toolbar={<><SearchField label="Search publications" /><Select label="Status" options={[{ id: "all", label: "All publications" }]} selectedKey="all" /></>}
      footer={<Pagination page={4} pageCount={15} onPageChange={() => {}} />} /></section>
    <section data-proof="grouped"><DataTable aria-label="Grouped" columns={[columns[0]!]} rows={rows} rowKey={row => row.id} model={model} onModelChange={() => {}} /></section>
    <section data-proof="detail"><DetailView title="Publication record" fields={[{ label: "Name", value: rows[0]!.name }]} actions={<><Button>Edit</Button><Button>Duplicate</Button></>} compactActions={<Button aria-haspopup="menu">Actions</Button>} /></section>
    <section data-proof="comparison"><Matrix arrangement="grid" featured={{ column: "b" }} featuredLabel="Recommended plan" columns={[{ id: "a", label: "Current" }, { id: "b", label: "Proposed" }]}
      rows={[{ id: "price", label: "Price", cells: { a: { type: "figure", value: "1,200" }, b: { type: "figure", value: "2,400" } } }, { id: "seats", label: "Seats", cells: { a: { type: "figure", value: "12" }, b: { type: "figure", value: "24" } } }]} /></section>
  </ShellCopyProvider>;
}

const overflowProbe = `(() => [...document.querySelectorAll('[data-proof]')].flatMap(section => {
  const bounds = section.getBoundingClientRect();
  return [...section.querySelectorAll('*')].filter(node => {
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
    if (!rect.width || !rect.height || css.visibility === 'hidden' || node.closest('[hidden]')) return false;
    if ((css.clip !== 'auto' && css.clip !== '') || css.clipPath === 'inset(50%)') return false;
    for (let parent = node.parentElement; parent && parent !== section; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      if ((parentStyle.clip !== 'auto' && parentStyle.clip !== '') || parentStyle.clipPath === 'inset(50%)') return false;
      const overflow = parentStyle.overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return false;
    }
    return rect.width > bounds.width + 1 || rect.right > bounds.right + 1 || rect.left < bounds.left - 1;
  }).map(node => ({section: section.dataset.proof, tag:node.tagName, text:node.textContent?.slice(0,60)}));
}))()`;

describe("section container fit, measured in Chromium", () => {
  it("fits 390 and 1440, preserves Configure, and detects missing intrinsic sizing or scroll", async () => {
    expect(paginationRecords).toHaveLength(paginationIds.size);
    expect(paginationRecords.every(record => record.status === "draft" && record.approval === undefined)).toBe(true);
    const css = readFileSync(join(packageRoot, "styles/compiled.css"), "utf8");
    await measure(`<!doctype html><meta charset="utf-8"><style>${css}body{margin:0}main{display:flex;flex-direction:column;gap:24px;padding:16px}[data-proof]{min-width:0;width:100%;max-width:100%}</style><main>${renderToStaticMarkup(fixture())}</main>`, async (evaluate, send) => {
      for (const viewport of [390, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", { width: viewport, height: 2000, deviceScaleFactor: 1, mobile: false });
        expect(await evaluate(overflowProbe), `overflow at ${viewport}`).toEqual([]);
        const size = await evaluate(`(() => {const section=document.querySelector('[data-proof="table"]');const cell=[...section.querySelectorAll('td')].find(n=>n.textContent.includes('Configure'));const r=cell.getBoundingClientRect();return {cell:r.width,section:section.clientWidth,display:getComputedStyle(cell.parentElement).display}})()`);
        expect(size.cell).toBeLessThanOrEqual(size.section);
        expect(size.display).toBe(viewport === 390 ? "flex" : "table-row");
        expect(await evaluate(`(() => {const s=document.querySelector('[data-proof="table"]');return [s.querySelector('input[type="search"]').getBoundingClientRect().height,s.querySelector('button[aria-haspopup="listbox"]').getBoundingClientRect().height]})()`)).toEqual([32, 32]);
        expect(await evaluate(`(() => {const s=document.querySelector('[data-proof="detail"]');return [...s.querySelectorAll('button')].filter(n=>n.getBoundingClientRect().width).map(n=>n.textContent)})()`)).toEqual(viewport === 390 ? ["Actions"] : ["Edit", "Duplicate"]);
        expect(await evaluate(`(() => {const s=document.querySelector('[data-proof="comparison"]');return [...s.querySelectorAll('tbody td')].every(n=>getComputedStyle(n).textAlign==='end'&&getComputedStyle(n).fontVariantNumeric==='tabular-nums')&&[...s.querySelectorAll('th[scope="col"]')].every(n=>getComputedStyle(n).textAlign==='end'&&getComputedStyle(n).borderTopWidth==='0px')&&[...s.querySelectorAll('.rounded-pill')].every(n=>getComputedStyle(n).whiteSpace==='nowrap')})()`)).toBe(true);
      }
      // A narrow board in a wide viewport follows its own container width.
      await evaluate(`document.querySelector('[data-proof="table"]').style.width='390px';document.querySelector('[data-proof="detail"]').style.width='390px'`);
      expect(await evaluate(overflowProbe)).toEqual([]);
      expect(await evaluate(`getComputedStyle(document.querySelector('[data-proof="table"] tbody tr')).display`)).toBe("flex");
      // A flex parent's inline-flex child is blockified to flex by the browser.
      expect(await evaluate(`getComputedStyle(document.querySelector('[data-detail-actions-compact]')).display`)).toBe("flex");
      await evaluate(`document.querySelector('[data-proof="table"]').style.removeProperty('width');document.querySelector('[data-proof="detail"]').style.removeProperty('width')`);
      expect(await evaluate(`(() => {const n=document.querySelector('[data-proof="grouped"] [data-table-group]');return [n,...n.querySelectorAll('*')].every(e=>getComputedStyle(e).opacity==='1')})()`)).toBe(true);
      expect(await evaluate(`(() => {const walker=document.createTreeWalker(document.querySelector('main'),NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode())if(n.parentElement.tagName!=='STYLE'&&/[▲▼↕▾▸‹›]/.test(n.textContent))return false;return true})()`)).toBe(true);
      // A narrow board in a wide viewport must contain a real horizontal scrollbar.
      await evaluate(`document.querySelector('[data-proof="table"]').style.width='800px'`);
      expect(await evaluate(`(() => {const s=document.querySelector('[data-table-scroll]');return s.scrollWidth>s.clientWidth})()`)).toBe(true);
      // Mutation 1: deleting the intrinsic minimum makes the table squeeze into the board.
      await evaluate(`document.querySelector('[data-table-scroll] table').style.minInlineSize='0'`);
      expect(await evaluate(`(() => {const s=document.querySelector('[data-table-scroll]');return s.scrollWidth>s.clientWidth})()`)).toBe(false);
      await evaluate(`document.querySelector('[data-table-scroll] table').style.removeProperty('min-inline-size')`);
      // Mutation 2: deleting scroll containment must trip the same overflow oracle.
      await evaluate(`document.querySelector('[data-table-scroll]').style.overflow='visible'`);
      expect((await evaluate(overflowProbe)).length).toBeGreaterThan(0);
    });
  }, 30_000);
});
