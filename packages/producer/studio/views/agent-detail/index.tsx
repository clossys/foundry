import { Card, CardContent } from '@clossys/designer-ui';
import { ChecksBlock } from './ChecksBlock';
import { ContractBlock } from './ContractBlock';
import { DetailHeader } from './DetailHeader';
import { HistoryBlock } from './HistoryBlock';
import { SpecimenBlock } from './SpecimenBlock';
import { UsesBlock } from './UsesBlock';
import type { DetailCheckRow, DetailContractData, DetailHeaderData, DetailHistoryData, DetailSlots, DetailSpecimenData, DetailUsesData } from './types';

export type { DetailCheckRow, DetailContractData, DetailHeaderData, DetailHistoryData, DetailHistoryRow, DetailLineage, DetailRef, DetailSlots, DetailSpecimenData, DetailTone, DetailUsesData } from './types';

/**
 * Any agent's leaf, Designer included: its specimen, then checks, contract, history and uses as
 * plain blocks across the full content column. An agent adds its own blocks only through `slots`.
 */
export function AgentDetail({ header, specimen, checks, contract, history, uses, slots }: {
  header: DetailHeaderData; specimen: DetailSpecimenData; checks?: readonly DetailCheckRow[]; contract: DetailContractData;
  history: DetailHistoryData; uses?: DetailUsesData; slots?: DetailSlots;
}) {
  return <Card className="m-4 md:m-6">
    <DetailHeader header={header} />
    <CardContent className="flex min-w-0 flex-col gap-6">
      {slots?.specimen ?? <SpecimenBlock name={header.name} specimen={specimen} />}
      {slots?.afterSpecimen}
      {checks && checks.length > 0 && <ChecksBlock rows={checks} />}
      <ContractBlock contract={contract} />
      <HistoryBlock history={history} />
      {uses && <UsesBlock uses={uses} />}
    </CardContent>
  </Card>;
}
