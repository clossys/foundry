import { Card, CardContent } from '@clossys/designer-ui';
import { ChecksBlock } from './ChecksBlock';
import { ContractBlock } from './ContractBlock';
import { DetailHeader } from './DetailHeader';
import { HistoryBlock } from './HistoryBlock';
import { SpecimenBlock } from './SpecimenBlock';
import { UsesBlock } from './UsesBlock';
import type { DetailCheckRow, DetailContractData, DetailHeaderData, DetailHistoryRow, DetailSpecimenData, DetailUsesData } from './types';

export type { DetailCheckRow, DetailContractData, DetailHeaderData, DetailHistoryRow, DetailRef, DetailSpecimenData, DetailTone, DetailUsesData } from './types';

/** Any agent's leaf: its specimen, then checks, contract, history and uses as plain blocks. */
export function AgentDetail({ header, specimen, checks, contract, history, uses }: {
  header: DetailHeaderData; specimen: DetailSpecimenData; checks: readonly DetailCheckRow[]; contract: DetailContractData; history: readonly DetailHistoryRow[]; uses: DetailUsesData;
}) {
  return <Card className="m-4 md:m-6">
    <DetailHeader header={header} />
    <CardContent className="flex flex-col gap-6">
      <SpecimenBlock name={header.name} specimen={specimen} />
      <ChecksBlock rows={checks} />
      <ContractBlock contract={contract} />
      <HistoryBlock rows={history} />
      <UsesBlock uses={uses} />
    </CardContent>
  </Card>;
}
