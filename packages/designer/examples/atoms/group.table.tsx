import { Table } from "@clossys/designer/atoms";

interface PromptRun {
  id: string;
  name: string;
  runs: number;
}

function PromptRunsTable({ rows }: { rows: PromptRun[] }) {
  return (
    <Table aria-label="Prompt runs">
      <Table.Header>
        <Table.Column id="name" isRowHeader allowsSorting>
          Name
        </Table.Column>
        <Table.Column id="runs" allowsSorting>
          Runs
        </Table.Column>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={row.id} id={row.id}>
            <Table.Cell>{row.name}</Table.Cell>
            <Table.Cell>{row.runs}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}

export default PromptRunsTable;
export const smokeProps = { rows: [{ id: "one", name: "Example prompt", runs: 3 }] } satisfies React.ComponentProps<typeof PromptRunsTable>;
