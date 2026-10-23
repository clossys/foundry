import { Textarea } from "@clossys/designer/atoms";

function DescriptionField() {
  return (
    <Textarea
      label="Description"
      description="Markdown supported."
      rows={6}
      placeholder="What is this prompt for?"
    />
  );
}

export default DescriptionField;
