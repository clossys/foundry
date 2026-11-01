"use client";

import { useState } from "react";
import { ContentSection, DetailView } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/components";
import { buildPublisherInspector, type PublisherInspectorInput, type PublisherInspectorModel } from "../../../content/board/inspector-model.js";
import type { PublisherBoardModel } from "../../../content/board/types.js";
import { PublisherBoard } from "../PublisherBoard.js";

export function PublisherInspector({ model }: { model: PublisherInspectorModel }) {
  if (!model.ready) return null;
  return <ContentSection heading={model.title} headingLevel={2}>
    {model.candidates.map(candidate => <ContentSection key={candidate.id} heading={candidate.title} headingLevel={3}>
      {candidate.sections.map(section => <DetailView key={section.id} title={section.title} fields={section.fields} />)}
    </ContentSection>)}
  </ContentSection>;
}

/** Selection is local UI state; this host exposes no content mutation callback. */
export function PublisherBoardInspector({ model, input }: { model: PublisherBoardModel; input: Omit<PublisherInspectorInput, "slotId"> }) {
  const [slotId, setSlotId] = useState<string>();
  const inspector = slotId === undefined ? undefined : buildPublisherInspector({ ...input, slotId });
  return <PublisherBoard model={model} inspector={{
    candidateCell: row => <Button onPress={() => setSlotId(row.slotId)}>{row.candidateLabel}</Button>,
    render: () => inspector ? <PublisherInspector model={inspector} /> : null,
  }} />;
}
