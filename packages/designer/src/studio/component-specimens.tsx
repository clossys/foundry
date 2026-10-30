"use client";
import { Component as ReactComponent, createElement, useCallback, useContext, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import type { CompositeResolved } from "../catalog-core/index.js";
import { bindComponentSpecimen, type ComponentSpecimenModule, type ComponentSpecimenComponent, type ComponentSpecimenBinding, type ComponentSpecimenRefusal } from "./component-specimen-binding.js";
export type { ComponentSpecimenModule, ComponentSpecimenComponent, ComponentSpecimenMember, ComponentSpecimenBinding, ComponentSpecimenRefusalCode, ComponentSpecimenRefusal } from "./component-specimen-binding.js";
import { componentSpecimenSample, componentSpecimenStateProps, componentSpecimenUnavailableReason, type ComponentSpecimenProbeState, type ComponentSpecimenSample } from "./component-specimen-samples.js";
import { PreviewOutcomeContext, type SpecimenUnavailableReason } from "./preview-outcome.js";

/** Host-authored specimen content for one leaf, drawn with the bound implementation. */
export type ComponentSpecimenRender = (binding: ComponentSpecimenBinding) => ReactNode;

export interface ComponentSpecimenOptions {
  /** Draw the rest-state specimen alone on the canvas; detailed probes retain all variants by default. */
  readonly restOnly?: boolean;
  /**
   * The adopted library's modules, keyed by the exact specifier each chosen descriptor names: a package
   * module (`impl.module`, and `<package>/<subpath>` for a propMap pointer such as `./charts#BarChart`)
   * or a library source entry (`impl.entry`). Nothing is imported or inferred; a missing key refuses.
   */
  readonly modules: Readonly<Record<string, ComponentSpecimenModule>>;
  /**
   * Specimen content by leaf; an entry replaces everything below. A leaf without one renders the implementation
   * export once, labelled with the leaf, then once per drawn member, labelled with its member key. A data-driven
   * Foundry component (charts, table, tree, field, ...) draws with designer-provided neutral sample content
   * instead of the label; another library's data-driven component needs an entry here. Where designer samples
   * apply (Foundry package exports, vendored shadcn@aria source), a row without one reads unavailable
   * (`needs-sample-content`) instead of drawing its label.
   */
  readonly specimens?: Readonly<Record<string, ComponentSpecimenRender>>;
  /** Wraps every specimen, e.g. the library's emitted `LibraryProvider`. */
  readonly provider?: ComponentType<{ readonly children?: ReactNode }>;
  /**
   * Probe settings by leaf, so a measurer sets a specimen's state and content through the real component's props
   * instead of mutating the drawn DOM. Applies to the default specimens; a host `specimens` entry draws as authored.
   */
  readonly probes?: Readonly<Record<string, ComponentSpecimenProbe>>;
}

/**
 * One leaf's probe. `states` are forced through the component's own props (`disabled` is `isDisabled`); a state the
 * component has no prop for is listed on the specimen set's `data-specimen-probe-unsupported` and never faked.
 * `props` and `children` set the sample content, applied after the dataset sample and the state props.
 */
export interface ComponentSpecimenProbe {
  readonly states?: readonly ComponentSpecimenProbeState[];
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children?: ReactNode;
}

export interface ComponentSpecimenPreview {
  /** Pass as `CompositeStudioSnapshot.preview`, or call first from the host's own preview. Undefined for a refusal. */
  readonly preview: (leaf: string, profile: CompositeResolved) => ReactNode | undefined;
  /** The binding a specimen would draw, or the named reason there is none. */
  readonly bind: (leaf: string, profile: CompositeResolved) => { readonly binding: ComponentSpecimenBinding } | { readonly refusal: ComponentSpecimenRefusal };
}

/** A specimen that throws while rendering keeps its cell, marked for the capture harness, instead of unmounting Studio. */
class SpecimenBoundary extends ReactComponent<{ readonly name: string; readonly onFail: (name: string) => void; readonly children?: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(_error: unknown, _info: ErrorInfo): void { this.props.onFail(this.props.name); }
  override render(): ReactNode { return this.state.failed ? <span hidden data-specimen-error={this.props.name} /> : this.props.children; }
}

/**
 * The specimens of one leaf. Once every one it tries has thrown (or the provider around them has), it reports
 * `specimen-error` to the leaf cell, which then reads unavailable with that reason instead of live. When it
 * tries none, because sample data cannot draw any of them, it reports their named reason.
 */
function SpecimenSet({ total, unavailable, children }: { readonly total: number; readonly unavailable?: SpecimenUnavailableReason; readonly children: (onFail: (name: string) => void, onProviderFail: () => void) => ReactNode }) {
  const report = useContext(PreviewOutcomeContext);
  const [failed, setFailed] = useState<{ readonly names: ReadonlySet<string>; readonly provider: boolean }>(() => ({ names: new Set(), provider: false }));
  const onFail = useCallback((name: string) => setFailed(previous => previous.names.has(name) ? previous : { ...previous, names: new Set(previous.names).add(name) }), []);
  const onProviderFail = useCallback(() => setFailed(previous => previous.provider ? previous : { ...previous, provider: true }), []);
  const reason = failed.provider || (total > 0 && failed.names.size >= total) ? "specimen-error" : total === 0 ? unavailable ?? "specimen-error" : undefined;
  useEffect(() => { report?.(reason); }, [report, reason]);
  useEffect(() => () => report?.(undefined), [report]);
  return children(onFail, onProviderFail);
}

type SpecimenRow = { readonly member: string; readonly Component: ComponentSpecimenComponent; readonly props: Readonly<Record<string, unknown>>; readonly specifier: string; readonly exportName: string };
const specimenRows = (binding: ComponentSpecimenBinding, restOnly = false): SpecimenRow[] =>
  [{ member: binding.leaf, Component: binding.Component, props: {}, specifier: binding.specifier, exportName: binding.exportName }, ...(restOnly ? [] : binding.members.filter(member => member.drawn))];

/**
 * A sample describes the base export; a member bound to another export keeps its label. A row whose export
 * sample data cannot draw (`unavailableOf`) is marked with the reason and never rendered.
 */
type ProbeApplied = { readonly props: Readonly<Record<string, unknown>>; readonly children?: ReactNode };
function defaultSpecimen(binding: ComponentSpecimenBinding, sample: ComponentSpecimenSample | undefined, unavailableOf: (row: SpecimenRow) => SpecimenUnavailableReason | undefined, onFail: (name: string) => void, probe: ProbeApplied, restOnly = false): ReactNode {
  const content = probe.children === undefined ? {} : { children: probe.children };
  return specimenRows(binding, restOnly).map(row => { const unavailable = unavailableOf(row); return <div key={row.member} data-component-specimen={row.member}>
    {unavailable ? <span hidden data-specimen-unavailable={unavailable} /> : <SpecimenBoundary name={row.member} onFail={onFail}>{sample && row.Component === binding.Component
      ? (sample.host ?? (node => node))(createElement(row.Component, { ...sample.props, children: sample.children, ...row.props, ...probe.props, ...content }))
      : createElement(row.Component, { children: row.member, ...row.props, ...probe.props, ...content })}</SpecimenBoundary>}
  </div>; });
}

/** RAC roots whose children are a collection, or (the composed date pickers) a render function: never handed the leaf label. */
const STRUCTURED_CHILDREN = new Set(["Table", "GridList", "ListBox", "Menu", "Tree", "Breadcrumbs", "DatePicker", "DateRangePicker"]);
const structuredChildren = (root: string | undefined) => root?.startsWith("rac:") === true && root.slice(4).split("+").some(name => STRUCTURED_CHILDREN.has(name));

/** `@scope/name/charts` is `./charts`; a sample key is the export address a Foundry fill pins (`./charts#BarChart`). */
const sampleKey = (specifier: string, exportName: string) => {
  const parts = specifier.split("/");
  return `./${parts.slice(specifier.startsWith("@") ? 2 : 1).join("/")}#${exportName}`;
};

/**
 * Live component specimens for Studio, bound from the host's adopted library. Each chosen component leaf
 * resolves to the implementation export its descriptor names and every mapped member's dispatch, the same
 * rule the emitted component index follows. A leaf that cannot bind stays unavailable with a named refusal;
 * nothing falls back to another library or to a placeholder.
 */
export function componentSpecimenPreview(options: ComponentSpecimenOptions): ComponentSpecimenPreview {
  const bind: ComponentSpecimenPreview["bind"] = (leaf, profile) => bindComponentSpecimen(options.modules, leaf, profile);
  return { bind, preview(leaf, profile) {
    const bound = bind(leaf, profile);
    if ("refusal" in bound) return undefined;
    const { binding } = bound;
    const render = options.specimens && Object.hasOwn(options.specimens, leaf) ? options.specimens[leaf] : undefined;
    const component = profile.components.components[leaf]!;
    // Designer samples (and the reasons sample data cannot draw an export) cover Foundry's own package exports and
    // the vendored shadcn@aria and shadcn-charts source, keyed by its `impl.entry#export`. The binding names the library a component
    // came from; resolve() stamps the adopter's id on descriptor.source. A composed leaf is Foundry's rule source.
    const samples = !render && (binding.source === "foundry" && component.impl.kind === "package" || (binding.source === "shadcn@aria" || binding.source === "shadcn-charts" || component.origin.kind === "composed") && component.impl.kind === "source");
    const keyOf = (specifier: string, exportName: string) => component.impl.kind === "package" ? sampleKey(specifier, exportName) : `${specifier}#${exportName}`;
    const sample = samples ? componentSpecimenSample(keyOf(binding.specifier, binding.exportName), binding.Component, binding.exports) : undefined;
    // A row that would get the leaf label as children it cannot take is declared unavailable instead of thrown.
    const structured = structuredChildren(component.descriptor.root);
    // Where designer samples apply, a row with no sample is declared unavailable: it never falls back to its label.
    const unavailableOf = (row: SpecimenRow) => (samples ? componentSpecimenUnavailableReason(keyOf(row.specifier, row.exportName)) : undefined)
      ?? ((samples || structured) && !(sample && row.Component === binding.Component) ? "needs-sample-content" : undefined);
    const rows = render ? [] : specimenRows(binding, options.restOnly);
    const unavailable = rows.map(unavailableOf).filter(reason => reason !== undefined);
    const total = render ? 1 : rows.length - unavailable.length;
    const Provider = options.provider;
    const probe = !render && options.probes && Object.hasOwn(options.probes, leaf) ? options.probes[leaf] : undefined;
    const stateKey = keyOf(binding.specifier, binding.exportName);
    const forced = (probe?.states ?? []).map(state => ({ state, props: componentSpecimenStateProps(stateKey, state) }));
    const applied: ProbeApplied = { props: Object.assign({}, ...forced.map(entry => entry.props ?? {}), probe?.props), children: probe?.children };
    const probeAttributes = probe ? { "data-specimen-probe-states": forced.filter(entry => entry.props).map(entry => entry.state).join(" "), "data-specimen-probe-unsupported": forced.filter(entry => !entry.props).map(entry => entry.state).join(" ") } : {};
    // A new selection or library remounts the set, so an earlier failure never outlives the specimens it described.
    return <div data-component-specimens={leaf} data-specimen-source={binding.source} className="flex flex-wrap items-center gap-md" {...probeAttributes}>
      <SpecimenSet key={`${profile.selectionHash}:${binding.specifier}#${binding.exportName}`} total={total} unavailable={unavailable[0]}>{(onFail, onProviderFail) => {
        const content = render ? <SpecimenBoundary name={leaf} onFail={onFail}>{render(binding)}</SpecimenBoundary> : defaultSpecimen(binding, sample, unavailableOf, onFail, applied, options.restOnly);
        return Provider ? <SpecimenBoundary name={leaf} onFail={onProviderFail}><Provider>{content}</Provider></SpecimenBoundary> : content;
      }}</SpecimenSet>
    </div>;
  } };
}
