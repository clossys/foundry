const deletePrompt = (): void => {};

import { ConfirmDialog } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

function DeletePromptButton() {
  return (
    <ConfirmDialog
      trigger={<Button variant="danger">Delete</Button>}
      heading="Delete this prompt?"
      message="This can't be undone."
      tone="destructive"
      confirmLabel="Delete"
      onConfirm={() => deletePrompt()}
    />
  );
}

export default DeletePromptButton;
