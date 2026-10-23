import { Popover, Button } from "@clossys/designer/atoms";

function FiltersPopover() {
  return (
    <Popover trigger={<Button variant="secondary">Filters</Button>}>
      {({ close }) => (
        <div className="flex flex-col gap-sm">
          <p>Filter controls go here.</p>
          <Button onPress={close}>Apply</Button>
        </div>
      )}
    </Popover>
  );
}

export default FiltersPopover;
