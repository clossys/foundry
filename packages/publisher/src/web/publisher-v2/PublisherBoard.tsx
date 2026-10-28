"use client";

import { useState, type ReactNode } from "react";
import {
  CanvasSurface,
  ContentSection,
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
  type Selection,
  type Viewport,
} from "@clossys/designer/blocks";
import type { PublisherBoardModel, PublisherBoardRow } from "../../content/board/types.js";
import type { StageKey } from "../../content/stage-engine.js";

const STAGES: readonly StageKey[] = ["define", "assemble", "review", "approve", "publish"];

/** A read-only projection; camera and selection live only for this mounted view. */
export function PublisherBoard({ model, inspector }: { model: PublisherBoardModel; inspector?: { candidateCell: (row: PublisherBoardRow) => ReactNode; render: () => ReactNode } }) {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [selection, setSelection] = useState<Selection>([]);

  if (!model.ready) return null;

  const columns: readonly DataTableColumn<PublisherBoardRow>[] = [
    {
      id: "slot",
      header: model.labels.slot,
      cell: (row) => row.slotLabel,
      isRowHeader: true,
    },
    {
      id: "candidate",
      header: model.labels.candidate,
      cell: (row) => inspector ? inspector.candidateCell(row) : row.candidateLabel,
    },
    ...STAGES.map((stage): DataTableColumn<PublisherBoardRow> => ({
      id: stage,
      header: model.labels.stages[stage],
      cell: (row) => row.cells[stage].label,
    })),
  ];

  return (
    <>
      <PageHeader title={model.labels.title} />
      <CanvasSurface
        aria-label={model.labels.canvas}
        instructionText={model.labels.instructions}
        viewport={viewport}
        onViewportChange={setViewport}
        selection={selection}
        onSelectionChange={setSelection}
        worldBounds={{ x: 0, y: 0, width: 1, height: 1 }}
        items={[]}
        itemInteraction="content"
        contentLayout="flow"
        minimap={false}
        zoomControls={false}
      >
        {model.lanes.length === 0 ? <EmptyState title={model.labels.empty} /> : null}
        {model.lanes.map((lane) => (
          <ContentSection key={lane.id} heading={lane.label} headingLevel={2}>
            {lane.groups.map((group) => (
              <ContentSection key={group.id} heading={group.label} headingLevel={3}>
                <DataTable
                  aria-label={group.label}
                  columns={columns}
                  rows={group.rows}
                  rowKey={(row) => row.id}
                  selectionMode="none"
                  emptyStateTitle={model.labels.empty}
                />
              </ContentSection>
            ))}
          </ContentSection>
        ))}
      </CanvasSurface>
      {inspector?.render()}
    </>
  );
}
