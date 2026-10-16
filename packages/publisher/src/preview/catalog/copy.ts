import { createCopyResolver, type CopyRegistry } from '@clossys/writer';
export const CATALOG_COPY_REGISTRY = {
    "id": "catalog-generic-catalog",
    "locale": "en",
    "revision": "1",
    "source": {
        "kind": "consumer",
        "reference": "generic-preview-fixtures"
    },
    "entries": [
        { "id": "catalog.sample.readiness.available", "text": "Available", "context": "Generic catalog readiness label", "status": "approved" },
        { "id": "catalog.sample.readiness.partial", "text": "Partial", "context": "Generic catalog readiness label", "status": "approved" },
        { "id": "catalog.sample.readiness.planned", "text": "Planned", "context": "Generic catalog readiness label", "status": "approved" },
        { "id": "catalog.sample.readiness.not-offered", "text": "Not offered", "context": "Generic catalog readiness label", "status": "approved" },
        { id: "catalog.sample.prose.heading", text: "Prepare a record with context", context: "Prose catalog fixture", status: "approved" },
        { id: "catalog.sample.prose.before", text: "Read the ", context: "Prose catalog fixture", status: "approved" },
        { id: "catalog.sample.prose.link", text: "writing guide", context: "Prose catalog fixture", status: "approved" },
        { id: "catalog.sample.prose.after", text: " before preparing your next record.", context: "Prose catalog fixture", status: "approved" },
        { id: "catalog.sample.prose.second", text: "Keep source material beside the record so each review starts with context.", context: "Prose catalog fixture", status: "approved" },
        {
            "id": "catalog.sample.approval.decision",
            "text": "Sample decision",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.approval.fn0",
            "text": "Check one",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.approval.fn1",
            "text": "Check two",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.approval.label",
            "text": "A clear sample showing how source documents connect to the resolved result in this section",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.approval.node",
            "text": "Sample decision",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.approval.prepared",
            "text": "Sample preparation",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.approval.subject0",
            "text": "Sample subject",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.approval.subject1",
            "text": "Sample subject",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.approval.title0",
            "text": "Sample finding",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.approval.title1",
            "text": "Sample finding",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.action.primary",
            "text": "View sample",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.action.secondary",
            "text": "Read sample",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.action.tertiary",
            "text": "Read sample",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.footnote.link",
            "text": "Sample note",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.hero.primary",
            "text": "View sample",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.hero.secondary",
            "text": "Read sample",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.item.eyebrow",
            "text": "Sample area",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.matrix.after.description",
            "text": "Sample supporting copy.",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.matrix.before.description",
            "text": "Sample supporting copy.",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.panel.health",
            "text": "Ready",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.example.say.eyebrow",
            "text": "Sample area",
            "context": "Generic catalog sample",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.3.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.4.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.5.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.danger",
            "text": "Sample badge",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.info",
            "text": "Sample badge",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.meta-both",
            "text": "Sample metadata",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.meta-only",
            "text": "Sample metadata",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.neutral",
            "text": "Sample badge",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.success",
            "text": "Sample badge",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.badge.warning",
            "text": "Sample badge",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.0.meta",
            "text": "Sample metadata",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.1.meta",
            "text": "Sample metadata",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.2.meta",
            "text": "Sample metadata",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.3.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.3.meta",
            "text": "Sample metadata",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.4.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.bento.4.meta",
            "text": "Sample metadata",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.columns.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.columns.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.columns.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected-part-1.label",
            "text": "Sample fields",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected-part-1.row.label",
            "text": "Sample field",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected-part-1.row.value",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected-part-2.label",
            "text": "Sample fields",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected-part-2.row.label",
            "text": "Sample field",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected-part-2.row.value",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected-part-3.label",
            "text": "Sample fields",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected-part-3.row.label",
            "text": "Sample field",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected-part-3.row.value",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected.0.meta",
            "text": "Sample actor",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected.1.meta",
            "text": "Sample actor",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected.2.meta",
            "text": "Sample actor",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.connected.caption",
            "text": "Sample data.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.label",
            "text": "A clear sample showing how source documents connect to the resolved result in this section",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.relation",
            "text": "Sample relation",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.source0",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.source1",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.source2",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.source3",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.source4",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.source5",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.source6",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.sources",
            "text": "Sample sources",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.target",
            "text": "Sample target",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.converge.title",
            "text": "Sample result",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.disclose.0.description",
            "text": "Sample answer explains the example clearly, describes the next step, and gives enough context for a useful decision.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.disclose.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.disclose.1.description",
            "text": "Sample answer explains the example clearly, describes the next step, and gives enough context for a useful decision.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.disclose.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.disclose.2.description",
            "text": "Sample answer explains the example clearly, describes the next step, and gives enough context for a useful decision.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.disclose.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.disclose.3.description",
            "text": "Sample answer explains the example clearly, describes the next step, and gives enough context for a useful decision.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.disclose.3.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.evidence.cite0",
            "text": "Source one",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.evidence.cite1",
            "text": "Source two",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.evidence.label",
            "text": "A clear sample showing how source documents connect to the resolved result in this section",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.evidence.source0",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.evidence.source1",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.evidence.title",
            "text": "Sample result",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.parallel-columns.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.parallel-columns.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.parallel-columns.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.files.format",
            "text": "PDF",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.files.label",
            "text": "Sample files",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.files.name",
            "text": "Sample document",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.files.source",
            "text": "Sample source",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.frame-size-standard.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.frame-display.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.frame-split-end.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.frame-split-start.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.frame-standard.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-badge-meta.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-bento.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-columns.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-connected.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-disclose.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-parallel-columns.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-lanes.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-links.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-numbered.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-rows-two.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-rule.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-stack.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-statement.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.items-topics.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key-below-panel.title",
            "text": "Sample record",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key-panel.title",
            "text": "Sample record",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key-table.caption",
            "text": "Sample table caption",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key-table.label",
            "text": "Sample table",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.below.description0",
            "text": "This label identifies the sample part.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.below.description1",
            "text": "This label identifies the sample part.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.below.description2",
            "text": "This label identifies the sample part.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.below.footer",
            "text": "Sample footer.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.below.heading0",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.below.heading1",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.below.heading2",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.below.label",
            "text": "Sample key",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.end.description0",
            "text": "This label identifies the sample part.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.end.description1",
            "text": "This label identifies the sample part.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.end.description2",
            "text": "This label identifies the sample part.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.end.heading0",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.end.heading1",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.end.heading2",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.end.label",
            "text": "Sample key",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.key.footer",
            "text": "Sample footer.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.lane.reviewer",
            "text": "Reviewer",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.lane.sender",
            "text": "Sender",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.lanes.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.lanes.0.meta",
            "text": "Sample actor",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.lanes.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.lanes.1.meta",
            "text": "Sample actor",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.lanes.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.lanes.2.meta",
            "text": "Sample actor",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.lanes.end",
            "text": "Repeats after review",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.links.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.links.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.links.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix-points.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix-visuals.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix.after.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix.after.label",
            "text": "After",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix.after.point0",
            "text": "A sample point explains the difference.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix.after.point1",
            "text": "A sample point explains the difference.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix.before.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix.before.label",
            "text": "Before",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix.before.point0",
            "text": "A sample point explains the difference.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrix.before.point1",
            "text": "A sample point explains the difference.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv-after-fields.label",
            "text": "Sample fields",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv-after-fields.row.label",
            "text": "Sample field",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv-after-fields.row.value",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv-after.title",
            "text": "Sample record",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv-before-fields.label",
            "text": "Sample fields",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv-before-fields.row.label",
            "text": "Sample field",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv-before-fields.row.value",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv-before.title",
            "text": "Sample record",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv.after.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv.after.label",
            "text": "After",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv.before.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.matrixv.before.label",
            "text": "Before",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.media-converge.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.media-evidence.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.media-key-below.label",
            "text": "A sample panel showing labeled fields and a current measurement",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.media-key-end.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.media-key-end.label",
            "text": "A sample panel showing labeled fields and a current measurement",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.media-record.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.media-specimen.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.media-specimen.label",
            "text": "A sample panel showing labeled fields and a current measurement",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.meter.label",
            "text": "Sample measurement",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.meter.limit",
            "text": "Limit 80 units",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.meter.previous",
            "text": "Previously 30 units",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.meter.value",
            "text": "40 units",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.numbered.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.numbered.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.numbered.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.other.hero.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.panel.badge",
            "text": "Sample badge",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.panel.meta",
            "text": "Sample metadata",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.caption",
            "text": "Sample record caption.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.detail",
            "text": "Sample detail",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.flag",
            "text": "Flagged row",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.head.status",
            "text": "Sample status",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.initials",
            "text": "AA",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.meta",
            "text": "Sample metadata",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.owner",
            "text": "Sample owner",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.owner-label",
            "text": "Sample owner",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.owner-note",
            "text": "Sample role",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.row",
            "text": "Sample row",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.rows",
            "text": "Sample rows",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.record.title",
            "text": "Sample record",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.rows-two.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.rows-two.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.rows-two.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.rows-two.3.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.rule.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.rule.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.say-actions.action",
            "text": "View sample",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.say-actions.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.say-footnote.text",
            "text": "Sample note.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.say-heading.description",
            "text": "Sample supporting copy.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.say-heading.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.person.name",
            "text": "Sample owner",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.person.note",
            "text": "Sample role",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.row0",
            "text": "Sample row",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.row1",
            "text": "Sample row",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.row2",
            "text": "Sample row",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.row3",
            "text": "Sample row",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.row4",
            "text": "Sample row",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.status",
            "text": "Sample status",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.value0",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.value1",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.value2",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.value3",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.scene.value4",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.schedule.date",
            "text": "Day one",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.schedule.item",
            "text": "Sample event",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.schedule.label",
            "text": "Sample schedule",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.shares.first",
            "text": "First group",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.shares.first-text",
            "text": "50%",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.shares.label",
            "text": "Sample shares",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.shares.second",
            "text": "Second group",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.shares.second-text",
            "text": "50%",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.specimen-fields.label",
            "text": "Sample fields",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.specimen-fields.row.label",
            "text": "Sample field",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.specimen-fields.row.value",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.specimen-panel.title",
            "text": "Sample record",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.specimen-status.label",
            "text": "Sample statuses",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.split-end.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.split-end.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.split-end.action",
            "text": "View sample",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.split-start.action",
            "text": "View sample",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.stack-part-1.label",
            "text": "Sample fields",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.stack-part-1.row.label",
            "text": "Sample field",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.stack-part-1.row.value",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.stack-part-2.label",
            "text": "Sample fields",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.stack-part-2.row.label",
            "text": "Sample field",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.stack-part-2.row.value",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.stack.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.stack.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.statement.0.description",
            "text": "Sample statement.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.statement.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.statement.1.description",
            "text": "Sample statement.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.statement.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.statement.2.description",
            "text": "Sample statement.",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.statement.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.danger.label",
            "text": "Sample check",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.danger.status",
            "text": "Sample status",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.info.label",
            "text": "Sample check",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.info.status",
            "text": "Sample status",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.neutral.label",
            "text": "Sample check",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.neutral.status",
            "text": "Sample status",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.success.label",
            "text": "Sample check",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.success.status",
            "text": "Sample status",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.warning.label",
            "text": "Sample check",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.status.warning.status",
            "text": "Sample status",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.table.column.label",
            "text": "Label",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.table.column.value",
            "text": "Value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.table.row",
            "text": "Sample row",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.table.value",
            "text": "Sample value",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.0.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.1.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.2.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.3.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.4.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.5.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.6.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.7.heading",
            "text": "Sample heading",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.group0.label",
            "text": "Sample group",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.group1.label",
            "text": "Sample group",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.group2.label",
            "text": "Sample group",
            "context": "Generic preview placeholder",
            "status": "approved"
        },
        {
            "id": "catalog.sample.topics.group3.label",
            "text": "Sample group",
            "context": "Generic preview placeholder",
            "status": "approved"
        }
    ]
} satisfies CopyRegistry;
export const catalogCopyResolver = createCopyResolver(CATALOG_COPY_REGISTRY);
