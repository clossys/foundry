"use client";
import { Button, Checkbox, ComboBox, Select } from "@clossys/designer/components";
import { useState, type Dispatch, type SetStateAction } from "react";
import { DetailView, FieldGroup, Form, SectionHeader } from "@clossys/designer/blocks";
import type { PublisherConfiguration, PublisherMediaSettings } from "../../planning/configuration.js";
import type { FormatLeaf, PublisherDeliveryChoice } from "../../formats/contract.js";
import type { InstanceRegistries } from "../../core/instance-binding.js";
import type { ProductionSettings, PublisherInputRequest } from "./production-settings.js";
import type { PublisherValueNames } from "./value-names.js";

export interface InputQuestionsProps {
  readonly valueNames?: PublisherValueNames;
  readonly requests: readonly PublisherInputRequest[];
  /** @default "Blocking input questions" */
  readonly label?: string;
  /** @default "needs input" */
  readonly needsInputLabel?: string;
}
export function InputQuestions({ requests, label = "Blocking input questions", needsInputLabel = "needs input", valueNames }: InputQuestionsProps) {
  return requests.length ? <ul aria-label={label} className="grid gap-xs">{requests.map((request, index) => <li key={`${request.slot}-${index}`}><strong>{needsInputLabel}{valueNames?.("publisher.setupQuestion", request.slot) ? ` · ${valueNames("publisher.setupQuestion", request.slot)}` : ""}</strong><span className="block">{request.question}</span></li>)}</ul> : null;
}

export interface ProductionSettingsFormMessages {
  /** Host-resolved names for exact machine values; unresolved values keep the field label. */
  readonly valueNames?: PublisherValueNames;
  readonly label: string;
  readonly heading: string;
  readonly configuredLabel: string;
  readonly toDoLabel: string;
  readonly description: string;
  readonly formatLabel: string;
  readonly unregisteredLabel: string;
  readonly frameLabel: string;
  readonly unregisteredFrameLabel: string;
  readonly frameConfigLabel: string;
  readonly layoutLabel: string;
  readonly chooseLayoutLabel: string;
  readonly layoutConfigLabel: string;
  readonly builtDescription: string;
  readonly unverifiedDescription: string;
  readonly applyLabel: string;
  readonly resetLabel: string;
  readonly deliveryLabel: string;
  readonly fidelityLabel: string;
  readonly chooseFidelityLabel: string;
  readonly editableLabel: string;
  readonly flatLabel: string;
  readonly deploymentSurfaceLabel: string;
  readonly chooseSurfaceLabel: string;
  readonly mediaLabel: string;
  readonly recommendationLabel: string;
}

export interface ProductionSettingsFormProps {
  /** Override the documented English production-setting messages. */
  readonly messages?: Partial<ProductionSettingsFormMessages>;
  readonly initial: ProductionSettings;
  readonly configured: boolean;
  readonly registries?: InstanceRegistries;
  readonly onApply: (settings: ProductionSettings) => void;
  readonly onReset: () => void;
  readonly deploymentSurfaceIds?: readonly string[];
  readonly recommendationAnswerIds?: readonly string[];
  readonly resetTo?: ProductionSettings;
  /** Restrict draft choices to the formats compatible with the closed menu offer. */
  readonly formatIds?: readonly FormatLeaf["id"][];
}
/** One draft authority shared by the existing form and selected sections.form adapter. */
export function useProductionDraft(initial: ProductionSettings, resetTo?: ProductionSettings, onReset?: () => void) {
  const [draft, setDraft] = useState(initial);
  const reset = () => { setDraft(resetTo ?? initial); onReset?.(); };
  return { draft, setDraft, reset };
}
export interface ProductionSettingsFieldsProps extends Omit<ProductionSettingsFormProps, "initial" | "onApply" | "onReset" | "resetTo"> {
  readonly draft: ProductionSettings;
  readonly setDraft: Dispatch<SetStateAction<ProductionSettings>>;
  readonly onReset: () => void;
}
/** Prefilled values remain suggestions until the original host apply callback runs. */
export function ProductionSettingsForm(props: ProductionSettingsFormProps) {
  const state = useProductionDraft(props.initial, props.resetTo, props.onReset);
  return <Form aria-label={props.messages?.label ?? 'Production settings'} onSubmit={event => { event.preventDefault(); props.onApply(state.draft); }}>
    <ProductionSettingsFields {...props} draft={state.draft} setDraft={state.setDraft} onReset={state.reset} />
  </Form>;
}
/** Fields only: the selected Section owns the single form element and submission. */
export function ProductionSettingsFields({ draft, setDraft, configured, registries, onReset, messages, deploymentSurfaceIds, recommendationAnswerIds, formatIds }: ProductionSettingsFieldsProps) {
  /** @default 'Production settings' */
  const label = messages?.label ?? 'Production settings';
  /** @default 'Configure production settings' */
  const heading = messages?.heading ?? 'Configure production settings';
  /** @default 'Configured' */
  const configuredLabel = messages?.configuredLabel ?? 'Configured';
  /** @default 'to do' */
  const toDoLabel = messages?.toDoLabel ?? 'to do';
  /** @default '· Apply sets production choices. Later stages use the actual checks.' */
  const description = messages?.description ?? '· Apply sets production choices. Later stages use the actual checks.';
  /** @default 'Format' */
  const formatLabel = messages?.formatLabel ?? 'Format';
  /** @default '· unregistered' */
  const unregisteredLabel = messages?.unregisteredLabel ?? '· unregistered';
  /** @default 'Frame' */
  const frameLabel = messages?.frameLabel ?? 'Frame';
  /** @default '· not registered here' */
  const unregisteredFrameLabel = messages?.unregisteredFrameLabel ?? '· not registered here';
  /** @default 'Frame config' */
  const frameConfigLabel = messages?.frameConfigLabel ?? 'Frame config';
  /** @default 'Layout' */
  const layoutLabel = messages?.layoutLabel ?? 'Layout';
  /** @default 'Choose a layout' */
  const chooseLayoutLabel = messages?.chooseLayoutLabel ?? 'Choose a layout';
  /** @default 'Layout config' */
  const layoutConfigLabel = messages?.layoutConfigLabel ?? 'Layout config';
  /** @default 'Format registered as built; renderer and consumer adoption still require evidence.' */
  const builtDescription = messages?.builtDescription ?? 'Format registered as built; renderer and consumer adoption still require evidence.';
  /** @default 'Renderer availability is unverified for this format; configuration does not supply a renderer.' */
  const unverifiedDescription = messages?.unverifiedDescription ?? 'Renderer availability is unverified for this format; configuration does not supply a renderer.';
  /** @default 'Apply configuration' */
  const applyLabel = messages?.applyLabel ?? 'Apply configuration';
  /** @default 'Reset configuration' */
  const resetLabel = messages?.resetLabel ?? 'Reset configuration';

  /** @default 'Media settings' */
  const mediaLabel = messages?.mediaLabel ?? 'Media settings';
  /** @default 'Recommended because of answers:' */
  const recommendationLabel = messages?.recommendationLabel ?? 'Recommended because of answers:';
  const format = registries?.formats.find(format => format.id === draft.format);
  const frames = registries?.frames ?? [];
  const layouts = registries?.layouts ?? [];
  const frame = frames.find(frame => frame.id === draft.frame.leaf);
  const layout = layouts.find(layout => layout.id === draft.layout.leaf);
  /** @default "Configured" or "to do". */
  const statusLabel = configured ? configuredLabel : toDoLabel;
  /** @default Built-format or unverified-renderer evidence description. */
  const rendererDescription = format?.status === "built" ? builtDescription : unverifiedDescription;
  const names = messages?.valueNames;
  const selectedLayoutLabel = draft.layout.leaf ? valueName(names, "publisher.layout", draft.layout.leaf, layoutLabel) : chooseLayoutLabel;
  const namedStatus = (status: string) => names?.("admin.enum", status);
  const withStatus = (label: string, status: string) => { const text = namedStatus(status); return text ? `${label} · ${text}` : label; };
  return <>
    <SectionHeader level={3} title={heading} description={`${statusLabel} ${description}`} />
    {recommendationAnswerIds?.length ? <p>{recommendationLabel} {recommendationAnswerIds.map(id => names?.("publisher.answer", id)).filter(Boolean).join(", ")}</p> : null}
    <FieldGroup legend={label} layout="multi">
      <Select label={formatLabel} selectedKey={draft.format} onSelectionChange={key => { if (key != null) setDraft({ ...draft, format: String(key) as ProductionSettings["format"], deliveries: [], media: undefined, deploymentSurface: undefined }); }} options={[
        ...(!registries?.formats.some(format => format.id === draft.format) ? [{ id: draft.format, label: `${valueName(names, "publisher.format", draft.format, formatLabel)} ${unregisteredLabel}` }] : []),
        ...(registries?.formats.filter(format => !formatIds || formatIds.includes(format.id)).map(format => ({ id: format.id, label: withStatus(valueName(names, "publisher.format", format.id, formatLabel), format.status) })) ?? []),
      ]} />
      <Select label={frameLabel} selectedKey={draft.frame.leaf} onSelectionChange={key => { if (key != null) setDraft({ ...draft, frame: { leaf: String(key) as ProductionSettings["frame"]["leaf"] } }); }} options={[
        ...(!frames.some(frame => frame.id === draft.frame.leaf) ? [{ id: draft.frame.leaf, label: `${valueName(names, "publisher.frame", draft.frame.leaf, frameLabel)} ${unregisteredFrameLabel}` }] : []),
        ...frames.map(frame => ({ id: frame.id, label: withStatus(valueName(names, "publisher.frame", frame.id, frameLabel), frame.status) })),
      ]} />
      <NamedValueComboBox label={frameConfigLabel} value={draft.frame.config ?? ""} onChange={value => setDraft({ ...draft, frame: { leaf: draft.frame.leaf, ...(value ? { config: value } : {}) } })} parent={`publisher.frameConfig.${draft.frame.leaf}`} names={names} ids={frame?.contract.configs ?? []} />
      <Select label={layoutLabel} selectedKey={draft.layout.leaf} onSelectionChange={key => { if (key != null) setDraft({ ...draft, layout: { leaf: String(key) as ProductionSettings["layout"]["leaf"], config: "" } }); }} options={[
        ...(!layouts.some(layout => layout.id === draft.layout.leaf) ? [{ id: draft.layout.leaf, label: selectedLayoutLabel }] : []),
        ...layouts.map(layout => ({ id: layout.id, label: withStatus(valueName(names, "publisher.layout", layout.id, layoutLabel), layout.status) })),
      ]} />
      <NamedValueComboBox label={layoutConfigLabel} isRequired value={draft.layout.config} onChange={value => setDraft({ ...draft, layout: { ...draft.layout, config: value } })} parent={`publisher.layoutConfig.${draft.layout.leaf}`} names={names} ids={layout?.contract.configs.map(config => config.id) ?? []} />
    </FieldGroup>
    {draft.media && <p>{mediaLabel}: <span>{configurationValueLabel(draft.media, names)}</span></p>}
    <DeliverySettingsFields format={format} choices={draft.deliveries ?? []} onChange={deliveries => setDraft({ ...draft, deliveries })} deploymentSurface={draft.deploymentSurface} onSurfaceChange={deploymentSurface => setDraft({ ...draft, deploymentSurface })} deploymentSurfaceIds={deploymentSurfaceIds} messages={messages} />
    <p className="text-sm">{rendererDescription}</p>
    <div className="flex flex-wrap gap-sm"><Button variant="secondary" type="submit" isDisabled={!draft.format || !draft.frame.leaf || !draft.layout.leaf || !draft.layout.config.trim() || (draft.deliveries ?? []).some(choice => (choice.id === "pptx" || choice.id === "google-slides") && !choice.fidelity)}>{applyLabel}</Button><Button variant="ghost" type="button" onPress={onReset}>{resetLabel}</Button></div>
  </>;
}

export interface DeliverySettingsFieldsProps {
  readonly format?: FormatLeaf;
  readonly choices: readonly PublisherDeliveryChoice[];
  readonly onChange: (choices: readonly PublisherDeliveryChoice[]) => void;
  readonly deploymentSurface?: string;
  readonly onSurfaceChange?: (id: string | undefined) => void;
  readonly deploymentSurfaceIds?: readonly string[];
  readonly messages?: Partial<ProductionSettingsFormMessages>;
}
/** Selection records desired handoff only. An exporter is never invoked. */
export function DeliverySettingsFields({ format, choices, onChange, deploymentSurface, onSurfaceChange, deploymentSurfaceIds = [], messages }: DeliverySettingsFieldsProps) {
  /** @default 'Final deliveries' */
  const deliveryLabel = messages?.deliveryLabel ?? 'Final deliveries';
  /** @default 'Slide fidelity' */
  const fidelityLabel = messages?.fidelityLabel ?? 'Slide fidelity';
  /** @default 'Choose editable or flat' */
  const chooseFidelityLabel = messages?.chooseFidelityLabel ?? 'Choose editable or flat';
  /** @default 'Editable native objects (mapping required)' */
  const editableLabel = messages?.editableLabel ?? 'Editable native objects (mapping required)';
  /** @default 'Flat slide images (not editable)' */
  const flatLabel = messages?.flatLabel ?? 'Flat slide images (not editable)';
  /** @default 'Deployment surface ID' */
  const deploymentSurfaceLabel = messages?.deploymentSurfaceLabel ?? 'Deployment surface ID';
  /** @default 'Choose a host surface ID' */
  const chooseSurfaceLabel = messages?.chooseSurfaceLabel ?? 'Choose a host surface ID';
  const names = messages?.valueNames;
  return <FieldGroup legend={deliveryLabel}>{format?.deliveries.map(delivery => {
    const selected = choices.find(choice => choice.id === delivery.id);
    const deliveryName = valueName(names, "publisher.delivery", delivery.id, deliveryLabel);
    const deliveryStatus = names?.("admin.enum", delivery.status);
    return <div key={delivery.id}><Checkbox isSelected={!!selected} onChange={checked => onChange(checked ? [...choices, { id: delivery.id }] : choices.filter(choice => choice.id !== delivery.id))}>{deliveryName}{deliveryStatus ? ` · ${deliveryStatus}` : ""}</Checkbox>
      {selected && delivery.fidelityChoices && <Select label={`${fidelityLabel} · ${deliveryName}`} selectedKey={selected.fidelity ?? ""} onSelectionChange={key => onChange(choices.map(choice => choice.id === delivery.id ? { id: choice.id, ...(key ? { fidelity: String(key) as "editable" | "flat" } : {}) } : choice))} options={[{ id: "", label: chooseFidelityLabel }, { id: "editable", label: editableLabel }, { id: "flat", label: flatLabel }]} />}
    </div>;
  })}{format?.id === "web.page.responsive" && onSurfaceChange && <NamedValueComboBox label={deploymentSurfaceLabel} placeholder={chooseSurfaceLabel} value={deploymentSurface ?? ""} onChange={value => onSurfaceChange(value || undefined)} ids={deploymentSurfaceIds} parent="publisher.deploymentSurface" names={names} />}</FieldGroup>;
}

/** Values are resolved by exact identity; machine codes never become fallback copy. */
function valueName(names: PublisherValueNames | undefined, parent: string, id: string, fallback = "—"): string {
  return names?.(parent, id) ?? fallback;
}

/** Keep the editable text separate from the exact selected machine identity. */
function NamedValueComboBox({ label, value, onChange, ids, parent, names, isRequired, placeholder }: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly ids: readonly string[];
  readonly parent: string;
  readonly names?: PublisherValueNames;
  readonly isRequired?: boolean;
  readonly placeholder?: string;
}) {
  const [editing, setEditing] = useState<{ readonly id: string; readonly text: string }>();
  const options = ids.map(id => ({ id, label: valueName(names, parent, id, label) }));
  const inputValue = editing?.id === value ? editing.text : value ? valueName(names, parent, value, label) : "";
  return <ComboBox label={label} isRequired={isRequired} allowsCustomValue placeholder={placeholder} selectedKey={ids.includes(value) ? value : null} inputValue={inputValue}
    onSelectionChange={key => {
      if (key === null) return;
      const id = String(key);
      setEditing({ id, text: valueName(names, parent, id, label) });
      onChange(id);
    }}
    onInputChange={text => {
      // Aria emits an option's display label after selection. Resolve that event
      // back to the option identity rather than storing the label as its ID.
      if (text === inputValue) return;
      const matches = options.filter(option => option.label === text);
      if (matches.length > 1) return;
      const id = matches.length === 1 ? matches[0]!.id : text;
      setEditing({ id, text });
      onChange(id);
    }} options={options} />;
}

/** Human-readable values for recommendation fields and before/after choices. */
export function configurationValueLabel(value: unknown, names?: PublisherValueNames, parent?: string): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map(row => configurationValueLabel(row, names, parent)).join(", ");
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    if ("size" in row) {
      const media = value as PublisherMediaSettings, size = media.size;
      const sizeText = size.kind === "responsive" ? size.breakpoints.map(id => valueName(names, "publisher.breakpoint", id)).join(" · ") : size.kind === "aspect-ratio" ? `${size.width}:${size.height}` : `${size.width}${"height" in size && size.height !== undefined ? ` × ${size.height}` : ""} ${valueName(names, "publisher.mediaValue", size.unit)}`;
      return `${sizeText}${media.fps === undefined ? "" : ` · ${media.fps} fps`}`;
    }
    if (typeof row.leaf === "string") {
      const kind = row.leaf.startsWith("frames.") ? "frame" : "layout";
      return [valueName(names, `publisher.${kind}`, row.leaf), ...(typeof row.config === "string" && row.config ? [valueName(names, `publisher.${kind}Config.${row.leaf}`, row.config)] : [])].join(" · ");
    }
    if (typeof row.id === "string") return [valueName(names, "publisher.delivery", row.id), ...(typeof row.fidelity === "string" ? [valueName(names, "publisher.slideFidelity", row.fidelity)] : [])].join(" · ");
    return Object.values(row).map(value => configurationValueLabel(value, names, parent)).join(" · ");
  }
  if (typeof value !== "string") return String(value);
  if (parent) return valueName(names, parent, value);
  return names?.("publisher.format", value) ?? names?.("publisher.deploymentSurface", value) ?? "—";
}
export function ConfigurationSummary({ configuration, messages }: { readonly configuration?: PublisherConfiguration; readonly messages?: Partial<ProductionSettingsFormMessages> }) {
  /** @default 'Format' */
  const formatLabel = messages?.formatLabel ?? 'Format';
  /** @default 'Frame' */
  const frameLabel = messages?.frameLabel ?? 'Frame';
  /** @default 'Layout' */
  const layoutLabel = messages?.layoutLabel ?? 'Layout';
  /** @default 'Media settings' */
  const mediaLabel = messages?.mediaLabel ?? 'Media settings';
  /** @default 'Final deliveries' */
  const deliveryLabel = messages?.deliveryLabel ?? 'Final deliveries';
  /** @default 'Deployment surface ID' */
  const deploymentSurfaceLabel = messages?.deploymentSurfaceLabel ?? 'Deployment surface ID';
  if (!configuration || configuration.kind === "asset-reference") return null;
  return <DetailView fields={[
    { label: formatLabel, value: configurationValueLabel(configuration.format, messages?.valueNames, "publisher.format") },
    ...(configuration.kind === "web" ? [
      { label: frameLabel, value: configurationValueLabel(configuration.frame, messages?.valueNames) },
      { label: layoutLabel, value: configurationValueLabel(configuration.layout, messages?.valueNames) },
      { label: mediaLabel, value: configurationValueLabel(configuration.media, messages?.valueNames) },
      ...(configuration.deploymentSurface ? [{ label: deploymentSurfaceLabel, value: configurationValueLabel(configuration.deploymentSurface, messages?.valueNames, "publisher.deploymentSurface") }] : []),
    ] : []),
    { label: deliveryLabel, value: configurationValueLabel(configuration.deliveries, messages?.valueNames) },
  ]} />;
}

/** @default Format, Frame, Layout, Media settings, Final deliveries, or Deployment surface ID. */
export function configurationFieldLabel(field: string, messages?: Partial<ProductionSettingsFormMessages>): string {
  switch (field) {
    case "format": return messages?.formatLabel ?? "Format";
    case "frame": return messages?.frameLabel ?? "Frame";
    case "layout": return messages?.layoutLabel ?? "Layout";
    case "media": return messages?.mediaLabel ?? "Media settings";
    case "deliveries": return messages?.deliveryLabel ?? "Final deliveries";
    case "deploymentSurface": return messages?.deploymentSurfaceLabel ?? "Deployment surface ID";
    default: return messages?.valueNames?.("publisher.contentKey", field) ?? "—";
  }
}
