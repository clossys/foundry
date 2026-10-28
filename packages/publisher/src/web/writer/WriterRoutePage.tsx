"use client";
import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { Banner, Button, SemanticContent, Toolbar } from "@clossys/designer/components";
import { DataTable, DetailView, NoticeList } from "@clossys/designer/blocks";
import { APP_FRAME_RIGHT_PANEL_CONFIG, ShellCopyProvider, surfaceRuntimeCallbacks, surfaceRendererId } from "@clossys/designer/frames";
import { SlotModule } from "@clossys/designer/shell";
import { checkConsumerRuntimePorts, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeContentRef, RuntimeRenderInput } from "@clossys/designer/catalog";
import { checkedDesignerRouteData } from "@clossys/designer/studio/route/server";
import type { DesignerRoutePageProps } from "@clossys/designer/studio/route";
import { withCompleteRouteNavigation } from "../complete-route-navigation.js";
import type { CompleteRouteServerData } from "../complete-route-navigation.js";
import { resolveAdminCopyRef, type AdminCopy, type AdminCopyRef } from "@clossys/writer/admin-copy";
import { registeredRouteServerData } from "../../core/route-server-data.js";
import { WRITER_COPY_REFS } from "./copy.js";

export interface WriterRouteServerData extends CompleteRouteServerData {
  readonly writer: { readonly copy: AdminCopy; readonly selectedRecordId?: string };
}
export interface WriterRoutePageProps {
  readonly serverData: WriterRouteServerData;
  readonly initialSession: DesignerRoutePageProps["initialSession"];
}
const SECTIONS = ["sections.data-table", "sections.record-detail", "sections.notices"] as const;
/** Copy absence is an explicit Need, never an inline replacement sentence. */
function requiredCopy(copy: AdminCopy, ref: AdminCopyRef) {
  const result = resolveAdminCopyRef(ref, copy);
  if (!result) throw new TypeError(`Writer copy Need: ${ref.id}`);
  return result;
}
function Copy({ copy, reference }: { copy: AdminCopy; reference: AdminCopyRef }) {
  const value = requiredCopy(copy, reference);
  return <SemanticContent as="span" data-copy-ref={value.ref.id} data-copy-locale={value.servedLocale} data-copy-status={value.status}>{value.text}</SemanticContent>;
}
/** Read-only English record inspection. The host supplies its actual loaded store;
 * shipped defaults are never substituted for absent host records. */
export function WriterRoutePage({ serverData, initialSession }: WriterRoutePageProps) {
  const checked = useMemo(() => {
    if (!initialSession) return undefined;
    try {
      const finite = registeredRouteServerData(withCompleteRouteNavigation(serverData));
      if (finite.writer.copy.envelopes.some(envelope => envelope.locale !== "en")) throw new TypeError("Writer English store required");
      return checkedDesignerRouteData(finite, initialSession);
    }
    catch { return null; }
  }, [serverData, initialSession]);
  const copy = serverData.writer.copy;
  if (checked === undefined) return <Banner><Copy copy={copy} reference={WRITER_COPY_REFS.loading} /></Banner>;
  if (checked === null) return <Banner variant="danger"><Copy copy={copy} reference={WRITER_COPY_REFS.error} /></Banner>;
  return <WriterRouteSurface checked={checked} copy={copy} selectedRecordId={serverData.writer.selectedRecordId} />;
}
function WriterRouteSurface({ checked, copy, selectedRecordId }: { checked: ReturnType<typeof checkedDesignerRouteData>; copy: AdminCopy; selectedRecordId?: string }) {
  const { data, profile, contracts } = checked;
  const [selected, setSelected] = useState(selectedRecordId);
  const shellCopy = useCallback((reference: AdminCopyRef) => {
    const value = resolveAdminCopyRef(reference, copy);
    return value && { ref: reference, text: value.text };
  }, [copy]);
  const contents = useMemo(() => new Map(data.contents.map(row => [runtimeHash(row.reference), row])), [data.contents]);
  const renderers = useMemo(() => surfaceRuntimeCallbacks(data.manifest.fills.map(fill => fill.leaf)), [data.manifest]);
  const resolveCopy = (reference: AdminCopyRef) => requiredCopy(copy, reference);
  const hasSelection = copy.records.some(record => record.id === selected);
  const ports = { manifest: data.manifest, renderers, resolveContent: (reference: RuntimeContentRef) => contents.get(runtimeHash(reference)), frameHost: { panels: { inspector: hasSelection ? null as ReactNode : undefined }, navigate(href: string) { window.location.assign(new URL(href, window.location.href).href); } } };
  const frame = data.manifest.fills.find(fill => fill.kind === "frame" && fill.leaf === "frames.app-shell" && fill.leaf === data.frame.leaf && fill.fill === data.frame.fill && fill.config === data.frame.config && fill.library === profile.consumer);
  const selectedFrame = profile.surfaces?.fills[data.frame.leaf];
  const sectionsReady = SECTIONS.every(leaf => {
    const chosen = profile.surfaces?.fills[leaf];
    return chosen && data.manifest.fills.some(fill => fill.kind === "section" && fill.leaf === leaf && fill.library === profile.consumer && fill.fill === chosen.document.$extensions["com.clossys.fill"].id && fill.renderer.id === surfaceRendererId(leaf));
  });
  if (!frame || !selectedFrame || selectedFrame.document.$extensions["com.clossys.fill"].id !== frame.fill || frame.renderer.id !== surfaceRendererId(frame.leaf)
    || !frame.headerModule || data.frame.members.some(member => !frame.members.includes(member)) || !sectionsReady
    || checkConsumerRuntimePorts(ports, contracts, { consumer: profile.consumer, libraryHash: data.manifest.libraryHash, selectionHash: profile.selectionHash as `sha256:${string}` }).status !== "valid") {
    return <Banner variant="danger"><Copy copy={copy} reference={WRITER_COPY_REFS.error} /></Banner>;
  }
  const content: Record<string, import("@clossys/designer/catalog").RuntimeContent> = {};
  for (const [slot, reference] of Object.entries(data.frame.content)) {
    const row = ports.resolveContent(reference);
    if (!row || row.hash !== runtimeHash(row.value)) return <Banner variant="danger"><Copy copy={copy} reference={WRITER_COPY_REFS.error} /></Banner>;
    content[slot] = row;
  }
  if (hasSelection && !content.inspector) {
    const value = { label: resolveCopy(WRITER_COPY_REFS.detail).text, handleLabel: resolveCopy(WRITER_COPY_REFS.resize).text, ...APP_FRAME_RIGHT_PANEL_CONFIG };
    content.inspector = { reference: { kind: "records", ref: "writer.inspector" }, value, hash: runtimeHash(value) };
  }
  const title = resolveCopy(WRITER_COPY_REFS.title);
  const body = <WriterRecords key="writer" copy={copy} selected={selected} onSelect={setSelected} />;
  const input: RuntimeRenderInput<ReactNode> = { path: "frame", fill: frame, selection: data.frame, content, slots: { main: [body] }, profile, cell: data.cell, host: ports.frameHost, locale: "en",
    pageHeader: { id: data.header.id, data: { title: title.text }, module: frame.headerModule } };
  return <ShellCopyProvider resolver={shellCopy}><SemanticContent as="span" hidden data-route-display="writer" data-route-authentication="unverified" data-writer-header-copy-ref={title.ref.id} />{renderers[frame.renderer.id]!(input)}</ShellCopyProvider>;
}

const WRITER_PAGE_SIZE = 50;

function WriterRecords({ copy, selected, onSelect }: { copy: AdminCopy; selected?: string; onSelect: (id?: string) => void }) {
  const id = useId();
  // Start on the selected record's page; navigation does not discard its inspector.
  const [requestedPage, setPage] = useState(() => Math.floor(Math.max(0, copy.records.findIndex(row => row.id === selected)) / WRITER_PAGE_SIZE) + 1);
  const pageCount = Math.max(1, Math.ceil(copy.records.length / WRITER_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const rows = copy.records.slice((page - 1) * WRITER_PAGE_SIZE, page * WRITER_PAGE_SIZE);
  const read = (key: keyof typeof WRITER_COPY_REFS) => requiredCopy(copy, WRITER_COPY_REFS[key]).text;
  const text = (key: keyof typeof WRITER_COPY_REFS) => <Copy copy={copy} reference={WRITER_COPY_REFS[key]} />;
  const technical = (value: unknown) => <SemanticContent as="code" data-copy-value="technical">{typeof value === "string" ? value : JSON.stringify(value)}</SemanticContent>;
  const record = copy.records.find(row => row.id === selected);
  const bindings = copy.envelopes.flatMap(envelope => "bindings" in envelope ? envelope.bindings : []);
  const selectedBindings = record ? bindings.filter(binding => binding.recordId === record.id) : [];
  const needs = copy.envelopes.reduce((total, envelope) => total + ("needs" in envelope ? envelope.needs.length : 0), 0);
  return <>
    <DataTable aria-label={read("records")} columns={[
      { id: "id", header: text("id"), isRowHeader: true, cell: row => technical(row.id) },
      { id: "surface", header: text("surface"), cell: row => technical(row.context) },
      { id: "status", header: text("status"), cell: row => {
        if (row.status !== "draft" && row.status !== "approved" && row.status !== "retired") throw new TypeError("Writer record status Need");
        return text(row.status);
      } },
      { id: "locale", header: text("locale"), cell: () => technical("en") },
    ]} rows={rows} rowKey={row => row.id} selectionMode="single" selectedKeys={record ? [record.id] : []}
      onSelectionChange={keys => { if (keys !== "all") { const id = keys.values().next().value; onSelect(typeof id === "string" ? id : undefined); } }}
      messages={{ selectRowLabel: read("select") }} emptyStateTitle={text("empty")}
      footer={<Toolbar aria-label={read("pagination")} variant="bare">
        <Button variant="ghost" isDisabled={page <= 1} onPress={() => setPage(page - 1)}>{text("previousPage")}</Button>
        <Copy copy={copy} reference={{ ...WRITER_COPY_REFS.pageSummary, values: { page, pages: pageCount } }} />
        <Button variant="ghost" isDisabled={page >= pageCount} onPress={() => setPage(page + 1)}>{text("nextPage")}</Button>
      </Toolbar>} />
    {record && <SlotModule id={`${id}-writer-inspector`} slot="right-panel" label={read("detail")}><DetailView aria-label={read("detail")} title={text("detail")} fields={[
      { label: text("text"), value: <SemanticContent as="span" data-copy-ref={record.id} data-copy-locale="en" data-copy-status={record.status}>{record.text}</SemanticContent>, span: 2 },
      { label: text("bindings"), value: technical(selectedBindings.map(binding => binding.cellId)) },
      { label: text("consumers"), value: technical([...new Set(selectedBindings.map(binding => binding.target))]) },
    ]} /></SlotModule>}
    <NoticeList label={read("notices")} notices={[
      { id: "coverage", message: <Copy copy={copy} reference={{ ...WRITER_COPY_REFS.coverageSummary, values: { records: copy.records.length, bindings: bindings.length } }} />, dismissible: false },
      { id: "needs", message: <Copy copy={copy} reference={{ ...WRITER_COPY_REFS.needsSummary, values: { needs } }} />, dismissible: false },
    ]} />
  </>;
}
