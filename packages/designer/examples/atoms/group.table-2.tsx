import { Table } from "@clossys/designer/atoms";
import type { Key, SortDescriptor } from "react-aria-components";
const sortDescriptor: SortDescriptor = { column: "name", direction: "ascending" };
const setSortDescriptor = (_sort: SortDescriptor): void => {};
const selectedKeys: Set<Key> = new Set();
const setSelectedKeys = (_keys: "all" | Set<Key>): void => {};
const rows: { id: string; name: string }[] = [{ id: "one", name: "Example prompt" }];

export default function Example() { return <>
<Table
  aria-label="Prompt runs"
  sortDescriptor={sortDescriptor}
  onSortChange={setSortDescriptor}
  selectionMode="multiple"
  selectedKeys={selectedKeys}
  onSelectionChange={setSelectedKeys}
>
  <Table.Header>
    <Table.Column>
      <Table.SelectAllCheckbox />
    </Table.Column>
    <Table.Column id="name" isRowHeader allowsSorting>
      Name
    </Table.Column>
  </Table.Header>
  <Table.Body>
    {rows.map((row) => (
      <Table.Row key={row.id} id={row.id}>
        <Table.Cell>
          <Table.SelectionCheckbox />
        </Table.Cell>
        <Table.Cell>{row.name}</Table.Cell>
      </Table.Row>
    ))}
  </Table.Body>
</Table>
</>; }
