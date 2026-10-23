const createPrompt = (): void => {};

import { EmptyState } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

function EmptyPromptsList() {
  return (
    <EmptyState
      title="No prompts yet"
      description="Create your first prompt template to get started."
      action={<Button onPress={() => createPrompt()}>Create prompt</Button>}
    />
  );
}

export default EmptyPromptsList;
