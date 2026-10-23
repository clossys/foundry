import { Checkbox } from "@clossys/designer/atoms";

function SelectAllRows({ isAllSelected, isSomeSelected, onToggle }: {
  isAllSelected: boolean;
  isSomeSelected: boolean;
  onToggle: (isSelected: boolean) => void;
}) {
  return (
    <Checkbox isSelected={isAllSelected} isIndeterminate={isSomeSelected} onChange={onToggle}>
      Select all
    </Checkbox>
  );
}

export default SelectAllRows;
export const smokeProps = { isAllSelected: false, isSomeSelected: false, onToggle: (_selected: boolean): void => {} } satisfies React.ComponentProps<typeof SelectAllRows>;
