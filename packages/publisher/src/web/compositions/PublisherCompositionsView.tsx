"use client";
import { LinkButton as Link } from "@clossys/designer/components";
import { Button, CARD_SURFACE, Card } from "@clossys/designer/components";

import { DetailView, Panel, SectionHeader, StockSelect } from "@clossys/designer/blocks";
import { useId, useState } from "react";
import type { ConsumerInstanceLibrary, FlowInstanceBinding as InstanceBinding } from "../../core/instance-binding.js";
import { getEffectiveLayoutContract, getLayoutEngine, LAYOUT_ENGINES } from "../../engines/index.js";
import type { EngineKey } from "../../engines/index.js";
import { BADGE_TONE, Badge } from "@clossys/designer/components/server";
import { CompositionSkeletonFrame } from "./SkeletonFrame.js";
import type { BreakpointValues } from "../../core/flow-stage.js";

/** Observations belong to this library; the view never discovers consumer state. */
export interface CompositionsConsumerLibrary extends Pick<ConsumerInstanceLibrary, "id" | "role" | "resolveFill"> {
  readonly instances: readonly Pick<InstanceBinding, "instanceId" | "layout">[];
}

export interface PublisherCompositionsViewProps {
  readonly library: CompositionsConsumerLibrary;
  /** Resolved breakpoint tokens, supplied by the host even for contract previews. */
  readonly breakpointValues: BreakpointValues;
  readonly designerHref: string;
  /** Restrict both navigation and config selection to a format's allowed compositions. */
  readonly allowedLayoutIds?: readonly EngineKey[];
}

const activeLayouts = LAYOUT_ENGINES.filter(leaf => leaf.status !== "held" && leaf.status !== "deprecated");

/** Read-only composition catalogue. Foundry offers are never runtime fill fallbacks. */
export function PublisherCompositionsView({ library, breakpointValues, designerHref, allowedLayoutIds }: PublisherCompositionsViewProps) {
  const id = useId();
  const [chosen, setSelection] = useState({ leaf: "stack" as EngineKey, config: "stack.landing" });
  const offered = activeLayouts.filter(leaf => allowedLayoutIds === undefined || allowedLayoutIds.includes(leaf.engine));
  const chosenLeaf = offered.find(leaf => leaf.engine === chosen.leaf && leaf.contract.configs.some(config => config.id === chosen.config));
  const leaf = chosenLeaf ?? offered[0];
  const selection = chosenLeaf ? chosen : leaf && { leaf: leaf.engine, config: leaf.contract.configs[0]!.id };
  if (!leaf || !selection) return <section aria-labelledby={`${id}-title`} className="grid gap-sm">
    <SectionHeader id={`${id}-title`} title="Compositions" /><p>No allowed compositions are available for this format.</p>
  </section>;
  const contract = getEffectiveLayoutContract(leaf, selection.config);
  const fill = library.role === "consumer" ? library.resolveFill(leaf.engine, selection.config) : undefined;
  const adopted = fill?.library === library.id && fill.leaf === leaf.engine && (fill.config === undefined || fill.config === selection.config);
  const uses = new Set(library.instances.filter(instance => instance.layout.leaf === leaf.engine && instance.layout.config === selection.config).map(instance => instance.instanceId)).size;
  const chooseLeaf = (next: EngineKey) => {
    const target = getLayoutEngine(next);
    const config = target?.contract.configs[0];
    if (target && config && offered.some(leaf => leaf.engine === next)) setSelection({ leaf: next, config: config.id });
  };

  return <section aria-labelledby={`${id}-title`} className="min-w-0 grid gap-lg text-ink-primary">
    <div className="grid gap-sm">
      <SectionHeader id={`${id}-title`} title="Compositions" />
      <p>Library: {library.id}</p>
      <p>Read-only layout contracts. Previews contain slot placeholders only.</p>
    </div>
    <div className="grid min-w-0 gap-lg desktop:grid-cols-[var(--ui-layout-sidebar-w)_minmax(0,1fr)_var(--ui-layout-aside-w)]">
      <Card className={CARD_SURFACE.outline}><nav aria-label="Composition arrangements">
        <ul aria-label="Page layouts" className="grid gap-sm">
          {LAYOUT_ENGINES.filter(item => allowedLayoutIds === undefined || offered.some(leaf => leaf.engine === item.engine)).map(item => {
            const held = item.status === "held" || item.status === "deprecated";
            return <li key={item.engine}><Button variant="secondary" type="button" isDisabled={held} aria-current={selection.leaf === item.engine ? "true" : undefined}
              onPress={() => chooseLeaf(item.engine)}>{item.engine}{held ? ` · ${item.status}` : ""}</Button></li>;
          })}
        </ul>
      </nav></Card>
      <Panel><section aria-labelledby={`${id}-preview`} className="grid content-start gap-lg">
        <SectionHeader id={`${id}-preview`} level={3} title={`Skeleton preview · ${selection.config}`} />
        <p>Contract preview · no consumer sections rendered</p>
        {([320, 1280] as const).flatMap(width => (["light", "dark"] as const).map(theme => <figure key={`${width}-${theme}`} className="min-w-0 grid gap-sm">
          <figcaption>{width} px · {theme}</figcaption>
          <Card role="region" aria-label={`${width} px ${theme} skeleton`} tabIndex={0} className={`${CARD_SURFACE.outline} min-w-0 overflow-x-auto`}>
            <CompositionSkeletonFrame leaf={leaf.engine} config={selection.config} width={width} theme={theme} breakpointValues={breakpointValues} />
          </Card>
        </figure>))}
      </section></Panel>
      <Panel><aside aria-labelledby={`${id}-contract`} className="grid content-start gap-lg">
        <SectionHeader id={`${id}-contract`} level={3} title={`${leaf.engine} contract`} />
        <div className="flex flex-wrap gap-sm" aria-label="Composition evidence">
          <Badge {...BADGE_TONE.neutral}>{leaf.status}</Badge><Badge {...BADGE_TONE.neutral}>Foundry offer</Badge>
          <Badge {...BADGE_TONE.neutral}>{adopted ? `adopted into ${library.id}` : "not adopted"}</Badge>
          <Badge {...BADGE_TONE.neutral}>used by {uses} {uses === 1 ? "instance" : "instances"} · selected config</Badge>
        </div>
        {!adopted && <p>No consumer fill for this config. <Link variant="link" href={designerHref}>Adopt in Designer</Link></p>}
        <StockSelect label="Config" selectedKey={selection.config} onSelectionChange={key => {
          const value = String(key ?? "");
          const owner = offered.find(item => item.contract.configs.some(config => config.id === value));
          if (owner) setSelection({ leaf: owner.engine, config: value });
        }} options={offered.flatMap(item => item.contract.configs.map(config => ({ id: config.id, label: `${item.engine} · ${config.id}` })))} />
        <section aria-labelledby={`${id}-slots`} className="grid gap-sm">
          <SectionHeader id={`${id}-slots`} level={4} title="Slots" />
          {contract.slots.map(slot => <div key={slot.id} className="min-w-0 grid gap-xs break-words">
            <SectionHeader level={5} title={slot.id} /><p>{slot.min}..{slot.max} · {slot.position} · {slot.previewShape}</p>
            <p>Accepts: {slot.accepts.join(", ")}</p>
            {slot.tile && <p>Spans: {slot.tile.spans.join(" | ")}</p>}
          </div>)}
        </section>
        <section aria-labelledby={`${id}-members`}>
          <SectionHeader id={`${id}-members`} level={4} title="Closed members" />
          <DetailView fields={Object.entries(contract.members).map(([name, values]) => ({ label: name, value: <>{values.join(" | ")}{contract.memberValues[name] !== undefined && <strong> · {contract.memberValues[name]}</strong>}</> }))} />
        </section>
        <section aria-labelledby={`${id}-reflow`}>
          <SectionHeader id={`${id}-reflow`} level={4} title="Reflow" />
          <p>One column below the first step. DOM order is reading order.</p>
          {contract.reflow.length ? <ul>{contract.reflow.map(step => <li key={step.at}>{step.at}: {step.columns} columns{step.spans ? ` · spans ${step.spans}` : ""}</li>)}</ul> : <p>One column at every width.</p>}
        </section>
      </aside></Panel>
    </div>
  </section>;
}
