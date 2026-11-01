import { boardFixture, boardWriterCopy } from "../../__fixtures__/board.js";
import { createContentRevision } from "../../../../content/revisions.js";
import type { CopyField } from "../../../../content/composition.js";
import type { ContentRegistry } from "../../../../content/model.js";
import type { PublisherInspectorInput } from "../../../../content/board/inspector-model.js";

export function inspectorFixture(): PublisherInspectorInput {
  const base = boardFixture();
  // Historical packet identity, retained only in this synthetic presentation fixture.
  const slotId = "sl_0000000002";
  const old = base.candidates[0]!.slotId;
  const registry: ContentRegistry = { ...base,
    slots: base.slots.map(slot => slot.id === old ? { ...slot, id: slotId, locales: ["en", "fr"] } : slot),
    candidates: base.candidates.map(candidate => {
      if (candidate.slotId !== old) return candidate;
      const composition = { ...candidate.composition!, sections: candidate.composition!.sections.map(section => ({ ...section, fields: [...section.fields, { key: "heading", locale: "fr", source: "writer" as const, value: "Bonjour" }] })) };
      const pageMeta: CopyField[] = [...(candidate.pageMeta ?? []),
        { key: "title", locale: "fr", source: "writer", value: "Bonjour" },
        { key: "description", locale: "fr", source: "writer", value: "Découvrez cette page." },
      ];
      const content = { ...candidate, composition, pageMeta };
      const snapshot = createContentRevision(content, candidate.revision, candidate.updatedAt);
      return { ...content, slotId, history: [...candidate.history.filter(row => row.revision !== candidate.revision), snapshot] };
    }),
  };
  const labels = {
    title: "Content inspector", detail: "Candidate detail", revisions: "Revision history", findings: "Open review findings", copy: "Locale copy", approval: "Approval record", releases: "Release history",
    id: "Identity", revision: "Revision", digest: "Content digest", state: "Workflow state", origin: "Origin", at: "Recorded at", by: "Recorded by", source: "Approval source", route: "Route", target: "Target",
    empty: "None recorded", recorded: "Recorded approval", missing: "No approval", stale: "Approval differs from this revision",
    "states.active": "Active", "states.draft": "Draft", "origins.agent-draft": "Agent draft",
  };
  const copy: CopyField[] = [...boardWriterCopy(registry), ...Object.entries(labels).map(([key, value]) => ({ key: `inspector.${key}`, value, locale: "en", source: "writer" as const }))];
  const selected = registry.candidates.filter(candidate => candidate.slotId === slotId);
  return { registry, slotId, locale: "en", copy,
    reviews: selected.map(candidate => ({ candidateId: candidate.id, revision: candidate.revision, digest: candidate.history.at(-1)!.digest,
      findings: [{ check: "copy-schema", path: "composition.heading", rule: "missing-heading", message: "Finish the heading" }], needs: [], checkedAgainst: { libraryVersion: "fixture", locales: ["en", "fr"] } })),
    releases: [{ targetId: "example-target", n: 1, at: selected[0]!.updatedAt, entries: [{ slotId, candidateId: selected[0]!.id, revision: "r1", digest: selected[0]!.history[0]!.digest, route: "/example" }] }],
  };
}
