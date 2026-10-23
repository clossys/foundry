import { Button } from "@clossys/designer/atoms";
import { PageHeader } from "@clossys/designer/blocks";

export default function Quickstart() {
  return (
    <PageHeader
      title="Prompts"
      description="Reusable prompt templates for your team."
      actions={<Button onPress={() => {}}>New prompt</Button>}
    />
  );
}
