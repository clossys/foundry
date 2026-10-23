import { Toolbar } from "@clossys/designer/blocks";
import { Button, TextField } from "@clossys/designer/atoms";

function PromptsToolbar() {
  return (
    <Toolbar
      aria-label="Prompts"
      leading={<Button variant="secondary">Bulk actions</Button>}
      search={<TextField label="Filter" aria-label="Filter prompts" />}
      trailing={<Button>New prompt</Button>}
    />
  );
}

export default PromptsToolbar;
