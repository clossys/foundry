import { Card, CardContent } from '@clossys/designer-ui';
import { ContractBlock } from './ContractBlock';
import { DetailHeader } from './DetailHeader';
import { LineageBlock } from './LineageBlock';
import { OptionsBlock } from './OptionsBlock';
import { SpecimenBlock } from './SpecimenBlock';
import { VersionsBlock } from './VersionsBlock';
import type { DetailContractData, DetailHeaderData, DetailLineageRow, DetailOptionData, DetailSpecimenData, DetailVersionRow } from './types';

export type { DetailContractData, DetailHeaderData, DetailLineageRow, DetailOptionData, DetailSpecimenData, DetailTone, DetailVersionRow } from './types';

/** One Designer leaf: its specimen, then contract, lineage and versions as plain blocks. */
export function DesignerDetail({ header, specimens, options, contract, lineage, versions }: {
  header: DetailHeaderData; specimens: readonly DetailSpecimenData[]; options: readonly DetailOptionData[]; contract: DetailContractData; lineage: readonly DetailLineageRow[]; versions: readonly DetailVersionRow[];
}) {
  return <Card className="m-4 md:m-6">
    <DetailHeader header={header} />
    <CardContent className="flex flex-col gap-6">
      <SpecimenBlock name={header.name} specimens={specimens} />
      {options.some(row => !row.pinned) && <OptionsBlock name={header.name} rows={options} />}
      <ContractBlock contract={contract} />
      <LineageBlock rows={lineage} />
      <VersionsBlock rows={versions} />
    </CardContent>
  </Card>;
}
