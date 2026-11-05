import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

export interface ContractCopy {
  title: string;
  description: string;
  factsLabel: string;
  inputsLabel: string;
  fact: string;
  value: string;
  input: string;
  type: string;
  required: string;
  yes: string;
  no: string;
  none: string;
}

/** The `contract` input of `sections.studio.contract`. */
export interface ContractInput {
  copy: ContractCopy;
  facts: readonly { label: string; value: string }[];
  inputs?: readonly { name: string; type: string; required: boolean }[];
  lists: readonly { label: string; items: readonly string[] }[];
}

/** `sections.studio.contract`: the leaf's recorded facts, inputs and the lists it reads, binds and depends on. */
export default function ContractSection({ contract, ...provenance }: { contract: ContractInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{contract.copy.title}</CardTitle>
      <CardDescription>{contract.copy.description}</CardDescription>
    </CardHeader>
    <CardContent>
      {contract.facts.length > 0 && <Table aria-label={contract.copy.factsLabel}>
        <TableHeader>
          <TableHead isRowHeader>{contract.copy.fact}</TableHead>
          <TableHead>{contract.copy.value}</TableHead>
        </TableHeader>
        <TableBody>
          {contract.facts.map(fact => <TableRow key={fact.label} id={fact.label}>
            <TableCell>{fact.label}</TableCell>
            <TableCell>{fact.value}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>}
      {contract.inputs && contract.inputs.length > 0 && <Table aria-label={contract.copy.inputsLabel}>
        <TableHeader>
          <TableHead isRowHeader>{contract.copy.input}</TableHead>
          <TableHead>{contract.copy.type}</TableHead>
          <TableHead>{contract.copy.required}</TableHead>
        </TableHeader>
        <TableBody>
          {contract.inputs.map(input => <TableRow key={input.name} id={input.name}>
            <TableCell>{input.name}</TableCell>
            <TableCell>{input.type}</TableCell>
            <TableCell>{input.required ? contract.copy.yes : contract.copy.no}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>}
      {contract.lists.map(list => <CardDescription key={list.label}>
        {list.label}
        {list.items.length ? list.items.map(item => <Badge key={item} variant="outline">{item}</Badge>) : <Badge variant="ghost">{contract.copy.none}</Badge>}
      </CardDescription>)}
    </CardContent>
  </Card>;
}
