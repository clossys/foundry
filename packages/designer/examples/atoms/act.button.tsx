const save = (): void => {};

import { Button } from "@clossys/designer/atoms";

function SaveButton() {
  return (
    <Button variant="primary" size="md" onPress={() => save()}>
      Save
    </Button>
  );
}

export default SaveButton;
