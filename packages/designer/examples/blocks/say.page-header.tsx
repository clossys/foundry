const createPrompt = (): void => {};

import { PageHeader } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

function PromptsPageHeader() {
  return (
    <PageHeader
      title="Prompts"
      description="Reusable prompt templates for your team."
      actions={<Button onPress={() => createPrompt()}>New prompt</Button>}
    />
  );
}

export default PromptsPageHeader;
