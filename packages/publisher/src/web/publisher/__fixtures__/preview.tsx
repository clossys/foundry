import { publisherCopyFixtureResolver } from "./writer-copy.js";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LayoutRendererSource } from "../../../core/instance-binding.js";
import type { AppInventory } from "../app/inventory.js";
import { PublisherPage } from "../PublisherPage.js";
import { FIXTURE_BREAKPOINTS } from "../../instances/__fixtures__/standard-instances.js";
import { STANDARD_PACK_FIXTURE, STANDARD_PACK_INSTANCES, STANDARD_PACK_REGISTRIES, createStandardPackLibrary } from "./standard-website.js";
import { PublisherPlanStore } from "../../../planning/change-set.js";
import type { PublisherPlanDraft } from "../../../planning/plan.js";
import { createPreviewM1Draft, createEmptyExampleDraft, createAppExampleDraft, createDeliveryExampleDraft } from "./example-plan.js";
import { fixtureCompiler } from "./compiler.js";

declare const __PUBLISHER_APP_INVENTORY__: AppInventory | null;
declare const __PUBLISHER_FIXTURE_RENDERERS__: Readonly<Record<string, LayoutRendererSource>>;
const library = createStandardPackLibrary(__PUBLISHER_FIXTURE_RENDERERS__);
interface PreviewMessages {
  readonly proposalDescription: string;
  readonly m1Label: string;
  readonly appLabel: string;
  readonly emptyLabel: string;
  readonly deliveryLabel: string;
  readonly removeContentLabel: string;
}
interface PreviewProps {
  readonly messages?: Partial<PreviewMessages>;
}
function Preview({ messages }: PreviewProps) {
  /** @default 'Example proposals only. Use Align on the Plan tab to accept a local fixture snapshot; this is not consumer approval.' */
  const proposalDescription = messages?.proposalDescription ?? 'Example proposals only. Use Align on the Plan tab to accept a local fixture snapshot; this is not consumer approval.';
  /** @default 'Propose M1 example' */
  const m1Label = messages?.m1Label ?? 'Propose M1 example';
  /** @default 'Propose independent App example' */
  const appLabel = messages?.appLabel ?? 'Propose independent App example';
  /** @default 'Propose empty next version' */
  const emptyLabel = messages?.emptyLabel ?? 'Propose empty next version';
  /** @default 'Preview only: remove one required Home ContentRef to demonstrate needs input. The eight-page M1 example stays unchanged.' */
  const removeContentLabel = messages?.removeContentLabel ?? 'Preview only: remove one required Home ContentRef to demonstrate needs input. The eight-page M1 example stays unchanged.';

  /** @default 'Propose delivery examples' */
  const deliveryLabel = messages?.deliveryLabel ?? 'Propose delivery examples';
  const [store] = useState(() => new PublisherPlanStore(STANDARD_PACK_REGISTRIES));
  const [draft, setDraft] = useState<PublisherPlanDraft>();
  const proposeM1 = () => setDraft(createPreviewM1Draft(__PUBLISHER_APP_INVENTORY__, (store.current?.version ?? 0) + 1));
  const [missingReference, setMissingReference] = useState(false);
  const instances = useMemo(() => {
    if (!missingReference) return STANDARD_PACK_INSTANCES;
    const copy = structuredClone(STANDARD_PACK_INSTANCES);
    const fill = copy[0]!.fills.lead![0]!;
    const slot = STANDARD_PACK_REGISTRIES.sections.find(section => section.id === fill.section)!.contract.slots.find(slot => slot.required)!;
    delete (fill.content as Record<string, unknown>)[slot.name];
    return copy;
  }, [missingReference]);
  return <main className="bg-surface-base p-lg text-ink-primary">
  <div className="mb-lg rounded border border-status-warning p-md"><p>Fixture library · static: {STANDARD_PACK_FIXTURE.staticQualification}</p><p>Placeholder ContentRefs only. Frames and sections are fixture projections; F5/S4 runtime qualification and LK12 rendered evidence remain pending.</p></div>
  <div className="mb-lg flex flex-wrap gap-md rounded border border-status-warning p-md"><p>{proposalDescription}</p><button type="button" className="rounded border border-line-base p-sm" onClick={proposeM1}>{m1Label}</button>{__PUBLISHER_APP_INVENTORY__ && <button type="button" className="rounded border border-line-base p-sm" onClick={() => setDraft(createAppExampleDraft(__PUBLISHER_APP_INVENTORY__, (store.current?.version ?? 0) + 1))}>{appLabel}</button>}<button type="button" className="rounded border border-line-base p-sm" onClick={() => setDraft(createDeliveryExampleDraft((store.current?.version ?? 0) + 1))}>{deliveryLabel}</button><button type="button" className="rounded border border-line-base p-sm" onClick={() => setDraft(createEmptyExampleDraft((store.current?.version ?? 0) + 1))}>{emptyLabel}</button></div>
  <label className="mb-lg block rounded border border-status-warning p-md"><input type="checkbox" checked={missingReference} onChange={event => setMissingReference(event.target.checked)} /> {removeContentLabel}</label>
  <PublisherPage copyResolver={publisherCopyFixtureResolver} deploymentSurfaceIds={["fixture.web-preview", "fixture.web-live"]} planStore={store} draftPlan={draft} onApplyPlan={() => true} instances={instances} library={library} registries={STANDARD_PACK_REGISTRIES} compiler={fixtureCompiler}
    appInventory={__PUBLISHER_APP_INVENTORY__ ?? undefined} breakpointValues={FIXTURE_BREAKPOINTS} designerHref="https://github.com/clossys/foundry/tree/main/packages/designer" fixtureLibrary />
</main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
