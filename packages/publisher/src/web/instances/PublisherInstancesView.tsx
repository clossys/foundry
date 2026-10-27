"use client";
import { Link } from "@clossys/designer/components";
import { Button, Card, Select } from "@clossys/designer/components";

import { DetailView, Panel, SectionHeader } from "@clossys/designer/blocks";
import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { checkInstance, checkInstancePack } from "../../core/instance-binding.check.js";
import type { ConsumerInstanceLibrary, FlowInstanceBinding as InstanceBinding, InstanceFinding, InstanceRegistries, SectionFill } from "../../core/instance-binding.js";
import type { LayoutCompilerPort } from "../../core/layout-source.js";
import { getEffectiveLayoutContract } from "../../layouts/resolve.js";
import type { EffectivePageLayoutContract } from "../../layouts/resolve.js";
import type { BreakpointValues } from "../../core/flow-stage.js";
import { InstanceRuntimeRender } from "./InstanceRuntimeRender.js";
import type { InstanceRuntimeRoutes } from "./InstanceRuntimeRender.js";

export interface PublisherInstancesViewProps {
  /** Replace structural inputs when their contents or lookup observations change. */
  readonly instances: readonly InstanceBinding[];
  readonly library: ConsumerInstanceLibrary;
  readonly registries: InstanceRegistries;
  /** Host parser syntax only. Omission genuinely refuses LK11. */
  readonly compiler?: LayoutCompilerPort;
  /** Kept for API stability; the runtime assembly owns breakpoints now that no placeholder diagram reads them. */
  readonly breakpointValues: BreakpointValues;
  readonly designerHref: string;
  readonly packLabels?: Readonly<Record<string, string>>;
  /** Reuse the existing inspector inside a pack item; the host owns pack closure. */
  readonly presentation?: "standalone" | "item";
  /** Optional owner assembly beside the existing content inspector. */
  readonly assemblyPanel?: ReactNode;
  /** A containing pack can render its exact evaluation instead of recomputing its evidence panel. */
  readonly checkResultsPanel?: ReactNode;
  readonly assemblyTargetPrefix?: string;
  /** The host's registered-route runtime. An instance renders only through that closed binder; without it the preview states why. */
  readonly runtimeRoutes?: InstanceRuntimeRoutes;
}
const groups = [
  ["Structure", ["LK1", "LK2", "LK3", "LK4", "LK5", "LK6", "LK7", "LK15", "LK16"]],
  ["Content", ["LK10", "LK14"]], ["Responsive", ["LK11", "LK12", "LK13"]], ["Outline", ["LK8", "LK9"]],
] as const;
const status = (count: number) => count ? `${count} ${count === 1 ? "finding" : "findings"} · LK12 pending` : "Static checks pass · LK12 pending";

/** Read-only instance assembly and static evidence. No fill fallback or shipping operation. */
export function PublisherInstancesView({ instances, library, registries, compiler, designerHref, packLabels, presentation = "standalone", assemblyPanel, checkResultsPanel, assemblyTargetPrefix, runtimeRoutes }: PublisherInstancesViewProps) {
  const id = useId();
  const { rows, packs } = useMemo(() => {
    const occurrences = new Map<string, number>();
    const rows = instances.map((binding, index) => {
      const occurrence = occurrences.get(binding.instanceId) ?? 0;
      occurrences.set(binding.instanceId, occurrence + 1);
      return { binding, index, key: JSON.stringify([binding.instanceId, occurrence]), checked: checkInstance(binding, library, registries, compiler) };
    });
    const packs = [...new Set(instances.flatMap(binding => binding.packIds))].map(packId => {
      const members = rows.filter(row => row.binding.packIds.includes(packId));
      return { packId, members, checked: checkInstancePack(members.map(row => row.binding), library, registries, compiler) };
    });
    return { rows, packs };
  }, [instances, library, registries, compiler]);
  const [selection, setSelection] = useState<string>();
  const selected = rows.find(row => row.key === selection) ?? rows[0];
  const [width, setWidth] = useState<320 | 768 | 1280>(768);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [chosenState, setChosenState] = useState<string>();
  const state = chosenState && selected?.binding.states?.includes(chosenState) ? chosenState : undefined;
  const [focusTarget, setFocusTarget] = useState<string>();
  useEffect(() => {
    if (!focusTarget) return;
    const target = document.getElementById(focusTarget);
    target?.focus(); target?.scrollIntoView?.({ block: "nearest" });
    setFocusTarget(undefined);
  }, [focusTarget, selected?.key]);
  const ungrouped = rows.filter(row => !row.binding.packIds.length);
  let contract: EffectivePageLayoutContract | undefined;
  try {
    const leaf = registries.layouts.find(leaf => leaf.id === selected?.binding.layout.leaf);
    if (leaf && selected) contract = getEffectiveLayoutContract(leaf, selected.binding.layout.config, selected.binding.layout.members);
  } catch { /* The checker retains the actual refusal. */ }
  const binding = selected?.binding;
  const anchor = (index: number, path: string) => `${id}-row-${index}-${encodeURIComponent(path)}`;
  const paths = new Set(["instance", "instanceId", "format", "frame", "layout", "layout.config", "layout.members", "layout.renderer", "layout.leadGround", "frame.groundRead", "frame.slotFills", "frame.content", "fills", "states", "outline"]);
  const slotIds = [...(contract?.slots.map(slot => slot.id) ?? []), ...Object.keys(binding?.fills ?? {}).filter(slot => !contract?.slots.some(item => item.id === slot))];
  const sectionEntries = binding ? [
    ...slotIds.flatMap(slot => (binding.fills[slot] ?? []).map((fill, i) => ({ path: `fills.${slot}.${i}`, fill }))),
    ...Object.entries(binding.frame.slotFills ?? {}).map(([slot, fill]) => ({ path: `frame.slotFills.${slot}`, fill })),
  ] : [];
  for (const name of Object.keys(binding?.frame.content ?? {})) paths.add(`frame.content.${name}`);
  for (const slot of slotIds) { paths.add(`fills.${slot}`); paths.add(`layout.slots.${slot}`); }
  for (const { path, fill } of sectionEntries) {
    paths.add(path); paths.add(`${path}.span`); paths.add(`${path}.content`);
    for (const name of new Set([...Object.keys(fill.content), ...(registries.sections.find(leaf => leaf.id === fill.section)?.contract.slots.map(slot => slot.name) ?? [])])) paths.add(`${path}.content.${name}`);
  }
  const targetPath = (path: string, rowIndex: number) => {
    const destination = rows[rowIndex]?.binding;
    const targets = rowIndex === selected?.index ? paths : new Set(["instance", "instanceId", "format", "frame", "layout", "layout.config", "layout.members", "layout.renderer", "layout.leadGround", "frame.groundRead", "frame.slotFills", "frame.content", "fills", "states", "outline"]);
    if (destination && rowIndex !== selected?.index) {
      for (const name of Object.keys(destination.frame.content ?? {})) targets.add(`frame.content.${name}`);
      const entries = [...Object.entries(destination.fills).flatMap(([slot, fills]) => {
        targets.add(`fills.${slot}`); targets.add(`layout.slots.${slot}`);
        return fills.map((fill, index) => ({ path: `fills.${slot}.${index}`, fill }));
      }), ...Object.entries(destination.frame.slotFills ?? {}).map(([slot, fill]) => ({ path: `frame.slotFills.${slot}`, fill }))];
      for (const { path: prefix, fill } of entries) {
        targets.add(prefix); targets.add(`${prefix}.span`); targets.add(`${prefix}.content`);
        for (const name of new Set([...Object.keys(fill.content), ...(registries.sections.find(leaf => leaf.id === fill.section)?.contract.slots.map(slot => slot.name) ?? [])])) targets.add(`${prefix}.content.${name}`);
      }
    }
    let value = path;
    while (!targets.has(value) && value.includes(".")) value = value.slice(0, value.lastIndexOf("."));
    return targets.has(value) ? value : "instance";
  };
  const findingLink = (finding: InstanceFinding, rowIndex: number, label?: string) => {
    // Other rows have their own inspector after selection; their exact path is retained.
    const path = targetPath(finding.path, rowIndex);
    const href = anchor(rowIndex, path);
    return <Link href={`#${href}`} onClick={event => {
      event.preventDefault(); setSelection(rows[rowIndex]!.key); setFocusTarget(href);
    }}>{label ? `${label} · ` : ""}{finding.code} · {finding.path}: {finding.message}</Link>;
  };
  const renderFill = (fill: SectionFill, path: string, position: number) => <li key={path} id={anchor(selected!.index, path)} tabIndex={-1} className="grid gap-xs break-words">
    <p>{position}. {fill.section} · config: {fill.config ?? "not supplied"}</p>
    <p id={anchor(selected!.index, `${path}.span`)} tabIndex={-1}>Span: {fill.span ?? "not supplied"}</p>
  </li>;
  const renderList = (members: typeof rows) => <>{(["site", "app"] as const).filter(surface => members.some(row => row.binding.surface === surface)).map(surface => <section key={surface} aria-label={`${surface} instances`} className="grid gap-sm">
    <SectionHeader level={5} title={<>{surface}</>} /><ul className="grid gap-sm">{members.filter(row => row.binding.surface === surface).map(row => <li key={row.key}>
      <Button variant="ghost" type="button" aria-current={selected?.key === row.key ? "true" : undefined} onPress={() => setSelection(row.key)}
        className="grid w-full gap-xs text-left break-words">
        <strong>{row.binding.label}</strong><span>{row.binding.path ?? "No route path"}</span><span>{row.binding.frame.leaf}</span>
        <span>{row.binding.layout.leaf} · {row.binding.layout.config || "config missing"}</span><span>{status(row.checked.findings.length)}</span>
      </Button>
    </li>)}</ul>
  </section>)}</>;
  return <section aria-labelledby={`${id}-title`} className="grid min-w-0 gap-lg text-ink-primary">
    <SectionHeader id={`${id}-title`} title={presentation === "item" ? "Item inspector" : "Instances"} description={<>Library: {library.id} · read-only<br />Frames and Sections render only through the registered-route runtime; responsive render checks LK12 pending.</>} />
    <div className={presentation === "item" ? "grid min-w-0 gap-lg desktop:grid-cols-2" : "grid min-w-0 gap-lg desktop:grid-cols-[var(--ui-layout-sidebar-w)_minmax(0,1fr)_var(--ui-layout-aside-w)]"}>
      {presentation === "standalone" && <Panel><nav aria-label="Instances by pack and surface" className="grid content-start gap-lg">
        {packs.map(pack => <section key={pack.packId} aria-label={packLabels?.[pack.packId] ?? pack.packId} className="grid gap-md">
          <SectionHeader level={4} title={<>{packLabels?.[pack.packId] ?? pack.packId} · {pack.members.length}</>} />{renderList(pack.members)}
        </section>)}
        {!!ungrouped.length && <section aria-label="No pack"><SectionHeader level={4} title={<>No pack</>} />{renderList(ungrouped)}</section>}
        {!rows.length && <p>No instance bindings supplied.</p>}
      </nav></Panel>}
      {binding && selected ? <>
        <div className="grid min-w-0 content-start gap-lg">
          {assemblyPanel}
        <Panel><section id={assemblyTargetPrefix ? `${assemblyTargetPrefix}-render` : undefined} tabIndex={assemblyTargetPrefix ? -1 : undefined} aria-labelledby={`${id}-preview-title`} className="grid content-start gap-md">
          <SectionHeader level={3} id={`${id}-preview-title`} title={<>{binding.label} · runtime render</>} />
          <div className="flex flex-wrap gap-md">
            <Select label="Viewport" selectedKey={String(width)} onSelectionChange={key => { if (key != null) setWidth(Number(key) as typeof width); }} options={[320, 768, 1280].map(value => ({ id: String(value), label: `${value} px` }))} />
            <Select label="Theme" selectedKey={theme} onSelectionChange={key => { if (key != null) setTheme(String(key) as typeof theme); }} options={[{ id: "light", label: "light" }, { id: "dark", label: "dark" }]} />
            <Select label="State" selectedKey={state ?? ""} onSelectionChange={key => setChosenState(key ? String(key) : undefined)} options={[{ id: "", label: "default" }, ...(binding.states?.filter(value => value !== "default").map(value => ({ id: value, label: value })) ?? [])]} />
          </div>
          <Card variant="outline" role="region" aria-label="Scrollable instance render" tabIndex={0} className="min-w-0 overflow-x-auto">
            <InstanceRuntimeRender binding={binding} routes={runtimeRoutes} width={width} theme={theme} state={state} />
          </Card>
        </section></Panel>
        </div>
        <Panel><aside id={assemblyTargetPrefix ? `${assemblyTargetPrefix}-inspector` : undefined} tabIndex={assemblyTargetPrefix ? -1 : undefined} aria-label="Instance inspector" className="grid content-start gap-lg">
          <div id={anchor(selected!.index, "instance")} tabIndex={-1}><SectionHeader level={3} title={<>{binding.label} inspector</>} /><p id={anchor(selected!.index, "instanceId")} tabIndex={-1}>{binding.instanceId}</p><p>{binding.path ?? "No route path"}</p></div>
          <section id={anchor(selected!.index, "format")} tabIndex={-1}><SectionHeader level={4} title={<>Format</>} /><p>{binding.format}</p></section>
          <section id={anchor(selected!.index, "frame")} tabIndex={-1}><SectionHeader level={4} title={<>Frame</>} /><p>{binding.frame.leaf}</p><p>Config: {binding.frame.config ?? "not supplied"}</p><p id={anchor(selected!.index, "frame.groundRead")} tabIndex={-1}>Ground input checked by LK9</p></section>
          <section id={anchor(selected!.index, "layout")} tabIndex={-1} className="grid gap-sm"><SectionHeader level={4} title={<>Layout</>} /><p>{binding.layout.leaf}</p><p id={anchor(selected!.index, "layout.config")} tabIndex={-1}>Config: {binding.layout.config || "not supplied"}</p>
            <div id={anchor(selected!.index, "layout.members")} tabIndex={-1}><SectionHeader level={5} title={<>Members</>} /><DetailView fields={Object.entries(contract?.memberValues ?? binding.layout.members ?? {}).map(([key, value]) => ({ label: key, value: String(value) }))} /></div>
            <p id={anchor(selected!.index, "layout.renderer")} tabIndex={-1}>Renderer source checked by LK11</p><p id={anchor(selected!.index, "layout.leadGround")} tabIndex={-1}>Lead ground checked by LK9</p>
          </section>
          <section aria-label="Ordered slot fills" id={anchor(selected!.index, "fills")} tabIndex={-1} className="grid gap-md"><SectionHeader level={4} title={<>Slot fills</>} />
            {slotIds.map(slot => <div key={slot} id={anchor(selected!.index, `fills.${slot}`)} tabIndex={-1}><SectionHeader level={5} id={anchor(selected!.index, `layout.slots.${slot}`)} tabIndex={-1} title={<>{slot}</>} />
              {(binding.fills[slot] ?? []).length ? <ol>{binding.fills[slot]!.map((fill, i) => renderFill(fill, `fills.${slot}.${i}`, i + 1))}</ol> : <p>No fill supplied</p>}
            </div>)}
            <div id={anchor(selected!.index, "frame.slotFills")} tabIndex={-1}><SectionHeader level={5} title={<>Frame optional slots</>} />{(["context", "consent"] as const).map(slot => <div key={slot}><p>{slot}</p>{binding.frame.slotFills?.[slot] ? <ol>{renderFill(binding.frame.slotFills[slot], `frame.slotFills.${slot}`, 1)}</ol> : <p>No fill supplied</p>}</div>)}</div>
            <Link href={designerHref}>Adopt in Designer</Link><p>Fill selection is read-only.</p>
          </section>
          <section aria-label="Content refs" className="grid gap-md"><SectionHeader level={4} title={<>Content refs</>} />
            <div role="group" aria-label="Frame host content references" id={anchor(selected!.index, "frame.content")} tabIndex={-1}>
              <SectionHeader level={5} title={<>frame.content · {binding.frame.leaf}</>} />
              <p>Frame host content required-slot, value and hash verification pending.</p>
              {!Object.keys(binding.frame.content ?? {}).length && <p>No frame host content references supplied.</p>}
              {Object.entries(binding.frame.content ?? {}).map(([name, reference]) => {
                let resolved = false;
                try {
                  const found = library.resolveContent(reference);
                  resolved = found?.kind === reference.kind && found.ref === reference.ref;
                } catch { /* Reference lookup cannot prove runtime content values or hashes. */ }
                return <p key={name} id={anchor(selected!.index, `frame.content.${name}`)} tabIndex={-1}>{name}: {reference.kind} · {reference.ref} · {resolved ? "reference resolved" : "missing resolution"}</p>;
              })}
            </div>
            {sectionEntries.map(({ path, fill }) => {
            const declared = registries.sections.find(leaf => leaf.id === fill.section)?.contract.slots ?? [];
            const names = [...new Set([...declared.map(slot => slot.name), ...Object.keys(fill.content)])];
            return <div key={path} id={anchor(selected!.index, `${path}.content`)} tabIndex={-1}><SectionHeader level={5} title={<>{path} · {fill.section}</>} />{names.map(name => {
              const reference = fill.content[name];
              const slot = declared.find(slot => slot.name === name);
              let bound = false;
              if (reference && slot?.type === reference.kind) try {
                const resolved = library.resolveContent(reference);
                bound = resolved?.kind === reference.kind && resolved.ref === reference.ref;
              } catch { /* An unavailable content lookup cannot prove a binding. */ }
              return <p key={name} id={anchor(selected!.index, `${path}.content.${name}`)} tabIndex={-1}>{name}{slot?.required ? " (required)" : ""}: {reference ? `${reference.kind} · ${reference.ref} · ${bound ? "bound" : "missing resolution"}` : "missing ref"}</p>;
            })}</div>;
          })}</section>
          <p id={anchor(selected!.index, "states")} tabIndex={-1}>Declared states: {binding.states?.join(", ") || "none"}</p><p id={anchor(selected!.index, "outline")} tabIndex={-1}>Outline is checked statically; rendered headings are not measured here.</p>
        </aside></Panel>
      </> : null}
    </div>
    {checkResultsPanel ?? <Panel><section id={assemblyTargetPrefix ? `${assemblyTargetPrefix}-checks` : undefined} tabIndex={assemblyTargetPrefix ? -1 : undefined} aria-label="Instance checks" className="grid gap-md"><SectionHeader level={3} title={<>Checks · LK1–LK16</>} />
      {selected && <p>{selected.binding.label}: {status(selected.checked.findings.length)}</p>}
      {groups.map(([name, codes]) => <section key={name} aria-label={`${name} checks`} className="grid gap-sm"><SectionHeader level={4} title={<>{name} · {codes.join(", ")}</>} />
        {selected && <ul>{selected.checked.findings.filter(finding => (codes as readonly string[]).includes(finding.code)).map((finding, index) => <li key={index}>{findingLink(finding, selected.index)}</li>)}</ul>}
        {name === "Responsive" && <p>LK12 pending · rendered responsive evidence is not measured here.</p>}
        {presentation === "standalone" && packs.map(pack => <div key={pack.packId}><SectionHeader level={5} title={<>{packLabels?.[pack.packId] ?? pack.packId} · pack closure</>} /><p>{status(pack.checked.findings.length)}</p><ul>{pack.checked.findings.filter(finding => (codes as readonly string[]).includes(finding.code)).map((finding, index) => {
          const match = /^instances\.(\d+)(?:\.(.*))?$/.exec(finding.path);
          const row = match ? pack.members[Number(match[1])] : undefined;
          const local = { ...finding, path: match?.[2] ?? "instance" };
          return <li key={index}>{row ? findingLink(local, row.index, `${row.binding.label} [row ${row.index + 1}]`) : `${finding.code} · ${finding.message}`}</li>;
        })}</ul></div>)}
      </section>)}
    </section></Panel>}
  </section>;
}
