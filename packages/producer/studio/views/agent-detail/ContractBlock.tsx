import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';
import type { DetailContractData } from './types';

/** The leaf's contract: its recorded facts, inputs and the lists it reads, binds and depends on. */
export function ContractBlock({ contract }: { contract: DetailContractData }) {
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Contract</CardTitle>
      <CardDescription>What this leaf promises and reads.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {contract.facts.length > 0 && <Table aria-label="Contract facts">
        <TableHeader>
          <TableHead isRowHeader>Fact</TableHead>
          <TableHead>Value</TableHead>
        </TableHeader>
        <TableBody>
          {contract.facts.map(fact => <TableRow key={fact.label} id={fact.label}>
            <TableCell>{fact.label}</TableCell>
            <TableCell className="whitespace-normal">{fact.value}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>}
      {contract.inputs && contract.inputs.length > 0 && <Table aria-label="Contract inputs">
        <TableHeader>
          <TableHead isRowHeader>Input</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Required</TableHead>
        </TableHeader>
        <TableBody>
          {contract.inputs.map(input => <TableRow key={input.name} id={input.name}>
            <TableCell>{input.name}</TableCell>
            <TableCell>{input.type}</TableCell>
            <TableCell>{input.required ? 'Yes' : 'No'}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>}
      {contract.lists.map(list => <CardDescription key={list.label} className="flex flex-wrap items-center gap-1">
        {list.label}
        {list.items.length ? list.items.map(item => <Badge key={item} variant="outline">{item}</Badge>) : <Badge variant="ghost">None</Badge>}
      </CardDescription>)}
    </CardContent>
  </Card>;
}
