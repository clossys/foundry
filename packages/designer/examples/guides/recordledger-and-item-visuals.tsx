import { Items, SpecimenPanel, RecordLedger } from "@clossys/designer/blocks/server";

function LedgerExample() {
  const rows = [
    { id: "one", label: "Record one", detail: "Due tomorrow", status: { tone: "neutral" as const, label: "Open" } },
    { id: "two", label: "Record two", detail: "Received today", status: { tone: "success" as const, label: "Received" } },
  ];
  return <>
    <RecordLedger id="example-ledger" form="record" head={{ title: "Review record" }} groups={[{ id: "checks", label: "Checks", rows }]} caption="Sample data." />
    <Items arrangement="bento" treatment="rule" items={[
      { id: "one", heading: "Review records", span: "two-thirds", href: "/records", visual: <SpecimenPanel parts={[{ id: "checks", type: "status-rows", label: "Sample records", items: rows }]} /> },
      { id: "two", heading: "Review guidance", span: "third", href: "/guidance" },
    ]} />
  </>;
}

export default LedgerExample;
