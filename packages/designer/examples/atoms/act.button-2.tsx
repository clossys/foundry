const compare = (): void => {};
const showAll = (): void => {};

import { Button } from "@clossys/designer/atoms";

function SupportingActions() {
  return (
    <>
      <Button variant="tonal" onPress={() => compare()}>
        Compare
      </Button>
      <Button variant="quiet" onPress={() => showAll()}>
        See all
      </Button>
    </>
  );
}

export default SupportingActions;
