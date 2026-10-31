import { Card, CardContent } from '@clossys/designer-ui';
import { ContractBlock } from './ContractBlock';
import { DetailHeader } from './DetailHeader';
import { LineageBlock } from './LineageBlock';
import { SpecimenBlock } from './SpecimenBlock';
import { VersionsBlock } from './VersionsBlock';
import type { DetailContractData, DetailHeaderData, DetailLineageRow, DetailVersionRow } from './types';

export type { DetailContractData, DetailHeaderData, DetailLineageRow, DetailTone, DetailVersionRow } from './types';

/** One Designer leaf: its specimen, then contract, lineage and versions as plain blocks. */
export function DesignerDetail({ header, specimenSrc, contract, lineage, versions }: {
  header: DetailHeaderData; specimenSrc?: string; contract: DetailContractData; lineage: readonly DetailLineageRow[]; versions: readonly DetailVersionRow[];
}) {
  return <Card className="m-4 md:m-6">
    <DetailHeader header={header} />
    <CardContent className="flex flex-col gap-6">
      <SpecimenBlock name={header.name} {...(specimenSrc ? { src: specimenSrc } : {})} />
      <ContractBlock contract={contract} />
      <LineageBlock rows={lineage} />
      <VersionsBlock rows={versions} />
    </CardContent>
  </Card>;
}
