import { useState } from "react";
import { CommandMenu, useCommandMenuShortcut } from "@clossys/designer/blocks";

export function CommandExample() {
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useCommandMenuShortcut({ onOpen: () => setOpen(true) });
  return (
    <>
      <button onClick={() => setOpen(true)}>Commands</button>
      <CommandMenu heading="Commands" searchLabel="Find a command"
        closeLabel="Close commands" emptyMessage="No matching commands"
        isOpen={isOpen} onOpenChange={setOpen} query={query} onQueryChange={setQuery}
        resultCountMessage={count => count + " matching commands"}
        groups={[{ id: "pages", label: "Pages", items: [
          { id: "documents", label: "Documents", href: "/documents" },
        ] }]} />
    </>
  );
}

export default CommandExample;
