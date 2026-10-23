const saveDraft = async (): Promise<void> => {};

import { toast } from "@clossys/designer/shell";

async function save() {
  try {
    await saveDraft();
    toast.success("Saved");
  } catch {
    toast.error("Failed to save", { description: "Check your connection and try again." });
  }
}

export default function Example() { return <button onClick={() => void save()}>Save draft</button>; }
