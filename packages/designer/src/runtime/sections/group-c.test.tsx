import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as blocks from "../../blocks/index.js";
import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { scanProvenance } from "../../catalog-core/provenance-scan.js";
import { runtimeHash, SECTION_HEADER_CONTENT_KEY, type RuntimeContent, type RuntimeFillDescriptor, type RuntimeJson, type RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import type { CompositeResolved } from "../../catalog-core/types.js";
import { checkWiring } from "../../catalog-core/wiring.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { ANATOMY_CONTENT_KEY } from "./group-c-content.js";
import { GROUP_C_LEAVES, sectionDatasetC, sectionInputsC, sectionRenderersC, type GroupCLeaf } from "./group-c.js";

// Each group-c Section renders from its generated fill with shared-dataset content, through its package-owned
// runtime renderer: real component roles in the DOM, a sections stamp with no WL1 chrome outside it, and a
// renderer source whose only elements are the registered block and the components its contract allows (WL10).

afterEach(cleanup);

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const read = (path: string) => readFileSync(here(path), "utf8");

interface FillDocument {
  readonly $extensions: { readonly "com.clossys.fill": { readonly id: string; readonly pin: { readonly export: string } } };
  readonly sections: Record<string, { readonly impl: { readonly export: string; readonly module: string }; readonly slotMap: Record<string, string>; readonly propMap: Record<string, string> }>;
}
interface ContractRow { readonly id: string; readonly contract: { readonly slots: readonly { readonly name: string; readonly type: RuntimeContent["reference"]["kind"]; readonly required?: boolean }[]; readonly allowedComposes: readonly string[]; readonly parts?: readonly string[]; readonly members: { readonly names?: readonly string[] }; readonly anatomy?: { readonly header?: string | null } } }

const contracts = new Map((JSON.parse(read("../../catalog/slots/sections.json")) as ContractRow[]).map(row => [row.id, row.contract]));
const fillOf = (leaf: GroupCLeaf): FillDocument => JSON.parse(read(`../../catalog/fills/foundry/sections.${leaf}.json`)) as FillDocument;

const BLOCK_MODULE: Record<GroupCLeaf, string> = {
  cards: "../../blocks/RecordCards.js", chat: "../../blocks/chat/Chat.js", consent: "../../blocks/ConsentBanner.js",
  "empty-state": "../../blocks/EmptyState.js", "error-state": "../../blocks/ErrorState.js", form: "../../blocks/Form.js",
  "link-index": "../../blocks/NavGrid.js", notices: "../../blocks/NoticeList.js", "page-header": "../../blocks/PageHeader.js",
  pagination: "../../blocks/Pagination.js", "section-header": "../../blocks/SectionHeader.js", settings: "../../blocks/SettingsSection.js",
  steps: "../../blocks/OrderedStepSequence.js", "table-of-contents": "../../blocks/TableOfContents.js", wizard: "../../blocks/FormWizard.js",
};
const COMPONENT_MODULE: Record<string, string> = {
  avatar: "Avatar", badge: "Badge", banner: "Banner", breadcrumbs: "Breadcrumb", button: "Button", card: "Card", checkbox: "Checkbox",
  "combo-box": "ComboBox", disclosure: "Disclosure", field: "Field", "file-trigger": "FileTrigger", form: "Form", icon: "Icon", link: "Link",
  "progress-bar": "ProgressBar", select: "Select", spinner: "Spinner", "status-mark": "StatusMark", switch: "Switch", tabs: "Tabs",
  "text-field": "TextField", menu: "Menu", toast: "Toast", tooltip: "Tooltip",
};
const VISUAL_MODULE = /(?:^|\/)(?:components|blocks|sections|frames|shell|icons|charts)(?:\/|\.|$)/;

/** Modules a leaf's renderer may import elements from: its block, its contract's components (an icon allows the glyph index). */
function allowedModules(leaf: GroupCLeaf): Set<string> {
  const contract = contracts.get(`sections.${leaf}`)!;
  const modules = new Set([BLOCK_MODULE[leaf]]);
  for (const id of contract.allowedComposes) {
    const name = id.replace(/^components\./, "");
    expect(COMPONENT_MODULE[name], `${leaf}: ${id} has a component module`).toBeDefined();
    modules.add(`../../components/${COMPONENT_MODULE[name]}.js`);
    if (name === "icon") modules.add("../../icons/index.js");
  }
  return modules;
}

interface ImportRow { readonly module: string; readonly symbols: readonly string[]; readonly typeOnly: boolean }
function importsOf(source: string): ImportRow[] {
  return [...source.matchAll(/^import\s+(type\s+)?([\s\S]+?)\s+from\s+"([^"]+)";/gm)].map(match => {
    const clause = match[2]!;
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? "";
    const symbols = named.split(",").map(part => part.trim()).filter(part => part && !part.startsWith("type ")).map(part => part.split(/\s+as\s+/)[0]!);
    if (/\*\s+as\s+\w+/.test(clause)) symbols.push("*");
    return { module: match[3]!, symbols, typeOnly: Boolean(match[1]) || (!symbols.length && /\{/.test(clause)) };
  });
}

const descriptorOf = (leaf: GroupCLeaf): RuntimeFillDescriptor => {
  const document = fillOf(leaf), entry = document.sections[leaf]!;
  return {
    kind: "section", library: "foundry", fill: document.$extensions["com.clossys.fill"].id, leaf: `sections.${leaf}`, config: null,
    slots: Object.keys(entry.slotMap), members: Object.keys(entry.propMap), states: [],
    renderer: { id: `foundry/sections.${leaf}`, source: { entry: `${leaf}.tsx`, files: {}, dependencies: {} }, sourceHash: runtimeHash(leaf) },
  };
};

function inputFor(leaf: GroupCLeaf, content: Readonly<Record<string, RuntimeJson>>, members: readonly string[] = []): RuntimeRenderInput<ReactNode> {
  const contract = contracts.get(`sections.${leaf}`)!;
  const kinds = new Map(contract.slots.map(slot => [slot.name, slot.type]));
  const fill = descriptorOf(leaf);
  const rows = Object.fromEntries(Object.entries(content).map(([slot, value]) => {
    const kind = slot === ANATOMY_CONTENT_KEY ? "copy" : kinds.get(slot);
    if (!kind) throw new Error(`${leaf}: test content names unknown slot ${slot}`);
    return [slot, { reference: { kind, ref: `dataset:${leaf}.${slot}` }, value, hash: runtimeHash(value) } satisfies RuntimeContent];
  }));
  return {
    path: `routes/preview/sections/${leaf}`, fill, cell: { theme: "light", state: "default", width: 1280 },
    selection: { leaf: fill.leaf, fill: fill.fill, config: null, members, content: Object.fromEntries(Object.entries(rows).map(([slot, row]) => [slot, row.reference])) },
    content: rows, slots: {}, profile: {} as CompositeResolved,
  };
}

const page = dsAttrs("pages", "pages.preview", "foundry/pages.preview");
const renderLeaf = (leaf: GroupCLeaf, input: RuntimeRenderInput<ReactNode>) => sectionRenderersC[`sections.${leaf}`]!(input);
const datasetInput = (leaf: GroupCLeaf, members: readonly string[] = []) => inputFor(leaf, sectionDatasetC[leaf](specimenDataset), members);

function provenanceOf(leaf: GroupCLeaf, node: ReactNode) {
  const html = renderToStaticMarkup(h("div", page, node));
  const scan = scanProvenance({
    html,
    route: { id: "preview", binding: { frame: { leaf: "frames.preview" }, frameSlots: {}, sections: { body: [{ leaf: `sections.${leaf}` }] } } },
    selection: { [`sections.${leaf}`]: `foundry/sections.${leaf}` },
  });
  return { html, findings: scan.findings };
}

function wiringOf(leaf: GroupCLeaf, source = read(`./${leaf}.tsx`)) {
  const allowed = allowedModules(leaf);
  const rows = importsOf(source).filter(row => !row.typeOnly && VISUAL_MODULE.test(row.module));
  const assembly = rows.filter(row => allowed.has(row.module)).flatMap(row => row.symbols.map(symbol => ({ module: row.module, export: symbol })));
  const result = checkWiring({ sources: [], routes: { modules: [{ path: `src/runtime/sections/${leaf}.tsx`, content: source }], assembly } });
  return { result, outside: rows.filter(row => !allowed.has(row.module)).map(row => row.module) };
}

const S = specimenDataset.sections;
/** Real component roles each leaf must render from dataset content: each leaf's `specimenDataset.sections` record. */
const ROLES: Record<GroupCLeaf, (root: HTMLElement) => void> = {
  cards: root => {
    const list = within(root).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(S.recordCards.records.length);
    expect(within(list).getAllByRole("link").map(link => link.textContent)).toEqual(S.recordCards.records.map(record => record.title));
  },
  chat: root => {
    expect(within(root).getByRole("log")).toBeTruthy();
    expect(within(root).getByPlaceholderText(S.chat.placeholder)).toBeTruthy();
    for (const message of S.chat.messages) expect(within(root).getByText(message.content)).toBeTruthy();
  },
  consent: root => {
    expect(within(root).getByRole("button", { name: S.consentBanner.acceptLabel })).toBeTruthy();
    expect(within(root).getByRole("button", { name: S.consentBanner.rejectLabel })).toBeTruthy();
    expect(within(root).getByRole("link", { name: S.consentBanner.privacy.label })).toHaveAttribute("href", S.consentBanner.privacy.href);
  },
  "empty-state": root => {
    expect(within(root).getByRole("heading", { name: S.emptyState.title })).toBeTruthy();
    expect(within(root).getByRole("img", { name: specimenDataset.icon.label })).toBeTruthy();
    expect(within(root).getByRole("button", { name: specimenDataset.text.upload })).toBeTruthy();
  },
  "error-state": root => {
    expect(within(root).getByRole("heading", { name: S.errorState.title })).toBeTruthy();
    expect(within(root).getByText(S.errorState.code)).toBeTruthy();
    expect(within(root).getByRole("button", { name: S.errorState.retryLabel })).toBeTruthy();
    expect(within(root).getByRole("link", { name: S.errorState.report.label })).toBeTruthy();
  },
  form: root => {
    expect(within(root).getByRole("heading", { name: S.form.heading })).toBeTruthy();
    for (const field of S.form.fields) expect(within(root).getByRole("textbox", { name: field.label })).toHaveAttribute("type", field.type);
    expect(within(root).getByRole("button", { name: S.form.submit })).toBeTruthy();
  },
  "link-index": root => {
    expect(within(root).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(S.navGrid.items.map(item => item.href));
  },
  notices: root => {
    const list = within(root).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(S.noticeList.notices.length);
    for (const notice of S.noticeList.notices) expect(within(root).getByText(notice.message)).toBeTruthy();
  },
  "page-header": root => {
    expect(within(root).getByRole("heading", { level: 1, name: S.pageHeader.title })).toBeTruthy();
    expect(within(root).getByText(S.pageHeader.description)).toBeTruthy();
    const crumbs = within(root).getAllByRole("link");
    expect(crumbs.map(link => link.textContent)).toEqual(specimenDataset.breadcrumbs.items.map(item => item.label));
    expect(crumbs.at(-1)!.getAttribute("aria-current")).toBe("page");
    expect(within(root).getByRole("button", { name: specimenDataset.dialog.trigger })).toBeTruthy();
  },
  pagination: root => {
    expect(within(root).getByRole("navigation")).toBeTruthy();
    expect(root.querySelector('[aria-current="page"]')?.textContent).toContain(String(S.pagination.page));
  },
  "section-header": root => {
    expect(within(root).getByRole("heading", { name: S.sectionHeader.title })).toBeTruthy();
    expect(within(root).getByText(S.sectionHeader.eyebrow)).toBeTruthy();
    expect(within(root).getByRole("link", { name: specimenDataset.text.link })).toBeTruthy();
  },
  settings: root => {
    expect(within(root).getByRole("heading", { name: S.settingsSection.heading as string })).toBeTruthy();
    expect(within(root).getAllByRole("group").length).toBeGreaterThanOrEqual(S.settingsSection.groups.length);
    expect(within(root).getAllByRole("switch").length).toBe(2);
    expect(within(root).getByRole("button", { name: specimenDataset.text.action })).toBeTruthy();
  },
  steps: root => {
    const list = within(root).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(S.orderedSteps.items.length);
    for (const item of S.orderedSteps.items) expect(within(root).getByText(item.heading)).toBeTruthy();
  },
  "table-of-contents": root => {
    expect(within(root).getByRole("navigation", { name: S.tableOfContents.label })).toBeTruthy();
    expect(within(root).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(S.tableOfContents.items.map(item => `#${item.id}`));
  },
  wizard: root => {
    expect(within(root).getByRole("progressbar")).toBeTruthy();
    expect(within(root).getByRole("button", { name: S.formWizard.labels.back })).toBeTruthy();
    expect(within(root).getByRole("button", { name: S.formWizard.labels.next })).toBeTruthy();
  },
};

describe("group-c Section runtime renderers", () => {
  it("registers exactly the fifteen group-c leaves", () => {
    expect(Object.keys(sectionRenderersC).sort()).toEqual(GROUP_C_LEAVES.map(leaf => `sections.${leaf}`).sort());
    expect(GROUP_C_LEAVES).toHaveLength(15);
  });

  for (const leaf of GROUP_C_LEAVES) describe(`sections.${leaf}`, () => {
    it("consumes exactly its generated fill's slot and member keys, and its fill pins a ./blocks export", () => {
      const document = fillOf(leaf), entry = document.sections[leaf]!;
      expect([...sectionInputsC[leaf].slots].sort()).toEqual(Object.keys(entry.slotMap).sort());
      expect([...sectionInputsC[leaf].members].sort()).toEqual(Object.keys(entry.propMap).sort());
      expect(typeof (blocks as Record<string, unknown>)[entry.impl.export]).not.toBe("undefined");
      expect(read(`./${leaf}.tsx`)).toMatch(new RegExp(`import \\{ ${entry.impl.export} \\} from "${BLOCK_MODULE[leaf].replace(/[./]/g, "\\$&")}"`));
      const contract = contracts.get(`sections.${leaf}`)!;
      const covered = new Set([...sectionInputsC[leaf].slots, ...sectionInputsC[leaf].unmapped?.slots ?? []]);
      expect(contract.slots.map(slot => slot.name).filter(slot => !covered.has(slot))).toEqual([]);
    });

    it("dataset content fills every mapped required slot and only contract slots", () => {
      const content = sectionDatasetC[leaf](specimenDataset);
      const contract = contracts.get(`sections.${leaf}`)!;
      const names = new Set(contract.slots.map(slot => slot.name));
      for (const slot of Object.keys(content)) expect(slot === ANATOMY_CONTENT_KEY || names.has(slot), `${leaf}.${slot}`).toBe(true);
      for (const slot of contract.slots) if (slot.required && sectionInputsC[leaf].slots.includes(slot.name)) expect(content[slot.name], `${leaf}.${slot.name}`).toBeDefined();
    });

    it("renders real component roles from its fill with dataset content", () => {
      const { container } = render(<div>{renderLeaf(leaf, datasetInput(leaf))}</div>);
      const root = container.querySelector(`[data-ds-leaf="sections.${leaf}"]`) as HTMLElement | null;
      expect(root, "section stamp").not.toBeNull();
      expect(root!.getAttribute("data-ds-fill")).toBe(`foundry/sections.${leaf}`);
      // Query from the wrapper so a block whose root is itself the landmark or list is matched too.
      ROLES[leaf](root!.parentElement!);
    });

    it("draws no chrome outside its section stamp (WL1) and renders only its assembly (WL10)", () => {
      const { html, findings } = provenanceOf(leaf, renderLeaf(leaf, datasetInput(leaf)));
      expect(html).toContain(`data-ds-leaf="sections.${leaf}"`);
      expect(findings).toEqual([]);
      const { result, outside } = wiringOf(leaf);
      expect(outside).toEqual([]);
      expect(result.findings.filter(row => row.code === "WL10")).toEqual([]);
    });
  });
});

describe("group-c members, refusals and optional slots", () => {
  it("cards: layout.list reaches RecordCards", () => {
    const { container } = render(<div>{renderLeaf("cards", datasetInput("cards", ["layout.list"]))}</div>);
    expect(container.querySelector('[data-ds-leaf="sections.cards"] ul, ul[data-ds-leaf="sections.cards"]')?.className).toContain("flex-col");
  });

  it("error-state: kind members reach ErrorState", () => {
    const { container } = render(<div>{renderLeaf("error-state", datasetInput("error-state", ["kind.offline"]))}</div>);
    expect(container.querySelector('[data-error-kind]')?.getAttribute("data-error-kind")).toBe("offline");
  });

  it("section-header: align and density members reach SectionHeader", () => {
    const centered = renderToStaticMarkup(h("div", null, renderLeaf("section-header", datasetInput("section-header", ["align.center", "density.compact"]))));
    const start = renderToStaticMarkup(h("div", null, renderLeaf("section-header", datasetInput("section-header", ["align.start", "density.display"]))));
    expect(centered).not.toEqual(start);
    expect(centered).toContain("text-center");
  });

  it("form: an error-summary region renders the block's error summary", () => {
    const content = { ...sectionDatasetC.form(specimenDataset), "error-summary": { errors: [{ fieldId: "name", message: "Enter a name" }], message: "Fix 1 field" } };
    const { container } = render(<div>{renderLeaf("form", inputFor("form", content))}</div>);
    expect(within(container).getByText("Enter a name")).toBeTruthy();
  });

  it("refuses a missing required slot, an unmapped slot or member, and two members on one axis", () => {
    const { records: _records, ...withoutRecords } = sectionDatasetC.cards(specimenDataset);
    expect(() => renderLeaf("cards", inputFor("cards", withoutRecords))).toThrow(/required content slot "records"/);
    expect(() => renderLeaf("page-header", inputFor("page-header", { ...sectionDatasetC["page-header"](specimenDataset), meta: { items: [] } }))).toThrow(/"meta" has no API/);
    expect(() => renderLeaf("link-index", datasetInput("link-index", ["layout.list"]))).toThrow(/"layout.list" has no API/);
    expect(() => renderLeaf("cards", datasetInput("cards", ["layout.grid", "layout.list"]))).toThrow(/one axis twice/);
  });

  it("refuses required anatomy copy that no contract slot carries, naming the NEED", () => {
    const { [ANATOMY_CONTENT_KEY]: _header, ...bare } = sectionDatasetC["empty-state"](specimenDataset);
    expect(() => renderLeaf("empty-state", inputFor("empty-state", bare))).toThrow(/NEED: anatomy.header on sections.empty-state/);
  });

  it("puts header copy only on the runtime header channel, keyed by the section-header slots (L9)", () => {
    expect(ANATOMY_CONTENT_KEY).toBe(SECTION_HEADER_CONTENT_KEY);
    const headerSlots = contracts.get("sections.section-header")!.slots;
    for (const leaf of GROUP_C_LEAVES) {
      const header = sectionDatasetC[leaf](specimenDataset)[ANATOMY_CONTENT_KEY];
      if (header === undefined) continue;
      // Assembly admits the channel only where the contract names a header part (table-of-contents has none).
      expect(contracts.get(`sections.${leaf}`)!.anatomy?.header, leaf).toBe("sections.section-header");
      expect(Object.keys(header as object).filter(key => !headerSlots.some(slot => slot.name === key)), leaf).toEqual([]);
      for (const slot of headerSlots) if (slot.required) expect((header as Record<string, RuntimeJson>)[slot.name], `${leaf}.${slot.name}`).toBeTruthy();
    }
    for (const leaf of ["notices", "wizard"] as const) expect(sectionDatasetC[leaf](specimenDataset)[ANATOMY_CONTENT_KEY], leaf).toHaveProperty("heading");
    expect(sectionDatasetC["table-of-contents"](specimenDataset)).not.toHaveProperty(ANATOMY_CONTENT_KEY);
  });

  it("refuses more actions than the contract allows", () => {
    const content = { ...sectionDatasetC.consent(specimenDataset), actions: [{ label: "A" }, { label: "B" }, { label: "C" }] };
    expect(() => renderLeaf("consent", inputFor("consent", content))).toThrow(/at most 2/);
  });
});
